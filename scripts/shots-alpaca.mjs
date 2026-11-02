// Screenshots of the logo and of every place in the app that works with Alpaca (account opening,
// connecting, trading, portfolio, market data, funding and the owner's Alpaca settings), taken
// against the Alpaca mock. Pictures go to screenshots/alpaca/.
//   node scripts/shots-alpaca.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startMock } from '../test/mock-alpaca.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'screenshots');
fs.mkdirSync(path.join(OUT, 'alpaca'), { recursive: true });
const PORT = 3170, B = `http://localhost:${PORT}`;
const mock = await startMock();
mock.autoFill = true;
const server = spawn(process.execPath, ['server.js'], {
  cwd: root, stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, PORT: String(PORT), FREE_DATA: 'off', NODE_ENV: 'test', DB_FILE: path.join(os.tmpdir(), `qp-shots-${Date.now()}.db`),
    BROKER_API_KEY: 'BKEY', BROKER_API_SECRET: 'BSECRET', BROKER_BASE_URL: mock.url, ALPACA_TRADING_URL: mock.url, ALPACA_DATA_URL: mock.url, ALPACA_DATA_SANDBOX_URL: mock.url,
    ALPACA_KEY_ID: 'DKEY', ALPACA_SECRET: 'DSECRET', ALPACA_STREAM_URL: 'ws://127.0.0.1:1' },
});
for (let i = 0; i < 60; i++) { if (await fetch(B + '/healthz').then(r => r.ok, () => false)) break; await new Promise(r => setTimeout(r, 250)); }
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const shot = async (name, opts = {}) => { await p.waitForTimeout(900); await p.screenshot({ path: path.join(OUT, name), fullPage: true, ...opts }); console.log('  ' + name); };
const go = async (hash, wait = '#view h1, #view h2') => { await p.goto(B + '/app' + hash); await p.waitForSelector(wait, { timeout: 20000 }).catch(() => {}); };
const api = (u, body, method) => p.evaluate(([u, body, method]) => fetch('/api' + u, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json()), [u, body, method]);

try {
  // The logo: the app icon, the mark, and the header as it appears.
  fs.copyFileSync(path.join(root, 'public/icon-512.png'), path.join(OUT, 'logo-icon-512.png'));
  await p.goto(B + '/terms'); await p.setViewportSize({ width: 512, height: 512 });
  await p.setContent(`<body style="margin:0;display:grid;place-items:center;height:100vh;background:#fff"><img src="${B}/favicon.svg" width="400" height="400"></body>`);
  await shot('logo-mark.png', { fullPage: false });
  await p.setViewportSize({ width: 1360, height: 900 });
  await p.goto(B + '/');
  await p.waitForTimeout(800);
  const brand = await p.$('header .brand, .brand, header a');
  if (brand) { await brand.screenshot({ path: path.join(OUT, 'logo-wordmark.png') }); console.log('  logo-wordmark.png'); }

  // Owner account (the first account is the owner).
  await go('#/register', 'input[name=email]');
  await p.fill('input[name=email]', 'owner-shots@example.com'); await p.fill('input[name=password]', 'Str0ngPassword'); await p.check('input[name=agree]');
  await p.click('form.auth button:not([type=button])'); await p.waitForSelector('#nav a.on');
  await p.evaluate(() => localStorage.setItem('qp_start', JSON.stringify({ done: true })));

  // Before connecting: open an account / connect.
  await go('#/account'); await shot('alpaca/01-alpaca-account-connect-or-open.png');
  await go('#/open-account'); await shot('alpaca/02-open-brokerage-account-application.png');
  await go('#/brokers'); await shot('alpaca/03-brokerages.png');
  // Connect API keys, then the live pages.
  await api('/alpaca/keys', { keyId: 'SHOTKEY', secret: 'S' });
  await p.evaluate(() => localStorage.setItem('qp_account', 'alpaca'));
  await go('#/account'); await shot('alpaca/04-alpaca-account-connected.png');
  await go('#/accounts'); await shot('alpaca/05-all-accounts.png');
  await go('#/dashboard'); await shot('alpaca/06-portfolio-alpaca.png');
  await go('#/trade?symbol=AAPL'); await shot('alpaca/07-trade-ticket-alpaca.png');
  await api('/alpaca/orders', { symbol: 'AAPL', side: 'buy', type: 'market', qty: 2, time_in_force: 'day' }).catch(() => {});
  await go('#/orders'); await shot('alpaca/08-orders-alpaca.png');
  await go('#/positions'); await shot('alpaca/09-positions-alpaca.png');
  await go('#/watchlists'); await shot('alpaca/10-watchlists-alpaca.png');
  await go('#/options?underlying=AAPL'); await shot('alpaca/11-options-chain.png');
  await go('#/optionslab'); await shot('alpaca/12-options-lab.png');
  await go('#/markets'); await shot('alpaca/13-markets-and-news.png');
  await go('#/calendar'); await shot('alpaca/14-market-calendar.png');
  await go('#/alpaca-tools'); await shot('alpaca/15-bonds-rates-crypto.png');
  await go('#/chart?symbol=AAPL'); await shot('alpaca/16-chart.png');
  await go('#/execution'); await shot('alpaca/17-execution-and-routing.png');
  await go('#/funding'); await shot('alpaca/18-plans-billing-funding.png');
  await go('#/text'); await shot('alpaca/19-text-and-hotline.png');
  // Owner settings for Alpaca.
  await go('#/admin-setup'); await shot('alpaca/20-admin-setup-broker-api.png');
  await go('#/admin-upgrades?tab=alpaca'); await shot('alpaca/21-admin-alpaca-upgrades.png');
  await go('#/admin-data'); await shot('alpaca/22-admin-market-data-sources.png');
  await go('#/admin-money'); await shot('alpaca/23-admin-money-revenue-share.png');
  await go('#/admin-comms'); await shot('alpaca/24-admin-apply-by-text.png');
} finally {
  await browser.close(); server.kill(); mock.close();
}
console.log('Screenshots in', OUT);
