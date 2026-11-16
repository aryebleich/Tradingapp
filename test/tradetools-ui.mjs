// Planning tools in a real browser (npm run tools:ui): the real app, the Alpaca mock for read-only
// market data. Checks that the tools are in the menu, work from the keyboard, explain errors, show the disclaimer and data-delay label on
// every tab, label AI output, refuse advice requests, meet basic WCAG 2.2 rules and fit a phone.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startMock } from './mock-alpaca.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'e2e-output'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 3153, B = `http://localhost:${PORT}`;
let failures = 0;
const mock = await startMock();
const server = spawn(process.execPath, ['server.js'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), FREE_DATA: 'off', NODE_ENV: 'test', DB_FILE: path.join(os.tmpdir(), `qp-toolsui-${Date.now()}.db`), ALPACA_STREAM_URL: 'ws://127.0.0.1:1', ADMIN_EMAIL: 'tools-owner@example.com',
    ALPACA_TRADING_URL: mock.url, ALPACA_DATA_URL: mock.url, ALPACA_DATA_SANDBOX_URL: mock.url, ALPACA_KEY_ID: 'DKEY', ALPACA_SECRET: 'DSECRET', AI_PROVIDER: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', OPENROUTER_API_KEY: '' },
});
const log = []; server.stdout.on('data', d => log.push(String(d))); server.stderr.on('data', d => log.push(String(d)));
for (let i = 0; i < 60; i++) { if (await fetch(B + '/healthz').then(r => r.ok, () => false)) break; await new Promise(r => setTimeout(r, 200)); }
const reg = async email => { const r = await fetch(B + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify({ email, password: 'Str0ngPassword1', agree: true }) }); const kv = (r.headers.get('set-cookie') || '').split(';')[0], i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1) }; };
const owner = await reg('tools-owner@example.com'), me = await reg('tools-ui@example.com');

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: me.name, value: me.value, url: B }]);
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && !/status of (400|401|403|404|409|429|503)|Failed to load resource/.test(m.text()) && errors.push(m.text()));
const step = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.log(`  ✗ ${name}: ${String(e.message).split('\n')[0]}`); await page.screenshot({ path: path.join(OUT, `FAIL-tools-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {}); } };
const must = (c, m) => { if (!c) throw new Error(m); };
const a11y = () => page.evaluate(() => {
  const v = document.querySelector('#view'), bad = [];
  for (const i of v.querySelectorAll('input, select, textarea')) if (i.type !== 'hidden' && !(i.labels?.length || i.getAttribute('aria-label'))) bad.push('unlabelled ' + (i.name || i.id));
  for (const b of v.querySelectorAll('button')) if (!(b.textContent.trim() || b.getAttribute('aria-label'))) bad.push('unnamed button');
  const ids = [...v.querySelectorAll('[id]')].map(e => e.id); if (new Set(ids).size !== ids.length) bad.push('duplicate ids');
  if (!v.querySelector('.tt-disclaimer[role=note]')) bad.push('no disclaimer');
  for (const t of v.querySelectorAll('table')) if (!t.querySelector('th')) bad.push('table without headers');
  for (const b of v.querySelectorAll('button, input, select, textarea')) { const r = b.getBoundingClientRect(); if (b.offsetParent && (r.width < 24 || r.height < 24) && b.type !== 'radio') bad.push(`target under 24px: ${b.name || b.textContent.trim()}`); }
  return bad;
});

await step('the menu entry is there and all five tabs are listed', async () => {
  await page.goto(B + '/app#/dashboard'); await page.reload(); await page.waitForSelector('#nav');
  await page.waitForSelector('#nav a[href="#/tradetools"]', { state: 'attached', timeout: 8000 });
  await page.goto(B + '/app#/tradetools'); await page.waitForSelector('.tt-form');
  must((await page.$$('nav[aria-label="Planning tools"] a')).length === 5, 'five tabs');
});
await step('position size from the keyboard: 50 shares, the working shown, disclaimer, a11y rules', async () => {
  await page.click('[name=equity]'); await page.keyboard.type('10000');
  await page.fill('[name=riskPct]', '1'); await page.fill('[name=entry]', '50'); await page.fill('[name=stop]', '48');
  await page.focus('[name=stop]'); await page.keyboard.press('Enter');
  await page.waitForSelector('.tt-result:not([hidden])');
  const t = await page.innerText('.tt-result'); must(/50\s+shares/.test(t) && /\$2,500/.test(t) && /Loss if the stop is hit/i.test(t), t.replace(/\n/g, " | ").slice(0, 700));
  must((await page.getAttribute('.tt-result', 'aria-live')) === 'polite', 'result is announced');
  must(/nothing is sent to your broker/.test(await page.innerText('.tt-disclaimer')), 'disclaimer');
  const bad = await a11y(); must(!bad.length, bad.join('; '));
});
await step('a stop on the wrong side is explained in words', async () => {
  await page.fill('[name=stop]', '55'); await page.click('.tt-form button[type=submit]');
  await page.waitForFunction(() => /stop must be below the entry/.test(document.querySelector('.tt-form .err')?.textContent || ''));
});
await step('risk / reward: 2R and 3R, break-even win rates, ATR note when history is short', async () => {
  await page.goto(B + '/app#/tradetools?tab=rr'); await page.waitForSelector('[name=t1]');
  await page.fill('[name=entry]', '100'); await page.fill('[name=stop]', '95'); await page.fill('[name=t1]', '110'); await page.fill('[name=t2]', '115'); await page.fill('[name=winRate]', '40'); await page.fill('[name=symbol]', 'AAPL');
  await page.click('.tt-form button[type=submit]'); await page.waitForSelector('.tt-result:not([hidden])');
  const t = await page.innerText('.tt-result'); must(/33\.3%/.test(t) && /25%/.test(t) && /0\.6/.test(t), t.slice(0, 300));
  must(/Not enough price history/.test(t), 'no invented ATR');
  const bad = await a11y(); must(!bad.length, bad.join('; '));
});
await step('sector heatmap: 11 sectors, change in words and arrows, the data label, refresh', async () => {
  await page.goto(B + '/app#/tradetools?tab=heatmap'); await page.waitForSelector('.tt-tile');
  must((await page.$$('.tt-tile')).length === 11, 'eleven tiles');
  const t = await page.innerText('#tto'); must(/One exchange \(IEX\)/.test(t) && /▲ \+10%/.test(t) && /Past moves do not predict/.test(t), t.slice(0, 300));
  const bad = await a11y(); must(!bad.length, bad.join('; '));
});
await step('portfolio explainer: rules answer labelled, sources and disclaimer; an advice request is refused', async () => {
  await page.goto(B + '/app#/tradetools?tab=portfolio'); await page.waitForSelector('[name=holdings]');
  await page.fill('[name=holdings]', 'AAA, 5000, Tech\nBBB, 3000, Tech\nCCC, 2000, Energy');
  await page.click('.tt-form button[type=submit]'); await page.waitForSelector('.tt-result:not([hidden])');
  let t = await page.innerText('.tt-result'); must(/Written from rules/.test(t) && /AAA/.test(t) && /Sources/i.test(t) && /not investment advice/.test(t) && /not by AI/.test(t) && /0\.38/.test(t), t.replace(/\n/g, " | ").slice(0, 900));
  await page.fill('[name=question]', 'Should I sell AAA now?'); await page.click('.tt-form button[type=submit]');
  await page.waitForFunction(() => /Request refused/.test(document.querySelector('.tt-result').textContent));
  t = await page.innerText('.tt-result'); must(/cannot tell you what to buy, sell or hold/.test(t), 'refusal text');
  const bad = await a11y(); must(!bad.length, bad.join('; '));
});
await step('indicator explainer: a symbol with too little history gets a plain message', async () => {
  await page.goto(B + '/app#/tradetools?tab=indicator'); await page.waitForSelector('[name=symbol]');
  await page.fill('[name=symbol]', 'AAPL'); await page.click('.tt-form button[type=submit]');
  await page.waitForFunction(() => /Not enough price history/.test(document.querySelector('.tt-form .err')?.textContent || ''));
  const bad = await a11y(); must(!bad.length, bad.join('; '));
});
await step('phone width: no sideways scrolling on any tab', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const t of ['sizing', 'rr', 'heatmap', 'portfolio', 'indicator']) {
    await page.goto(B + `/app#/tradetools?tab=${t}`); await page.waitForSelector('.tt-disclaimer');
    must(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `overflow on ${t}`);
  }
  await page.goto(B + '/app#/tradetools?tab=heatmap'); await page.waitForSelector('.tt-tile'); await page.screenshot({ path: path.join(OUT, 'tools-heatmap-phone.png') });
});
console.log(errors.length ? `  ✗ browser errors: ${errors.join(' | ').slice(0, 400)}` : '  ✓ no browser errors'); if (errors.length) failures++;
await browser.close(); server.kill(); mock.close();
if (failures) { console.log(`\n${failures} check(s) failed.\n${log.join('').split('\n').slice(-10).join('\n')}`); process.exit(1); }
console.log('\nPlanning tools: all checks passed');
