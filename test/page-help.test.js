// Page help (pages/guides.js addInfo): every menu page has guide text and exactly one round "i" in its
// title row, also after a redraw; no guide card is drawn into a page; the panel shows the page's guide
// and marks it as seen; the first-time hint shows only until then.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const grab = name => { const i = app.indexOf(name); let d = 0; const j = app.indexOf('=', i) + 1; for (let k = j; k < app.length; k++) { const c = app[k]; if (c === '[' || c === '{') d++; else if (c === ']' || c === '}') { d--; if (d === 0) return app.slice(j, k + 1); } } };
const CORE = eval(grab('const CORE')), NAV = eval(grab('const NAV')), HUBS = eval('(' + grab('const HUBS') + ')');
const MENU = [...new Set([...CORE.map(x => x[0]), ...NAV.flatMap(g => g[1].map(x => x[0]))])];
const ALL = [...new Set([...MENU, ...Object.values(HUBS).flatMap(h => h[1].map(x => x[0]))])];

test('every menu page and tab has guide text, in plain words', async () => {
  const { guideFor } = await import('../public/pages/guides.js');
  for (const r of ALL) {
    const g = guideFor(r); assert.ok(g, `no guide for ${r}`);
    assert.ok(g[0] && g[1] && g[1].length > 20, r); assert.ok(Array.isArray(g[2]), r);
  }
});

test('the guide card is gone from pages; the inline beginner cards moved into the panel', () => {
  const guides = fs.readFileSync(new URL('../public/pages/guides.js', import.meta.url), 'utf8');
  assert.doesNotMatch(guides, /className = 'pguide/); assert.doesNotMatch(app, /data-slot="guide"/);
  assert.doesNotMatch(fs.readFileSync(new URL('../public/pages/wealth.js', import.meta.url), 'utf8'), /class="card lesson"/);
});

let srv, browser;
async function launch() {
  const { chromium } = await import('playwright');
  for (const executablePath of [process.env.PW_CHROME, '/opt/pw-browsers/chromium', undefined].filter((x, i, a) => a.indexOf(x) === i)) { try { return await chromium.launch(executablePath ? { executablePath } : {}); } catch {} }
  return null;
}
before(async () => { browser = await launch(); if (browser) { const { serve } = await import('./client.js'); srv = await serve(); } });
after(async () => { await browser?.close(); srv?.close(); });

async function signedIn(email) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(srv.base + '/app#/register');
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', 'Str0ngPassword'); await page.check('input[name=agree]');
  await page.click('button:has-text("Create account")'); await page.waitForSelector('.st-card, #homeClock', { timeout: 15000 });
  if (await page.$('#stExit')) await page.click('#stExit');
  await page.waitForSelector('#homeClock');
  return page;
}
const settle = page => page.waitForFunction(() => !document.querySelector('#view .skel') || document.querySelector('#view h1 .pinfo'), null, { timeout: 8000 }).catch(() => {}).then(() => page.waitForTimeout(250));

test('every menu page: exactly one "i" in the title row (before the gear), also after a redraw; no guide card', { timeout: 300000 }, async t => {
  if (!browser) return t.skip('no browser available here');
  const page = await signedIn('help-all@example.com'), bad = [];
  for (const r of ALL) {
    await page.evaluate(r => { location.hash = '#/' + r; }, r); await settle(page);
    const one = async () => page.evaluate(() => ({ n: document.querySelectorAll('.pinfo').length, inTitle: !!document.querySelector('#view h1 .pinfo'), gearAfter: (() => { const g = document.querySelector('#view h1 .pgear'), i = document.querySelector('#view h1 .pinfo'); return !g || !!(i && (i.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING)); })(), cards: document.querySelectorAll('.pguide').length }));
    const a = await one();
    await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange'))); await settle(page); await page.waitForTimeout(200);
    const b = await one();
    for (const [when, x] of [['first', a], ['redraw', b]]) if (x.n !== 1 || !x.inTitle || !x.gearAfter || x.cards) bad.push(`${r} ${when} ${JSON.stringify(x)}`);
  }
  await page.close();
  assert.deepEqual(bad, []);
});

test('the panel shows the page\'s guide, closes with Esc and returns focus; the hint shows only until seen', async t => {
  if (!browser) return t.skip('no browser available here');
  const page = await signedIn('help-panel@example.com');
  await page.evaluate(() => { location.hash = '#/options'; }); await settle(page);
  assert.equal(await page.locator('#view h1 .pinfo.new').count(), 1); // not seen yet: the dot
  await page.click('#view h1 .pinfo');
  await page.waitForSelector('dialog#infoDlg[open]');
  assert.match(await page.textContent('#infoDlg'), /The options chain/); assert.match(await page.textContent('#infoDlg'), /Good to know/);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  assert.equal(await page.locator('dialog#infoDlg').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('pinfo')), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('qp_guide_options')), 'seen');
  // Seen: no dot, no hint, after another visit.
  await page.evaluate(() => { location.hash = '#/orders'; }); await settle(page);
  await page.evaluate(() => { location.hash = '#/options'; }); await settle(page);
  assert.equal(await page.locator('#view h1 .pinfo.new').count(), 0); assert.equal(await page.locator('.pinfo-hint').count(), 0);
  // A click outside closes it too.
  await page.click('#view h1 .pinfo'); await page.waitForSelector('dialog#infoDlg[open]');
  await page.mouse.click(10, 450); await page.waitForTimeout(150);
  assert.equal(await page.locator('dialog#infoDlg').count(), 0);
  // The Settings switch turns off the hint only; the "i" stays.
  await page.evaluate(() => { localStorage.setItem('qp_guides', 'off'); location.hash = '#/margin'; }); await settle(page);
  assert.equal(await page.locator('#view h1 .pinfo').count(), 1); assert.equal(await page.locator('#view h1 .pinfo.new').count(), 0);
  await page.close();
});

test('Yiddish for every new guide text and the help wording', async () => {
  const yi = await import('../public/i18n/yi.js'), { MORE } = await import('../public/pages/guides-more.js');
  const miss = Object.values(MORE).flatMap(([t, w, st, c]) => [t, w, ...st, c]).filter(x => !yi.strings[x]);
  assert.deepEqual(miss, []);
  for (const k of ['How this page works', 'New here? Tap i']) assert.ok(yi.strings[k], k);
});
