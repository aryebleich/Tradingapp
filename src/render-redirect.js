// Render runs no app (MIGRATION_ORACLE.md): it has no database and runs no jobs, so nothing can run
// twice. It does two things:
// - The main address (TARGET, https://app.brightolio.com), while its DNS still points at Render:
//   every request is passed on to the Oracle server (FALLBACK, its direct address) with the edge
//   secret and the address the visitor used, so the Oracle app answers as app.brightolio.com (sign-in
//   with Google, cookies and links keep that address). Render first asks the Oracle server whether
//   its secret is trusted (/internal/edge-check); until it is, those requests get a 301 to the
//   server's direct address instead (never a loop).
// - Every other address (quantpocket.onrender.com, old links and bookmarks): a 301 to the same path
//   on TARGET.
// /healthz answers here with 200 (Render's own health check, and the keep-warm ping).
//
// - render.yaml starts this file directly: `node src/render-redirect.js` (no build; Node.js only).
// - It is also the first import of server.js: when Render (RENDER is set) starts `node server.js`
//   anyway, it starts here before any other module is evaluated, the database is pointed at a
//   throwaway local file (never a shared one), and server.js does not start the app (REDIRECT_ONLY).
//   RENDER_SERVE_APP=1 turns this off.
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const TARGET = () => (process.env.REDIRECT_TO || 'https://app.brightolio.com').replace(/\/+$/, '');
export const FALLBACK = () => (process.env.REDIRECT_FALLBACK || 'https://138-2-233-183.sslip.io').replace(/\/+$/, '');
// The same secret the Oracle app expects from its edge (src/edgesetup.js edgeSecret): EDGE_SECRET,
// else derived from ENCRYPTION_KEY exactly as src/crypto.js does.
export function edgeSecret(env = process.env) {
  if (env.EDGE_SECRET) return env.EDGE_SECRET;
  const k = env.ENCRYPTION_KEY || ''; if (k.length < 32) return '';
  const key = /^[0-9a-f]{64}$/i.test(k) ? Buffer.from(k, 'hex') : crypto.createHash('sha256').update(k).digest();
  return 'e' + crypto.createHmac('sha256', key).update('qp:edge-secret:v1').digest('base64url').slice(0, 32);
}
let trusted = false;
export const setTrusted = v => { trusted = v; };
export async function checkTrust() {
  const sec = edgeSecret(); if (!sec) return (trusted = false);
  try {
    const r = await fetch(FALLBACK() + '/internal/edge-check', { headers: { 'x-edge-secret': sec, 'x-edge-host': new URL(TARGET()).host }, signal: AbortSignal.timeout(15000) });
    trusted = r.ok && (await r.json()).trusted === true;
  } catch { trusted = false; }
  return trusted;
}
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'x-edge-secret', 'x-edge-host', 'x-edge-client-ip']);
function forward(req, res, p) {
  const to = new URL(FALLBACK() + p), headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;
  const ip = String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '').trim();
  Object.assign(headers, { host: to.host, 'x-edge-secret': edgeSecret(), 'x-edge-host': new URL(TARGET()).host, ...(ip ? { 'x-edge-client-ip': ip } : {}) });
  const up = (to.protocol === 'http:' ? http : https).request({ hostname: to.hostname, port: to.port || (to.protocol === 'http:' ? 80 : 443), path: to.pathname + to.search, method: req.method, headers, timeout: 120e3 }, r => {
    const out = {}; for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k)) out[k] = v;
    res.writeHead(r.statusCode || 502, out); r.pipe(res);
  });
  up.on('timeout', () => up.destroy(new Error('timeout')));
  up.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/plain' }); res.end('The Brightolio server did not answer; please try again.\n'); } else res.end(); });
  req.pipe(up);
}
export function redirectHandler(req, res) {
  const url = req.url || '/';
  const host = String(req.headers?.host || '').toLowerCase(), fwd = String(req.headers?.['x-forwarded-host'] || '').toLowerCase();
  if (url === '/healthz' || url.startsWith('/healthz?')) {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, redirect: TARGET(), forwarding: trusted, secret: !!edgeSecret(), host, forwardedHost: fwd || null }));
  }
  // Only the path and query are kept (no host header or other input goes into the address).
  const p = url.startsWith('/') && !url.startsWith('//') ? url : '/';
  // Only a request plainly for Render's own address goes to TARGET; anything else may be the main
  // address itself (Cloudflare and Render do not always pass its name on), so it never goes to TARGET.
  const renderOwn = /\.onrender\.com(:\d+)?$/.test(host) && !(fwd && !/\.onrender\.com(:\d+)?$/.test(fwd));
  const main = !renderOwn;
  if (main && trusted) return forward(req, res, p);
  const to = main ? FALLBACK() : TARGET();
  res.writeHead(301, { location: to + p, 'cache-control': main ? 'no-store' : 'public, max-age=3600', 'content-type': 'text/plain' });
  res.end('Brightolio moved to ' + to + p + '\n');
}
export function startRedirect(port = +process.env.PORT || 10000) {
  const s = http.createServer(redirectHandler);
  s.listen(port, () => console.log(`Redirect: every path → ${TARGET()}; ${new URL(TARGET()).host} is passed on to ${FALLBACK()} when trusted (port ${port})`));
  checkTrust().then(t => console.log('Forwarding the main address:', t ? 'on' : 'off (redirecting it to the server address)'));
  setInterval(checkTrust, 5 * 60e3).unref();
  return s;
}

const direct = process.argv[1] === fileURLToPath(import.meta.url);
if (direct) startRedirect();
else if (process.env.RENDER && process.env.RENDER_SERVE_APP !== '1') {
  process.env.REDIRECT_ONLY = '1';
  process.env.STANDBY = '1';
  process.env.MAINTENANCE = '1';
  process.env.DATABASE_URL = '';
  delete process.env.DATABASE_AUTH_TOKEN;
  process.env.DB_FILE = '/tmp/redirect-only.db';
  startRedirect();
}
