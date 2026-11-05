// Brightolio edge: a small server on Cloudflare's network in front of the real servers (free:
// 100,000 requests a day). It
//   - answers from the nearest Cloudflare location: the app's scripts, styles and images are kept
//     there (refreshed in the background), so pages open fast even when the server is far away
//     or waking up;
//   - sends everything else (pages' data, sign-in, orders, live price streams) to the active
//     server, the first in the "origins" list that Admin → Hosting writes;
//   - falls back to the next server when the active one is down (only for reads: an order or any
//     other change is never sent twice);
//   - passes the visitor's real address to the server, signed with EDGE_SECRET;
//   - every 5 minutes calls each server so free hosts never put them to sleep.
// Setup: edge/README.md. Settings: ORIGINS (comma list, used until Admin writes the KV list),
// KV binding CONFIG, secret EDGE_SECRET.

const STATIC = /\.(?:js|mjs|css|png|jpe?g|webp|svg|ico|woff2?|webmanifest|json)$/i;
const NEVER_CACHE = /^\/(?:api|twilio|webhooks|hook|hooks|oauth|auth|internal|healthz|mcp|download)(?:\/|$)/;
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

let originsCache = { at: 0, list: null };
async function origins(env) {
  if (originsCache.list && Date.now() - originsCache.at < 30e3) return originsCache.list;
  let list = null;
  try { const v = env.CONFIG ? await env.CONFIG.get('origins') : null; if (v) list = JSON.parse(v); } catch {}
  if (!Array.isArray(list) || !list.length) list = String(env.ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  list = list.filter(u => /^https:\/\//.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(u)).map(u => u.replace(/\/$/, ''));
  originsCache = { at: Date.now(), list };
  return list;
}

function toOrigin(request, origin, env) {
  const u = new URL(request.url), target = new URL(u.pathname + u.search, origin);
  const h = new Headers(request.headers);
  h.delete('host');
  h.set('x-forwarded-host', u.host);
  h.set('x-forwarded-proto', 'https');
  // The secret proves to the server that this came through the edge, so it trusts the visitor's
  // address and the public name above. A visitor's own copies of these headers are dropped.
  h.delete('x-edge-client-ip'); h.delete('x-edge-secret');
  const ip = request.headers.get('cf-connecting-ip');
  if (env.EDGE_SECRET) { h.set('x-edge-secret', env.EDGE_SECRET); if (ip) h.set('x-edge-client-ip', ip); }
  const body = SAFE.has(request.method) ? undefined : request.body;
  return new Request(target, { method: request.method, headers: h, body, redirect: 'manual', ...(body ? { duplex: 'half' } : {}) });
}

// Redirects from a server name the server, not the public address: point them back here.
function fixResponse(res, origin, publicHost) {
  const loc = res.headers.get('location');
  if (!loc) return res;
  try {
    const l = new URL(loc, origin);
    if (l.origin === new URL(origin).origin) { l.host = publicHost; l.protocol = 'https:'; const r = new Response(res.body, res); r.headers.set('location', l.toString()); return r; }
  } catch {}
  return res;
}

async function forward(request, env, ctx) {
  const list = await origins(env), host = new URL(request.url).host;
  if (!list.length) return new Response('Brightolio edge: no server is set up yet (ORIGINS).', { status: 503 });
  const safe = SAFE.has(request.method) && request.headers.get('upgrade') !== 'websocket';
  let last = null;
  for (const [i, origin] of list.entries()) {
    const isLast = i === list.length - 1;
    try {
      const req = toOrigin(request, origin, env);
      // Reads wait at most 8 seconds before trying the backup; changes wait for their answer.
      const res = safe && !isLast ? await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 8000))]) : await fetch(req);
      if (safe && !isLast && [502, 503, 504, 520, 521, 522, 523, 524].includes(res.status)) { last = res; continue; }
      const out = fixResponse(res, origin, host);
      if (i > 0) { const r = new Response(out.body, out); r.headers.set('x-brightfolio-origin', 'backup'); return r; }
      return out;
    } catch (e) {
      last = e;
      // A change (an order, a sign-in) that may have reached the server is never sent again.
      if (!safe) break;
    }
  }
  if (last instanceof Response) return last;
  return new Response(page('We could not reach Brightolio just now. Please try again in a moment.'), { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '15' } });
}

const page = msg => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Brightolio</title><style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:#0b1324;color:#e7ecf5;text-align:center}</style><div><h1>Brightolio</h1><p>${msg}</p><p><a style="color:#8fb2ff" href="/">Try again</a></p></div>`;

export const _test = { origins, reset: () => (originsCache = { at: 0, list: null }) };
export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    const cacheable = request.method === 'GET' && !NEVER_CACHE.test(u.pathname) && STATIC.test(u.pathname) && !request.headers.get('authorization');
    if (!cacheable) return forward(request, env, ctx);
    // Static files: from the edge's cache; a copy older than 5 minutes is refreshed in the background.
    const cache = caches.default, key = new Request(u.toString(), { method: 'GET' });
    const hit = await cache.match(key);
    if (hit) {
      const age = Date.now() - Number(hit.headers.get('x-edge-stored') || 0);
      if (age > 5 * 60e3) ctx.waitUntil(forward(request, env, ctx).then(async res => { if (res.ok) await store(cache, key, res); }).catch(() => {}));
      // Browsers get the server's own caching rules (so a new version reaches them at once).
      const out = new Response(hit.body, hit), cc = hit.headers.get('x-origin-cache-control');
      if (cc) out.headers.set('cache-control', cc); else out.headers.delete('cache-control');
      out.headers.delete('x-origin-cache-control'); out.headers.delete('x-edge-stored');
      return out;
    }
    const res = await forward(request, env, ctx);
    if (res.ok) ctx.waitUntil(store(cache, key, res.clone()));
    return res;
  },
  // Every 5 minutes: wake every server so none is asleep when a visitor arrives.
  async scheduled(event, env, ctx) {
    for (const o of await origins(env)) ctx.waitUntil(fetch(o + '/healthz', { headers: { 'user-agent': 'Brightolio-edge-keep-warm' } }).catch(() => {}));
  },
};

async function store(cache, key, res) {
  const r = new Response(res.body, res);
  r.headers.set('x-edge-stored', String(Date.now()));
  if (res.headers.get('cache-control')) r.headers.set('x-origin-cache-control', res.headers.get('cache-control'));
  r.headers.set('cache-control', 'public, max-age=86400'); // how long the edge itself may keep it
  r.headers.delete('set-cookie');
  await cache.put(key, r);
}
