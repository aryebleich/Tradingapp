// Layout redesign safety harness (flag "layout_v2"). For every page at 1440, 1280, 768 and 390 px it
// records, for the current layout ("old") and, with --pair, the new layout ("new") side by side:
//   - every disclosure (legal text, risk warnings, notices): present, visible, readable, above the fold or not
//   - every figure (prices, fees, balances, P&L, percentages) as text
//   - axe-core accessibility violations, one heading-1 count, horizontal overflow, small targets
//   - a screenshot (compared pixel by pixel in compare.mjs)
// Old and new run against the same server and data; a visitor-bucket cookie picks the layout
// (flag at 50%), so the comparison is exact and needs no test-only switch in the product.
//   node test/layout/run.mjs [--pair] [--out DIR] [--only route,route] [--base https://staging-url]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startMock } from '../mock-alpaca.js';
import { bucketOf } from '../../src/flags.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PAIR = process.argv.includes('--pair');
const OUT = path.resolve(arg('--out', path.join(root, 'e2e-output/layout')));
const ONLY = arg('--only', '') ? arg('--only').split(',') : null;
const WIDTHS = [1440, 1280, 768, 390];
const HEIGHT = { 1440: 900, 1280: 800, 768: 1024, 390: 844 };
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const axeSrc = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

// A visitor id in the old bucket and one in the new bucket of the flag at 50%.
const vid = want => { for (let i = 0; ; i++) { const v = i.toString(16).padStart(16, '0'); if ((bucketOf(v, 'layout_v2') < 50) === want) return v; } };
const VARIANTS = PAIR ? [['old', vid(false)], ['new', vid(true)]] : [['old', vid(false)]];

let B = arg('--base', ''), server, mock;
if (!B) {
  mock = await startMock();
  const PORT = +arg('--port', 3170); B = `http://localhost:${PORT}`;
  server = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, PORT: String(PORT), FREE_DATA: 'off', NODE_ENV: 'test', DB_FILE: path.join(os.tmpdir(), `qp-layout-${Date.now()}.db`),
    BROKER_API_KEY: 'BKEY', BROKER_API_SECRET: 'BSECRET', BROKER_BASE_URL: mock.url, ALPACA_TRADING_URL: mock.url, ALPACA_DATA_URL: mock.url,
    ALPACA_DATA_SANDBOX_URL: mock.url, ALPACA_KEY_ID: 'DKEY', ALPACA_SECRET: 'DSECRET', ALPACA_STREAM_URL: 'ws://127.0.0.1:1' } });
  server.stderr.on('data', () => {});
  for (let i = 0; i < 60; i++) { if (await fetch(B + '/healthz').then(r => r.ok, () => false)) break; await new Promise(r => setTimeout(r, 200)); }
}
const browser = await chromium.launch();
const base = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const host = new URL(B).hostname;
const p0 = await base.newPage(); p0.on('dialog', d => d.accept());

// Test account (sandbox data only): the first account is the owner, so admin pages are covered too.
const email = process.env.LAYOUT_OWNER_EMAIL || `layout-owner-${Date.now()}@example.com`;
await p0.goto(B + '/app#/register'); await p0.fill('input[name=email]', email); await p0.fill('input[name=password]', 'Str0ngPassword');
await p0.check('input[name=agree]'); await p0.click('button:has-text("Create account")'); await p0.waitForSelector('#nav a', { state: 'attached' });
await p0.goto(B + '/app#/account'); await p0.waitForSelector('#keysForm');
await p0.fill('#keysForm [name=keyId]', 'LAYOUTKEY'); await p0.fill('#keysForm [name=secret]', 'S'); await p0.click('#keysForm button');
// Production mode refuses the mock's keys; the pages then show the paper account only (still compared).
const keys = await p0.waitForSelector('#keysForm .ok', { timeout: 15000 }).then(() => 'connected', () => 'not connected (paper data only)'); console.log('broker keys:', keys);
if (PAIR) {
  const r = await p0.evaluate(async () => (await fetch('/api/admin/site/flags', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify({ layout_v2: { on: true, pct: 50 } }) })).status);
  if (r !== 200) throw new Error('could not set the layout_v2 flag: ' + r);
}
const routes = (await p0.$$eval('#nav a[href^="#/"]', as => [...new Set(as.map(a => a.getAttribute('href').slice(2)))])).filter(r => !/^(logout)$/.test(r));
const session = (await base.cookies()).filter(c => !/qp_vb/.test(c.name));
await p0.close();

// Pages: public site, signed-out app screens, then every page in the signed-in menu.
const PAGES = [
  ...['/', '/yi', '/terms', '/privacy', '/risk', '/contact', '/status', '/security', '/insurance', '/no-such-page'].map(u => ({ id: 'site' + (u === '/' ? '/home' : u), url: u, auth: false })),
  ...['login', 'register', 'forgot', 'login-phone'].map(r => ({ id: 'out/' + r, url: '/app#/' + r, auth: false })),
  ...['dashboard', ...routes.filter(r => r !== 'dashboard')].map(r => ({ id: 'app/' + r, url: '/app#/' + r, auth: true })),
].filter(pg => !ONLY || ONLY.some(o => pg.id.includes(o)));

// Disclosure wording: legal text, risk warnings and regulatory notices.
const DISC = String.raw`risk|loss|not (a |an )?(broker|adviser|advisor|investment advice|financial advice|advice|an offer|a recommendation)|hypothetical|past performance|no guarantee|not guarantee|simulated|illustrative|disclos|FINRA|SIPC|SEC\b|regulat|terms|privacy|educational|for information|paper trading|delayed|not live|fees? (may|apply)|capital|consult|license`;

async function measure(p, width) {
  return p.evaluate(({ DISC, width }) => {
    const re = new RegExp(DISC, 'i'), H = innerHeight;
    const norm = s => s.replace(/\s+/g, ' ').trim();
    const lum = c => { const m = c.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 1]; const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return [.2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]), m[3] ?? 1]; };
    const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const a = +(c.match(/[\d.]+/g)?.[3] ?? 1); if (a > .5 && c !== 'transparent') return c; } return getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)'; };
    const ratio = (a, b) => { const [x] = lum(a), [y] = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const shown = el => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < .1 || e.hidden) return false; } const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    // Blocks whose own text is a disclosure (the smallest element holding the sentence).
    const disclosures = [];
    for (const el of document.querySelectorAll('body p, body small, body li, body footer, body div, body span, body label, body td, body figcaption, body aside, body em, body .disc, body [role=note]')) {
      if (el.closest('script,style,noscript,template,select,option,#nav,nav,[aria-hidden=true]')) continue;
      const own = norm([...el.childNodes].filter(n => n.nodeType === 3 || /^(A|B|STRONG|EM|I|SPAN|CODE)$/.test(n.nodeName) && !n.querySelector('div,p')).map(n => n.textContent).join(' '));
      if (own.length < 25 || !re.test(own)) continue;
      if ([...el.children].some(c => /^(DIV|P|LI|SECTION|TABLE|UL|OL)$/.test(c.nodeName) && re.test(c.textContent))) continue;
      const vis = shown(el), r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      disclosures.push({ text: own.slice(0, 160), visible: vis, top: Math.round(r.top + scrollY), aboveFold: vis && r.top < H, fontPx: parseFloat(cs.fontSize), contrast: +ratio(cs.color, bgOf(el)).toFixed(2), clipped: vis && el.scrollWidth > el.clientWidth + 2 && cs.overflow === 'hidden' });
    }
    // Figures: every number-like token in text (prices, fees, balances, P&L, %), clock and relative times removed.
    const figs = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      if (n.parentElement.closest('script,style,noscript,template,#nav,option,.skel,canvas,svg,[data-no-fig]')) continue;
      for (const m of n.textContent.matchAll(/[-+−]?[$€£₪]?\d[\d,]*(\.\d+)?\s?[%KMB]?/g)) {
        const around = n.textContent.slice(Math.max(0, m.index - 4), m.index + m[0].length + 4);
        if (/\b\d{1,2}:\d{2}\b|\bago\b|\bsec\b|\d\s?ms\b|\b\d+s\b|\d+h\s?\d+m\b/.test(around)) continue; // clock times (4:05), countdowns (4h 53m) and live latency (8 ms), not figures
        figs.push(m[0].replace(/\s/g, '').replace('−', '-') + '\t' + n.textContent.replace(/\s+/g, ' ').trim().slice(0, 60));
      }
    }
    const targets = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=button]')].filter(shown).filter(e => { const r = e.getBoundingClientRect(); return (r.width < 24 || r.height < 24) && !e.closest('p, li, td, footer, .gl'); }).length;
    const main = document.querySelector('#view') || document.body;
    return {
      h1: [...document.querySelectorAll('h1')].filter(shown).length,
      title: norm([...document.querySelectorAll('h1')].find(shown)?.textContent || document.title || ''),
      primary: [...main.querySelectorAll('button:not(.ghost):not(.small):not([aria-label]), .btn')].filter(shown).map(b => norm(b.textContent)).filter(Boolean).slice(0, 3),
      tables: main.querySelectorAll('table').length, forms: main.querySelectorAll('form').length, dialogs: document.querySelectorAll('dialog').length,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
      pageHeight: document.documentElement.scrollHeight, smallTargets: targets,
      disclosures, figures: figs.sort(), lv2: document.documentElement.classList.contains('lv2'),
      controls: [...main.querySelectorAll('button, input:not([type=hidden]), select, textarea, a[href]')].filter(shown).map(e => (e.name || e.id || e.textContent.trim() || e.getAttribute('aria-label') || '').trim().slice(0, 40)).filter(Boolean).sort(),
    };
  }, { DISC, width });
}

async function settle(p) {
  await p.waitForLoadState('domcontentloaded');
  await p.waitForFunction(() => !document.querySelector('#view > .skel') && document.readyState === 'complete', null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1200);
}

const results = {}, started = Date.now();
const ctxs = {};
for (const [name, v] of VARIANTS) for (const auth of [false, true]) {
  const c = await browser.newContext({ reducedMotion: 'reduce', bypassCSP: true });
  await c.addCookies([{ name: 'qp_vb', value: v, domain: host, path: '/' }, ...(auth ? session : [])]);
  ctxs[name + auth] = c;
}
const JOBS = +arg('--jobs', 4), queue = [...PAGES];
await Promise.all(Array.from({ length: JOBS }, async () => { for (let pg; (pg = queue.shift());) {
  results[pg.id] = {};
  for (const w of WIDTHS) {
    results[pg.id][w] = {};
    for (const [name] of VARIANTS) {
      const p = await ctxs[name + pg.auth].newPage(); p.on('dialog', d => d.dismiss());
      const errs = []; p.on('pageerror', e => errs.push(e.message));
      await p.setViewportSize({ width: w, height: HEIGHT[w] });
      try {
        await p.goto(B + pg.url, { waitUntil: 'domcontentloaded', timeout: 30000 }); await settle(p);
        const m = await measure(p, w);
        if (w === 1440 || w === 390) {
          await p.addScriptTag({ content: axeSrc });
          const ax = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'], resultTypes: ['violations'] })).violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, targets: v.nodes.slice(0, 5).map(n => n.target.join(' ')) })));
          m.axe = ax;
        }
        const file = `${pg.id.replace(/\W+/g, '_')}-${w}-${name}.png`;
        await p.screenshot({ path: path.join(OUT, 'shots', file), fullPage: true, timeout: 20000 }).catch(() => p.screenshot({ path: path.join(OUT, 'shots', file) }));
        m.shot = file; m.errors = errs;
        results[pg.id][w][name] = m;
      } catch (e) { results[pg.id][w][name] = { failed: e.message.split('\n')[0], errors: errs }; }
      await p.close();
    }
  }
  process.stdout.write(`${pg.id} `);
} }));
fs.writeFileSync(path.join(OUT, PAIR ? 'pair.json' : 'baseline.json'), JSON.stringify({ at: new Date().toISOString(), base: B, widths: WIDTHS, pages: PAGES, results }, null, 1));
console.log(`\n${PAGES.length} pages x ${WIDTHS.length} widths in ${Math.round((Date.now() - started) / 1000)} s → ${OUT}`);
await browser.close(); server?.kill(); mock?.close?.();
process.exit(0);
