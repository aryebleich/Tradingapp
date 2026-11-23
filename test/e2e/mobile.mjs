// Mobile suite: every page of the menu, signed out and signed in, on phone sizes (iPhone and Pixel
// widths 360-414 in portrait, 740 px in landscape), light and dark, English and Yiddish (right to left).
// For each page it takes a screenshot and fails on:
//   - sideways overflow (the page is wider than the screen)
//   - more than one legal disclaimer (or none on an app page)
//   - the footer hidden under the bottom tab bar
//   - inputs under 16 px (iOS zooms in on them)
//   - tap targets under 44 px in the app's own chrome (header, tab bar, menu, page title buttons)
// Small targets inside page content are listed in the report (REPORT.md) but do not fail.
//   node test/e2e/mobile.mjs [--out DIR] [--quick] [--flows] [--only route,route] [--base URL]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { startMock } from '../mock-alpaca.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', path.join(root, 'e2e-output/mobile')));
const QUICK = process.argv.includes('--quick');
const FLOWS_ONLY = process.argv.includes('--flows'); // the phone flows only, no page sweep
const ONLY = arg('--only', '') ? arg('--only').split(',') : null;
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

// The marker of the one legal disclaimer (public/app.html <footer>): a page may hold it once only.
// The Yiddish wordings (public/i18n/yi*.js) are matched too.
const DISCLAIMER_MARK = String.raw`not a broker or investment adviser|נישט (קיין|אלס א) בראוקער`;

let B = arg('--base', ''), server, mock;
const DB_FILE = path.join(os.tmpdir(), `qp-mobile-${Date.now()}.db`);
if (!B) {
  mock = await startMock();
  const PORT = +arg('--port', 3176); B = `http://localhost:${PORT}`;
  server = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, PORT: String(PORT), FREE_DATA: 'off', NODE_ENV: 'test', DB_FILE,
    BROKER_API_KEY: 'BKEY', BROKER_API_SECRET: 'BSECRET', BROKER_BASE_URL: mock.url, ALPACA_TRADING_URL: mock.url, ALPACA_DATA_URL: mock.url,
    ALPACA_DATA_SANDBOX_URL: mock.url, ALPACA_KEY_ID: 'DKEY', ALPACA_SECRET: 'DSECRET', ALPACA_STREAM_URL: 'ws://127.0.0.1:1' } });
  server.stdout.on('data', () => {}); server.stderr.on('data', () => {});
  for (let i = 0; i < 75; i++) { if (await fetch(B + '/healthz').then(r => r.ok, () => false)) break; await new Promise(r => setTimeout(r, 200)); }
}
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});

// Phones (Chromium with each device's size, touch and pixel ratio). Pixel 5 is 393 px wide.
const D = (name, w, h) => ({ ...devices[name], viewport: { width: w, height: h } });
const PHONES = QUICK
  ? [['iPhone SE', D('iPhone SE', 375, 667)], ['Pixel 5', D('Pixel 5', 393, 727)]]
  : [['Galaxy 360', D('Galaxy S8', 360, 740)], ['iPhone SE', D('iPhone SE', 375, 667)], ['iPhone 13', D('iPhone 13', 390, 664)],
    ['Pixel 5', D('Pixel 5', 393, 727)], ['iPhone Plus 414', D('iPhone 8 Plus', 414, 736)], ['Landscape 740', D('Pixel 5', 740, 360)]];

// One test account (sandbox data only; the first account is the owner, so admin pages are covered).
const setup = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p0 = await setup.newPage(); p0.on('dialog', d => d.accept());
const email = `mobile-${Date.now()}@example.com`;
await p0.goto(B + '/app#/register'); await p0.fill('input[name=email]', email); await p0.fill('input[name=password]', 'Str0ngPassword');
await p0.check('input[name=agree]'); await p0.click('form.auth button:not([type=button])'); await p0.waitForSelector('#nav a', { state: 'attached' });
const routes = (await p0.$$eval('#nav a[href^="#/"]', as => [...new Set(as.map(a => a.getAttribute('href').slice(2)))]));
const session = await setup.cookies();
await setup.close();

const PAGES = [
  ...['login', 'register', 'forgot'].map(r => ({ id: 'out-' + r, url: '/app#/' + r, auth: false })),
  ...['dashboard', ...routes.filter(r => r !== 'dashboard')].map(r => ({ id: r.replace(/\W+/g, '_'), url: '/app#/' + r, auth: true })),
].filter(pg => !ONLY || ONLY.some(o => pg.id === o || pg.id === 'out-' + o));
// Variants: every page in light English on every phone; dark and Yiddish on two phones (not --quick: one).
const VARIANTS = [];
if (!FLOWS_ONLY) {
for (const [name, dev] of PHONES) VARIANTS.push({ phone: name, dev, scheme: 'light', lang: 'en' });
for (const [name, dev] of PHONES.slice(QUICK ? 0 : 1, QUICK ? 1 : 3)) {
  VARIANTS.push({ phone: name, dev, scheme: 'dark', lang: 'en' }, { phone: name, dev, scheme: 'light', lang: 'yi' });
}
}

async function audit(p) {
  return p.evaluate(MARK_SRC => {
    const MARK = new RegExp(MARK_SRC);
    const W = innerWidth, H = innerHeight;
    const shown = el => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || e.hidden) return false; } const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const name = e => (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' ' + (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    // The disclaimer: the smallest elements whose text holds the marker (hidden ones count too:
    // a hidden copy is one CSS rule away from showing twice).
    const disc = [...document.body.querySelectorAll('*')].filter(e => !/^(SCRIPT|STYLE|TEMPLATE)$/.test(e.tagName) && MARK.test(e.textContent) && ![...e.children].some(c => MARK.test(c.textContent)));
    // Overflow: the page, and which elements stick out past the right (or left) edge.
    const wide = document.documentElement.scrollWidth > W + 1;
    const out = wide ? [...document.querySelectorAll('#view *, header *, footer *')].filter(e => { const r = e.getBoundingClientRect(); if (!r.width || !shown(e)) return false; for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return false; } return r.right > W + 1 || r.left < -1; }).slice(0, 6).map(name) : [];
    // Tap targets. The app's chrome (header, tab bar, menu, the title's i and gear buttons) must be 44 px.
    const tappable = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, summary, [role=button], [role=tab]')].filter(shown);
    const chrome = tappable.filter(e => e.closest('#top, #tabs, #nav') || e.matches('button.pinfo, button.pgear, .hubtabs a'));
    const smallChrome = chrome.filter(e => { const r = e.getBoundingClientRect(); return (r.width < 43.5 || r.height < 43.5) && e.type !== 'checkbox'; }).map(name);
    const inline = e => e.tagName === 'A' && e.closest('p, li, td, footer, label, .small-print, .mu') && !e.closest('#nav, #tabs');
    const smallContent = tappable.filter(e => !chrome.includes(e) && !inline(e) && e.type !== 'checkbox' && e.type !== 'radio').filter(e => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).length;
    const smallInputs = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]), select, textarea')].filter(shown).filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(name);
    // The footer must end above the tab bar when the page is scrolled to the bottom.
    const tabs = document.querySelector('#tabs'), foot = document.querySelector('body > footer');
    let underTabs = false;
    if (tabs && foot && shown(tabs) && shown(foot)) { scrollTo(0, document.documentElement.scrollHeight); const fr = foot.getBoundingClientRect(), tr = tabs.getBoundingClientRect(); const last = [...foot.childNodes].filter(n => n.textContent.trim()).pop(); const rg = document.createRange(); rg.selectNodeContents(last || foot); const text = rg.getBoundingClientRect(); underTabs = text.bottom > tr.top + 1 && fr.bottom > tr.top; scrollTo(0, 0); }
    // Dialogs taller than the screen without their own scroll.
    const tallDialogs = [...document.querySelectorAll('dialog[open]')].filter(d => d.getBoundingClientRect().height > H + 1 && getComputedStyle(d).overflowY === 'visible').length;
    return { wide, scrollWidth: document.documentElement.scrollWidth, width: W, out, disclaimers: disc.length, discWhere: disc.map(name), smallChrome, smallContent, smallInputs, underTabs, tallDialogs, h: document.documentElement.scrollHeight };
  }, DISCLAIMER_MARK);
}

const results = [], started = Date.now();
const fails = [];
for (const v of VARIANTS) {
  const ctxs = {};
  for (const auth of [false, true]) {
    const c = await browser.newContext({ ...v.dev, colorScheme: v.scheme, reducedMotion: 'reduce' });
    await c.addInitScript(([lang]) => { try { localStorage.setItem('qp_lang', lang); localStorage.setItem('qp_guides', 'off'); } catch {} }, [v.lang]);
    if (auth) await c.addCookies(session);
    ctxs[auth] = c;
  }
  const tag = `${v.phone}${v.scheme === 'dark' ? ' dark' : ''}${v.lang === 'yi' ? ' yi' : ''}`;
  const queue = [...PAGES];
  await Promise.all(Array.from({ length: +arg('--jobs', 4) }, async () => { for (let pg; (pg = queue.shift());) {
    const p = await ctxs[pg.auth].newPage(); p.on('dialog', d => d.dismiss());
    const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
    let r;
    try {
      await p.goto(B + pg.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.waitForFunction(() => !document.querySelector('#view > .skel') && document.readyState === 'complete', null, { timeout: 15000 }).catch(() => {});
      await p.waitForTimeout(900);
      r = await audit(p);
      const file = `${pg.id}-${tag.replace(/\W+/g, '_')}.png`;
      await p.screenshot({ path: path.join(OUT, 'shots', file), fullPage: true, timeout: 20000 }).catch(() => p.screenshot({ path: path.join(OUT, 'shots', file) }));
      r.shot = file;
    } catch (e) { r = { failed: e.message.split('\n')[0] }; }
    r.page = pg.id; r.variant = tag; r.errors = errs; results.push(r);
    const at = `${pg.id} @ ${tag}`;
    if (r.failed) fails.push(`${at}: did not load (${r.failed})`);
    else {
      if (r.wide) fails.push(`${at}: ${r.scrollWidth}px wide on a ${r.width}px screen (${r.out.join(' | ')})`);
      if (r.disclaimers > 1) fails.push(`${at}: ${r.disclaimers} disclaimers (${r.discWhere.join(' | ')})`);
      if (r.disclaimers < 1) fails.push(`${at}: no disclaimer`);
      if (r.underTabs) fails.push(`${at}: the footer ends under the bottom tab bar`);
      if (r.smallInputs.length) fails.push(`${at}: inputs under 16 px (${r.smallInputs.slice(0, 3).join(' | ')})`);
      if (r.smallChrome.length) fails.push(`${at}: tap targets under 44 px (${[...new Set(r.smallChrome)].slice(0, 4).join(' | ')})`);
      if (r.tallDialogs) fails.push(`${at}: a dialog taller than the screen that cannot scroll`);
    }
    await p.close();
  } }));
  for (const c of Object.values(ctxs)) await c.close();
  process.stdout.write(`${tag}: ${PAGES.length} pages\n`);
}
// ---------- the important flows on a phone, start to finish (iPhone SE size) ----------
const flowLog = [];
if (!ONLY) {
  const ctx = await browser.newContext({ ...D('iPhone SE', 375, 667), reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { localStorage.setItem('qp_guides', 'off'); } catch {} });
  const p = await ctx.newPage();
  let native = null, dismissNative = false;
  p.on('dialog', d => { native = d.message(); return dismissNative ? d.dismiss() : d.accept(); });
  const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  const fits = async what => { const a = await audit(p); if (a.wide) throw new Error(`${what}: ${a.scrollWidth}px wide`); if (a.smallInputs.length) throw new Error(`${what}: inputs under 16 px`); };
  const dlgFits = async what => {
    const d = await p.evaluate(() => { const d = document.querySelector('dialog[open]'); if (!d) return null; const r = d.getBoundingClientRect(), s = getComputedStyle(d);
      const close = [...d.querySelectorAll('button')].some(b => /cancel|close|✕|no\b|back/i.test(b.textContent + ' ' + (b.getAttribute('aria-label') || '')));
      return { h: r.height, top: r.top, w: r.width, vh: innerHeight, vw: innerWidth, scroll: d.scrollHeight > d.clientHeight + 1 ? s.overflowY : 'fits', close }; });
    if (!d) throw new Error(`${what}: no dialog`);
    if (d.w > d.vw + 1) throw new Error(`${what}: dialog ${d.w}px wide on ${d.vw}px`);
    if (d.h > d.vh + 1 || (d.scroll !== 'fits' && !/auto|scroll/.test(d.scroll))) throw new Error(`${what}: dialog ${d.h}px tall on ${d.vh}px and cannot scroll`);
    if (!d.close) throw new Error(`${what}: dialog has no Cancel or Close button`);
  };
  const flow = async (name, fn) => {
    try { await fn(); flowLog.push(`- ✓ ${name}`); } catch (e) { fails.push(`flow "${name}": ${e.message.split('\n')[0]}`); flowLog.push(`- ✗ ${name}: ${e.message.split('\n')[0]}`); await p.screenshot({ path: path.join(OUT, 'shots', `FLOW-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {}); }
  };
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const user = `phone-flow-${Date.now()}@example.com`;
  await flow('sign up', async () => {
    await p.goto(B + '/app#/register'); await fits('sign-up page');
    await p.fill('input[name=email]', user); await p.fill('input[name=password]', 'Str0ngPassword'); await p.check('input[name=agree]');
    await p.tap('form.auth button:not([type=button])'); await p.waitForSelector('#tabs a.on', { timeout: 15000 });
  });
  await flow('add a passkey', async () => {
    await p.goto(B + '/app#/security'); await p.waitForSelector('#addPk', { timeout: 15000 }); await fits('security page');
    await p.tap('#addPk'); await p.waitForFunction(() => /My device/.test(document.querySelector('#view')?.textContent || '') && document.querySelectorAll('[data-rm]').length > 0, null, { timeout: 15000 });
  });
  await flow('sign out from the menu, sign in with the password', async () => {
    await p.tap('#moreTab'); await p.waitForSelector('#nav.open'); await p.tap('#navLogout'); await p.waitForURL(u => u.pathname === '/', { timeout: 15000 });
    await p.goto(B + '/app#/login'); await p.waitForSelector('input[name=email]'); await fits('sign-in page');
    await p.fill('input[name=email]', user); await p.fill('input[name=password]', 'Str0ngPassword'); await p.tap('form.auth button:not([type=button])');
    await p.waitForSelector('#tabs a.on', { timeout: 15000 });
  });
  await flow('sign in with the passkey', async () => {
    await p.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: '{}' }));
    await p.goto(B + '/'); await p.goto(B + '/app#/login'); await p.waitForSelector('#pkLogin'); await p.tap('#pkLogin'); await p.waitForSelector('#tabs a.on', { timeout: 15000 });
  });
  await flow('the side menu closes after a tap on a page', async () => {
    await p.goto(B + '/app#/dashboard'); await p.waitForSelector('#tabs a.on');
    await p.tap('#moreTab'); await p.waitForSelector('#nav.open');
    const link = await p.$('#nav .navcore a[href^="#/"]:not(.on)') || await p.$('#nav a[href^="#/"]:not(.on)'); const href = await link.getAttribute('href');
    await link.tap(); await p.waitForFunction(h => location.hash.startsWith(h), href, { timeout: 10000 }); await p.waitForTimeout(400);
    if (await p.isVisible('#nav.open')) throw new Error('the menu stayed open after tapping ' + href);
  });
  await flow('dashboard', async () => { await p.goto(B + '/app#/dashboard'); await p.waitForSelector('#view h1'); await fits('dashboard'); });
  await flow('order ticket with the company overview, review, cancel', async () => {
    await p.goto(B + '/app#/trade?symbol=AAPL'); await p.waitForSelector('#ticket [name=qty]', { timeout: 15000 }); await p.waitForTimeout(800); await fits('order ticket');
    if (!(await p.$('#qCard'))) throw new Error('no quote and company card next to the ticket');
    await p.fill('#ticket [name=qty]', '1');
    // The review is the browser's own confirm (it always fits the screen) or a dialog of ours; both are
    // cancelled here, so no order is placed.
    native = null; dismissNative = true;
    await p.tap('#qPlace');
    await p.waitForFunction(() => document.querySelector('dialog[open]'), null, { timeout: 8000 }).catch(() => {});
    dismissNative = false;
    if (await p.$('dialog[open]')) { await dlgFits('order review'); await p.keyboard.press('Escape'); await p.waitForTimeout(300); }
    else if (!native) throw new Error('Review order opened no confirmation');
  });
  await flow('equalize positions with the checkboxes', async () => {
    // Equalize on Positions works on a brokerage account: the Alpaca mock's (test data), holding two stocks.
    const post = (u, b) => p.evaluate(([u, b]) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify(b) }).then(async r => r.status + ' ' + (await r.text()).slice(0, 120)), [u, b]);
    const said = [await post('/api/alpaca/keys', { keyId: 'MOBILEFLOW', secret: 'S' })];
    if (mock) mock.autoFill = true; // the mock fills market orders at once, like Alpaca (test data)
    for (const sym of ['MSFT', 'SPY']) said.push(await post('/api/orders', { account: 'alpaca', symbol: sym, side: 'buy', type: 'market', qty: 2 }));
    if (mock) mock.autoFill = false;
    await p.evaluate(() => localStorage.setItem('qp_account', 'alpaca'));
    await p.goto(B + '/app#/positions'); await p.reload(); await p.waitForSelector('#eqPos', { timeout: 15000 }).catch(() => { throw new Error('no Equalize button; setup: ' + said.join(' | ')); }); await p.tap('#eqPos'); await p.waitForSelector('#eqPosF'); await fits('equalize form');
    const box = await p.$eval('#eqPosF [name=wholeShares]', e => { const l = e.closest('label').getBoundingClientRect(); return l.height; });
    if (box < 24) throw new Error(`the "Whole shares only" checkbox row is ${box}px tall`);
    await p.tap('#eqPosF [name=wholeShares]'); await p.tap('#eqPosF button:not([type=button])');
    await p.waitForFunction(() => document.querySelector('dialog[open]') || /\S/.test(document.querySelector('#eqPosOut')?.textContent || ''), null, { timeout: 15000 });
    if (!(await p.$('dialog[open]'))) throw new Error('no confirmation: ' + (await p.textContent('#eqPosOut')).slice(0, 120));
    await dlgFits('equalize confirm');
    // The checkboxes: one per holding and "all"; each a finger-sized row, and leaving one out updates the plan.
    const rows = await p.$$eval('dialog[open] input[type=checkbox]', bs => bs.filter(b => b.offsetParent).map(b => Math.round((b.closest('label, tr, li, .row') || b).getBoundingClientRect().height)));
    if (rows.length < 3) throw new Error(`${rows.length} checkboxes in the equalize dialog`);
    if (rows.some(h => h < 24)) throw new Error(`checkbox rows under 24 px: ${rows.join(', ')}`);
    const before = await p.textContent('#eqpCount');
    await p.tap('dialog[open] #eqpRows input[type=checkbox] >> nth=0');
    await p.waitForFunction(b => document.querySelector('#eqpCount')?.textContent !== b, before, { timeout: 5000 });
    await p.keyboard.press('Escape');
  });
  for (const [name, hash] of [['alerts', '#/alerts'], ['Playbooks', '#/playbooks'], ['settings', '#/settings'], ['admin', '#/admin']]) {
    await flow(name, async () => { await p.goto(B + '/app' + hash); await p.waitForSelector('#view h1', { timeout: 15000 }); await p.waitForTimeout(700); await fits(name); });
  }
  if (errs.length) flowLog.push(`- script errors during the flows: ${[...new Set(errs)].slice(0, 5).join(' | ')}`);
  await ctx.close();
}

const md = [`# Mobile suite\n\n${PAGES.length} pages × ${VARIANTS.length} phone variants in ${Math.round((Date.now() - started) / 1000)} s.\n`,
  `**Result: ${fails.length ? 'FAIL' : 'PASS'}**\n`, `## Phone flows\n`, ...flowLog, ``, `## Failures (${fails.length})\n`, ...(fails.length ? fails.map(f => '- ' + f) : ['- none']),
  `\n## Small targets inside page content (information, under 24 px)\n`,
  ...results.filter(r => r.smallContent).sort((a, b) => b.smallContent - a.smallContent).slice(0, 40).map(r => `- ${r.page} @ ${r.variant}: ${r.smallContent}`),
  `\n## Script errors (information)\n`, ...results.filter(r => r.errors?.length).slice(0, 40).map(r => `- ${r.page} @ ${r.variant}: ${r.errors[0]}`)].join('\n');
fs.writeFileSync(path.join(OUT, 'REPORT.md'), md + '\n');
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
console.log(fails.length ? `FAIL (${fails.length}):\n${fails.slice(0, 60).join('\n')}` : 'PASS', `→ ${path.join(OUT, 'REPORT.md')}`);
await browser.close(); server?.kill(); mock?.close?.();
try { for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith(path.basename(DB_FILE))) fs.rmSync(path.join(os.tmpdir(), f)); } catch {}
process.exit(fails.length ? 1 : 0);
