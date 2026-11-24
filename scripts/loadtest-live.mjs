// Read-only load test of the live server (PERFORMANCE.md; .github/workflows/load-test.yml runs it against the
// Oracle server from GitHub Actions). Read-only: it never places an order or changes anything.
//   1. A real browser opens the common pages (sign-in, dashboard, positions, orders, trade, scanner,
//      a stock page, news) with the load-test account and records every API call they make.
//   2. USERS simulated people (default 200) replay those calls for SECONDS, each with a short pause
//      between calls, over keep-alive connections, and every answer is timed.
//   3. Prints p50/p95/p99 per route, the error and shed counts, and writes the numbers as JSON.
// Env: BASE (the server), LOADTEST_TOKEN (its CRON_SECRET: a session for the paper-only test account,
// and the server's own address is not redirected), USERS, SECONDS, OUT (a JSON file), PW_CHROME.
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = process.env.LOADTEST_TOKEN || '';
const USERS = +(process.env.USERS || 200), SECONDS = +(process.env.SECONDS || 60), OUT = process.env.OUT || 'loadtest.json';
const extra = TOKEN ? { 'x-qp-loadtest': TOKEN } : {};

// A session for the load-test account (paper only).
let cookie = process.env.LOADTEST_COOKIE || '';
if (!cookie && TOKEN) {
  const r = await fetch(BASE + '/internal/loadtest-session', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, ...extra } });
  if (!r.ok) throw new Error('no load-test session: ' + r.status);
  cookie = (await r.json()).cookie;
}

// 1. The calls the common pages make.
const PAGES = ['/app#/login', '/app#/dashboard', '/app#/positions', '/app#/orders', '/app#/trade?symbol=AAPL', '/app#/scanner', '/app#/analyze?symbol=AAPL', '/app#/news', '/app#/markets'];
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ extraHTTPHeaders: extra });
if (cookie) { const [k, v] = cookie.split('='); await ctx.addCookies([{ name: k, value: v, url: BASE }]); }
const seen = new Map(); // path -> kind
for (const pg of PAGES) {
  const p = await ctx.newPage();
  p.on('request', q => {
    const u = new URL(q.url()); if (u.origin !== new URL(BASE).origin || q.method() !== 'GET') return;
    const kind = u.pathname.startsWith('/api/') ? 'api' : /\.(js|css|woff2|png|svg|webmanifest)$/.test(u.pathname) ? 'static' : 'page';
    if (!/\/(events|stream|sse)\b/.test(u.pathname)) seen.set(u.pathname + u.search, kind);
  });
  await p.goto(BASE + pg.replace(/^\/app#/, '/app#'), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(4000); await p.close();
}
await browser.close();
const CALLS = [...seen].map(([path, kind]) => ({ path, kind })).filter(c => !/\/auth\/(logout|google|github)/.test(c.path));
console.log(`${CALLS.length} distinct GET calls from ${PAGES.length} pages (${CALLS.filter(c => c.kind === 'api').length} API)`);

// 2. The load.
const T = new Map(), codes = {}; let shed = 0, errors = 0, total = 0;
const until = Date.now() + SECONDS * 1000;
const key = path => path.split('?')[0].replace(/\/(bundle\/)?[\w-]+-[A-Za-z0-9]{6,}\.(js|css)$/, '/$1<hashed>.$2');
async function person(i) {
  let n = i;
  while (Date.now() < until) {
    const c = CALLS[n++ % CALLS.length], t0 = performance.now();
    try {
      const r = await fetch(BASE + c.path, { headers: { cookie, 'x-requested-with': 'qp', ...extra }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
      const body = await r.text();
      const ms = performance.now() - t0; total++;
      codes[r.status] = (codes[r.status] || 0) + 1;
      if (r.status === 503 && /"shed":true/.test(body)) shed++;
      if (r.status >= 500) errors++;
      const k = key(c.path); let a = T.get(k); if (!a) T.set(k, (a = { kind: c.kind, d: [] })); a.d.push(ms);
    } catch { errors++; total++; }
    await new Promise(r => setTimeout(r, 50 + Math.random() * 250)); // a person reads for a moment
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: USERS }, (_, i) => person(i)));
const secs = (Date.now() - t0) / 1000;

// 3. The numbers.
const q = (s, p) => s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(0) : null;
const routes = [...T].map(([route, a]) => { const s = a.d.sort((x, y) => x - y); return { route, kind: a.kind, n: s.length, p50: q(s, 0.5), p95: q(s, 0.95), p99: q(s, 0.99) }; }).sort((a, b) => b.n - a.n);
const all = [...T.values()].flatMap(a => a.d).sort((x, y) => x - y);
const byKind = k => { const s = [...T.values()].filter(a => a.kind === k).flatMap(a => a.d).sort((x, y) => x - y); return { n: s.length, p50: q(s, 0.5), p95: q(s, 0.95), p99: q(s, 0.99) }; };
const out = { at: new Date().toISOString(), base: BASE, users: USERS, seconds: Math.round(secs), requests: total, perSecond: Math.round(total / secs), errors, shed, codes,
  overall: { p50: q(all, 0.5), p95: q(all, 0.95), p99: q(all, 0.99) }, api: byKind('api'), static: byKind('static'), page: byKind('page'), routes };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`${total} requests in ${Math.round(secs)} s (${out.perSecond}/s) by ${USERS} users: p50 ${out.overall.p50} ms, p95 ${out.overall.p95} ms, p99 ${out.overall.p99} ms; errors ${errors}, shed ${shed}; codes ${JSON.stringify(codes)}`);
console.log(`API p95 ${out.api.p95} ms, static p95 ${out.static.p95} ms, pages p95 ${out.page.p95} ms`);
for (const r of routes.slice(0, 30)) console.log(`${String(r.n).padStart(6)}  p50 ${String(r.p50).padStart(5)}  p95 ${String(r.p95).padStart(5)}  p99 ${String(r.p99).padStart(5)}  ${r.route}`);
