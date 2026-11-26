// The Home clock and the shared market calendar (public/market-calendar.js, also used by the server):
// closed on weekends and NYSE holidays, 1 PM early closes, one label everywhere, /desk/session agrees,
// and Home keeps exactly one clock and one timer however often it is drawn.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isTradingDay, holidayName, earlyClose, marketStatus, marketState, nextTradingDay } from '../public/market-calendar.js';
import * as server from '../src/market-calendar.js';
import { session } from '../src/desk.js';
import { nyAt } from '../src/time.js';

const CLOSED = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': "Washington's Birthday", '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth', '2026-07-03': 'Independence Day' /* July 4 is a Saturday */, '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving Day', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': "Washington's Birthday", '2027-03-26': 'Good Friday',
  '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth' /* June 19 is a Saturday */, '2027-07-05': 'Independence Day' /* July 4 is a Sunday */,
  '2027-09-06': 'Labor Day', '2027-11-25': 'Thanksgiving Day', '2027-12-24': 'Christmas Day' /* December 25 is a Saturday */,
};

test('one calendar: the server re-exports the browser file', () => {
  assert.equal(server.isTradingDay, isTradingDay);
  assert.ok(!fs.existsSync(new URL('../src/market-calendar.js', import.meta.url)) || /export \* from '\.\.\/public\/market-calendar\.js'/.test(fs.readFileSync(new URL('../src/market-calendar.js', import.meta.url), 'utf8')));
  assert.doesNotMatch(fs.readFileSync(new URL('../src/desk.js', import.meta.url), 'utf8'), /'2026-11-26'/); // no second holiday list
});

test('closed on weekends and every 2026-2027 holiday, with its name', () => {
  for (const d of ['2026-11-21', '2026-11-22', '2027-03-06', '2027-03-07']) assert.equal(isTradingDay(d), false, d);
  for (const [d, name] of Object.entries(CLOSED)) { assert.equal(isTradingDay(d), false, d); assert.equal(holidayName(d), name, d); }
  // The day after each holiday that falls on a weekend is a normal trading day.
  assert.equal(isTradingDay('2026-07-06'), true); assert.equal(isTradingDay('2027-06-21'), true);
});

test('early close at 1 PM: the day after Thanksgiving and Christmas Eve', () => {
  for (const d of ['2026-11-27', '2027-11-26', '2026-12-24']) assert.equal(earlyClose(d), 780, d);
  assert.equal(earlyClose('2027-12-24'), null); // a full holiday that year (Christmas observed)
  assert.equal(earlyClose('2026-11-24'), null);
});

const at = (day, h, m = 0) => nyAt(day, h * 60 + m);
test('marketState with no server answer: closed on weekends and holidays, with the next open', () => {
  assert.equal(marketState(at('2026-11-21', 12)).label, 'Market closed: weekend · opens Monday 9:30 AM');
  assert.equal(marketState(at('2026-11-22', 12)).label, 'Market closed: weekend · opens Monday 9:30 AM');
  assert.equal(marketState(at('2026-11-26', 10)).label, 'Market closed: Thanksgiving Day · opens Friday 9:30 AM (closes early, 1 PM)');
  for (const d of Object.keys(CLOSED)) for (const h of [5, 10, 17]) assert.equal(marketState(at(d, h)).status, 'closed', `${d} ${h}:00`);
  assert.equal(marketState(at('2026-11-24', 10)).label, 'Market open · closes 4:00 PM');
  assert.equal(marketState(at('2026-11-24', 8)).label, 'Pre-market · opens 9:30 AM');
  assert.equal(marketState(at('2026-11-24', 17)).label, 'After hours · opens tomorrow 9:30 AM');
  // Early-close day: open until 1 PM, after hours until 5 PM only.
  assert.equal(marketState(at('2026-11-27', 12)).label, 'Market open · closes 1:00 PM (early close)');
  assert.equal(marketState(at('2026-11-27', 14)).label, 'After hours · opens Monday 9:30 AM');
  assert.equal(marketState(at('2026-11-27', 17, 30)).status, 'closed');
  assert.equal(marketState(at('2026-04-03', 9)).label, 'Market closed: Good Friday · opens Monday 9:30 AM');
  // A server answer wins while it holds.
  assert.equal(marketState(at('2026-11-24', 10), { status: 'closed', label: 'x', until: at('2026-11-24', 11) }).label, 'x');
  assert.equal(nextTradingDay('2026-11-25'), '2026-11-27');
});

test('/desk/session agrees: closed with the holiday name on holidays, closed on weekends', () => {
  const h = session(at('2026-11-26', 11));
  assert.equal(h.open, false); assert.equal(h.status, 'closed'); assert.equal(h.holiday, true); assert.equal(h.holidayName, 'Thanksgiving Day');
  assert.match(h.label, /Thanksgiving Day/); assert.equal(h.nextOpen, at('2026-11-27', 9, 30)); assert.equal(h.nextClose, at('2026-11-27', 13));
  const w = session(at('2026-11-21', 11)); assert.equal(w.status, 'closed'); assert.equal(w.weekend, true); assert.equal(w.nextOpen, at('2026-11-23', 9, 30));
  const e = session(at('2026-11-27', 12)); assert.equal(e.open, true); assert.equal(e.earlyClose, true); assert.equal(e.nextClose, at('2026-11-27', 13));
  assert.equal(session(at('2026-11-24', 10)).label, marketStatus(at('2026-11-24', 10)).label);
});

// ---------- in a real browser: one clock and one timer ----------
let srv, browser;
async function launch() {
  const { chromium } = await import('playwright');
  const paths = [process.env.PW_CHROME, '/opt/pw-browsers/chromium', undefined].filter((x, i, a) => a.indexOf(x) === i);
  for (const executablePath of paths) { try { return await chromium.launch(executablePath ? { executablePath } : {}); } catch {} }
  return null;
}
before(async () => { browser = await launch(); if (browser) { const { serve } = await import('./client.js'); srv = await serve(); } });
after(async () => { await browser?.close(); srv?.close(); });

test('Home drawn again and again keeps exactly one #homeClock and one running timer', async t => {
  if (!browser) return t.skip('no browser available here');
  const page = await browser.newPage();
  // Count the clock's 1-second timers: pending setTimeout calls made by its `loop`.
  await page.addInitScript(() => {
    const live = new Set(), st = window.setTimeout, ct = window.clearTimeout;
    window.__clockTimers = () => live.size;
    window.setTimeout = (fn, ms, ...a) => { const src = typeof fn === 'function' ? String(fn) : ''; if (!/isConnected/.test(src) || !/%\s*(1e3|1000)/.test(src)) return st(fn, ms, ...a); /* the clock's loop, minified or not */ const id = st(() => { live.delete(id); fn(...a); }, ms); live.add(id); return id; };
    window.clearTimeout = id => { live.delete(id); return ct(id); };
  });
  await page.goto(srv.base + '/app#/register');
  await page.fill('input[name=email]', 'clock@example.com'); await page.fill('input[name=password]', 'Str0ngPassword'); await page.check('input[name=agree]');
  await page.click('button:has-text("Create account")'); await page.waitForSelector('.st-card, #homeClock', { timeout: 15000 });
  if (await page.$('#stExit')) await page.click('#stExit');
  await page.waitForSelector('#homeClock');
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => { location.hash = '#/orders'; }); await page.waitForTimeout(250);
    await page.evaluate(() => { location.hash = '#/'; }); await page.waitForSelector('#homeClock'); await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#homeClock').count(), 1);
  assert.equal(await page.evaluate(() => window.__clockTimers()), 1);
  // The clock keeps time: at every look it shows this second (or the one just before, as it ticks
  // once a second), and over the looks it moves on. The test's own looks may drift under load, so
  // each one is compared with the time it was taken, not with the previous look.
  const looks = [];
  for (let i = 0; i < 4; i++) { looks.push(await page.evaluate(() => [new Date().getSeconds(), document.querySelector('#homeClock .hc-time').textContent])); await page.waitForTimeout(1000); }
  const shown = looks.map(([, text]) => +(/:(\d{2})(?!.*:\d{2})/.exec(text) || [])[1]);
  looks.forEach(([now], i) => assert.ok([0, 1].includes((now - shown[i] + 60) % 60), `look ${i + 1}: the clock shows second ${shown[i]} at second ${now} (${looks.map(l => l.join('=')).join(' ')})`));
  assert.notEqual(shown[0], shown.at(-1), 'the clock moved on over the looks');
  await page.close();
});

test('Yiddish: the clock labels translate, and function patterns get the match groups', async () => {
  const yi = await import('../public/i18n/yi.js');
  const tr = key => { for (const [re, rep] of yi.patterns) { const m = key.match(re); if (m) return typeof rep === 'function' ? key.slice(0, m.index) + rep(m) + key.slice(m.index + m[0].length) : key.replace(re, rep); } return key; };
  for (const [d, h] of [['2026-11-21', 12], ['2026-11-26', 11], ['2026-11-27', 12], ['2026-11-24', 8], ['2026-11-24', 17], ['2026-11-24', 10]]) {
    const label = marketStatus(at(d, h)).label, y = tr('New York 11:00:02 AM · ' + label);
    assert.doesNotMatch(y, /undefined|Market|opens|closes/, `${label} → ${y}`); assert.match(y, /ניו יארק/);
  }
  assert.equal(tr('K-1 for 2026'), 'K-1 פאר 2026');
});
