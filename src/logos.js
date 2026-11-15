// Company logos next to tickers, on every page, in search and in scans. Served from this site
// (/logo/AAPL), so the visitor's browser never contacts another company and the content-security
// policy stays "images from this site only". The server fetches each logo once from a public logo
// source and keeps it for a week; when no source has one (a fund, a small company, crypto), a
// colored badge with the ticker's letters stands in.
//   LOGO_SOURCES  comma-separated URL patterns with {s} for the ticker (optional; the defaults are below)
//   LOGO_FETCH=off  never fetch (tests, or a server without outside access): badges only
import crypto from 'node:crypto';

const DEFAULT_SOURCES = ['https://financialmodelingprep.com/image-stock/{s}.png', 'https://assets.parqet.com/logos/symbol/{s}?format=png'];
const sources = () => (process.env.LOGO_SOURCES ? process.env.LOGO_SOURCES.split(',').map(x => x.trim()).filter(Boolean) : DEFAULT_SOURCES);
const cache = new Map(); // symbol -> { at, type, body }
const WEEK = 7 * 864e5, MAX = 3000;
export const validTicker = s => /^[A-Z][A-Z0-9.]{0,9}(\/[A-Z]{3,4})?$/.test(s);

// A badge: the first letters on a color picked from the ticker, so the same ticker always looks the same.
const CRYPTO = { BTC: ['#f7931a', '₿'], ETH: ['#627eea', 'Ξ'], SOL: ['#14f195', 'S'], DOGE: ['#c2a633', 'Ð'], LTC: ['#345d9d', 'Ł'] };
export function badge(sym) {
  const base = sym.split('/')[0], c = CRYPTO[base];
  const hue = parseInt(crypto.createHash('md5').update(base).digest('hex').slice(0, 4), 16) % 360;
  const clean = base.replace(/[^A-Z0-9]/g, ''), bg = c ? c[0] : `hsl(${hue} 55% 45%)`, txt = c ? c[1] : clean.length <= 4 ? clean : clean.slice(0, 3);
  const size = { 1: 20, 2: 15, 3: 13, 4: 11 }[txt.length] || 11;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="${bg}"/><text x="20" y="21" font-family="Inter,Arial,sans-serif" font-size="${size}" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="middle">${txt.replace(/[<&>]/g, '')}</text></svg>`;
}

async function fetchLogo(sym) {
  if (process.env.LOGO_FETCH === 'off' || process.env.FREE_DATA === 'off' || sym.includes('/')) return null;
  for (const pat of sources()) {
    try {
      const r = await fetch(pat.replace('{s}', encodeURIComponent(sym)), { signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'Mozilla/5.0 (Brightolio logo cache)' } });
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !/^image\/(png|jpe?g|webp|svg\+xml|gif)/.test(type)) continue;
      const body = Buffer.from(await r.arrayBuffer());
      if (body.length < 120 || body.length > 300000) continue; // empty placeholders and oversized files
      return { type: type.split(';')[0], body };
    } catch {}
  }
  return null;
}

export async function logo(sym) {
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < WEEK) return hit;
  const got = await fetchLogo(sym);
  const v = { at: Date.now(), ...(got || { type: 'image/svg+xml', body: Buffer.from(badge(sym)) }), real: !!got };
  if (cache.size >= MAX) cache.delete(cache.keys().next().value);
  cache.set(sym, v);
  return v;
}

const lookups = new Map(); // ip -> [windowStart, count]
function allow(ip, max = 200, win = 600e3) {
  const now = Date.now(), w = lookups.get(ip);
  if (!w || now - w[0] > win) { if (lookups.size > 10000) lookups.clear(); lookups.set(ip, [now, 1]); return true; }
  return ++w[1] <= max;
}
export function logoRoute(app) {
  app.get('/logo/:sym', async (req, res) => {
    const sym = decodeURIComponent(String(req.params.sym || '')).toUpperCase().replace('-', '/');
    if (!validTicker(sym)) return res.status(404).end();
    // Cached logos are free; each address may make the server look up at most 200 new ones in 10 minutes.
    const hit = cache.get(sym);
    if (!(hit && Date.now() - hit.at < WEEK) && !allow(req.ip)) return res.status(429).set('Retry-After', '600').end();
    const v = await logo(sym);
    res.set({ 'Content-Type': v.type, 'Cache-Control': `public, max-age=${v.real ? 604800 : 86400}`, 'X-Content-Type-Options': 'nosniff' });
    if (v.type === 'image/svg+xml') res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.send(v.body);
  });
}
