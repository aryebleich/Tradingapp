// End-to-end run of the whole app in a real browser: starts the Alpaca mock and the server,
// then drives the desktop flow, a phone flow and a layout audit on two phone sizes.
// Screenshots go to e2e-output/. Exits non-zero if any step fails.
//   npm run e2e
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { startMock } from '../mock-alpaca.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(root, 'e2e-output');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 3150, B = `http://localhost:${PORT}`;
let failures = 0;

const mock = await startMock();
const server = spawn(process.execPath, ['server.js'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env, PORT: String(PORT), FREE_DATA: 'off', NODE_ENV: 'test',
    DB_FILE: path.join(os.tmpdir(), `qp-e2e-${Date.now()}.db`),
    BROKER_API_KEY: 'BKEY', BROKER_API_SECRET: 'BSECRET', BROKER_BASE_URL: mock.url,
    ALPACA_TRADING_URL: mock.url, ALPACA_DATA_URL: mock.url, ALPACA_DATA_SANDBOX_URL: mock.url,
    ALPACA_KEY_ID: 'DKEY', ALPACA_SECRET: 'DSECRET', ALPACA_STREAM_URL: 'ws://127.0.0.1:1',
    // Shows the Google buttons so their layout is checked (the sign-in itself is covered by unit tests).
    GOOGLE_CLIENT_ID: 'e2e', GOOGLE_CLIENT_SECRET: 'e2e',
  },
});
const serverLog = [];
server.stdout.on('data', d => serverLog.push(String(d)));
server.stderr.on('data', d => serverLog.push(String(d)));
for (let i = 0; i < 50; i++) { if (await fetch(B + '/healthz').then(r => r.ok, () => false)) break; await new Promise(r => setTimeout(r, 200)); }

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

// Menu groups start folded: open the one holding the link first (as a person would), then click.
async function navTo(p, k, how = 'click') {
  const sel = `#nav a[href="#/${k}"]`;
  if (!(await p.isVisible(sel))) { const g = await p.$eval(sel, a => a.closest('.grpbody')?.previousElementSibling?.dataset.g); if (g) await p[how](`#nav button.grp.sec[data-g="${g}"]`); }
  await p[how](sel);
}
function harness(p, label) {
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => m.type() === 'error' && !/status of (401|403|409)/.test(m.text()) && errors.push(m.text()));
  p.on('dialog', d => d.accept());
  const step = async (name, fn) => {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (e) {
      failures++; console.log(`  ✗ ${name}: ${e.message.split('\n')[0]}`);
      // What the page showed, for runs where the screenshot cannot be opened.
      const seen = await p.evaluate(() => ({ url: location.href, err: [...document.querySelectorAll('.err, #tkErr')].map(x => x.textContent.trim()).filter(Boolean).join(' | '), view: (document.querySelector('#view')?.innerText || '').replace(/\s+/g, ' ').slice(0, 300) })).catch(() => null);
      if (seen) console.log(`    at ${seen.url}\n    errors: ${seen.err || '-'}\n    page: ${seen.view}`);
      if (errors.length) console.log(`    browser errors so far: ${errors.join(' | ').slice(0, 300)}`);
      await p.screenshot({ path: path.join(OUT, `FAIL-${label}-${name.replace(/\W+/g, '_')}.png`), fullPage: true }).catch(() => {}); }
  };
  const done = () => { if (errors.length) { failures++; console.log(`  ✗ browser errors: ${errors.join(' | ')}`); } };
  return { step, done };
}
// Real-money options and crypto need the lesson and a fresh risk notice; done once per test user.
const unlockHighRisk = p => p.evaluate(async () => {
  const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify(b) });
  await post('/api/learn/crypto', { answers: [1, 1] }); await post('/api/learn/options', { answers: [0, 1, 1] });
  await post('/api/learn/ack/crypto', {}); await post('/api/learn/ack/options', {});
});
const confirmDialog = async (p, tap) => { await p.waitForSelector('dialog[open]'); await p[tap ? 'tap' : 'click']('dialog[open] button[value=yes]'); };

// ---------- desktop ----------
console.log('Desktop (1360x900)');
{
  const p = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const { step, done } = harness(p, 'desktop');
  await step('register', async () => {
    await p.goto(B + '/app#/register'); await p.fill('input[name=email]', 'desk@example.com'); await p.fill('input[name=password]', 'Str0ngPassword'); await p.check('input[name=agree]');
    await p.click('button:has-text("Create account")'); await p.waitForSelector('.st-card');
    // New accounts start on the guided setup; "Skip the setup" goes to the portfolio.
    await p.click('#stExit'); await p.waitForSelector('#ticket');
    await unlockHighRisk(p);
  });
  await step('homepage demo + legal pages', async () => {
    const q = await browser.newPage(); await q.goto(B + '/'); await q.waitForSelector('#demoStats .stat');
    for (const u of ['/terms', '/privacy', '/risk', '/contact', '/security', '/insurance']) if ((await q.goto(B + u)).status() !== 200) throw new Error(u);
    await q.goto(B + '/status'); await q.waitForSelector('.st-banner');
    await q.close();
  });
  await step('open brokerage account (5 steps + ID upload)', async () => {
    await p.goto(B + '/app#/account'); await p.waitForSelector('#onb');
    // 1 Contact
    await p.fill('[name=phone]', '+17185550100'); await p.fill('[name=street]', '1 Main St'); await p.fill('[name=city]', 'Brooklyn'); await p.selectOption('[name=state]', 'NY'); await p.fill('[name=postalCode]', '11211');
    await p.click('#next');
    // 2 Identity
    // The mock holds a first name of "Review" for manual review.
    await p.fill('[name=givenName]', 'Review'); await p.fill('[name=familyName]', 'Doe'); await p.fill('[name=dateOfBirth]', '1990-05-01'); await p.fill('[name=ssn]', '123-45-6789');
    await p.selectOption('[name=taxResidence]', 'USA'); await p.selectOption('[name=fundingSource]', 'savings');
    await p.click('#next');
    // 3 Disclosures (yes/no)
    await p.check('[name=isAffiliated][value=yes]'); await p.check('[name=isAffiliated][value=no]');
    await p.click('#next');
    // 4 Agreements
    await p.check('[name=margin]'); await p.check('[name=options]'); await p.check('[name=agreeCustomer]');
    await p.click('#next');
    // 5 Documents (optional) and review
    await p.setInputFiles('#docFile', { name: 'passport.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex') });
    await p.waitForSelector('#docs .doc');
    await p.screenshot({ path: path.join(OUT, 'desktop-onboarding-review.png'), fullPage: true });
    await p.click('#next'); await confirmDialog(p);
    await p.waitForSelector('#kycStatus');
    const sent = [...mock.log].reverse().find(r => r.path === '/v1/accounts' && r.method === 'POST').body;
    if (sent.documents?.[0]?.document_type !== 'identity_verification') throw new Error('document not sent');
    if (!sent.agreements.some(a => a.agreement === 'margin_agreement')) throw new Error('margin agreement missing');
    if (sent.identity.funding_source[0] !== 'savings' || sent.disclosures.is_affiliated_exchange_or_finra !== false) throw new Error('form mapping');
  });
  await step('status dashboard updates live to ACTIVE', async () => {
    await p.waitForSelector('text=Pending manual review', { timeout: 10000 });
    await p.screenshot({ path: path.join(OUT, 'desktop-kyc-review.png'), fullPage: true });
    await p.waitForTimeout(800); // the page's live stream is open
    mock.setStatus([...mock.accounts.keys()].at(-1), 'ACTIVE'); // Alpaca decides; only the event feed tells us
    await p.waitForSelector('#achForm', { timeout: 8000 }); // well before the page's 60s backup poll
    await p.waitForSelector('text=Account approved! Ready to trade');
    if (!(await p.textContent('.timeline')).includes('Alpaca event')) throw new Error('ACTIVE did not come from the event feed');
    await p.screenshot({ path: path.join(OUT, 'desktop-account.png'), fullPage: true });
  });
  await step('link bank and deposit', async () => {
    await p.fill('#achForm [name=ownerName]', 'Jane Doe'); await p.fill('#achForm [name=routingNumber]', '121000358'); await p.fill('#achForm [name=accountNumber]', '32131231');
    await p.click('#achForm button'); await p.waitForSelector('#trForm');
    await p.fill('#trForm [name=amount]', '5000'); await p.click('#trForm button'); await confirmDialog(p); await p.waitForSelector('text=QUEUED');
  });
  await step('portfolio', async () => {
    await p.evaluate(() => localStorage.setItem('qp_account', 'alpaca')); await p.goto(B + '/app#/dashboard'); await p.reload();
    await p.waitForSelector('text=Balances & margin'); await p.screenshot({ path: path.join(OUT, 'desktop-portfolio.png'), fullPage: true });
  });
  await step('limit order', async () => {
    await p.goto(B + '/app#/trade?symbol=AAPL'); await p.waitForSelector('#tk');
    await p.selectOption('#tk [name=type]', 'limit'); await p.fill('#tk [name=qty]', '3'); await p.fill('#tk [name=limit_price]', '150');
    await p.click('#review'); await confirmDialog(p); await p.waitForSelector('#tkErr.ok');
    await p.screenshot({ path: path.join(OUT, 'desktop-trade.png'), fullPage: true });
  });
  await step('bracket order', async () => {
    await p.goto(B + '/app#/trade?symbol=AAPL'); await p.waitForSelector('#tk');
    await p.selectOption('#tk [name=type]', 'limit'); await p.click('#tk summary'); await p.selectOption('#tk [name=order_class]', 'bracket');
    await p.fill('#tk [name=qty]', '2'); await p.fill('#tk [name=limit_price]', '100'); await p.fill('#tk [name=take_profit_price]', '120'); await p.fill('#tk [name=stop_loss_price]', '90');
    await p.click('#review'); await confirmDialog(p); await p.waitForSelector('#tkErr.ok');
  });
  await step('crypto order in dollars', async () => {
    await p.goto(B + '/app#/trade?symbol=' + encodeURIComponent('BTC/USD')); await p.waitForSelector('#tk');
    await p.click('#tk [data-m=notional]'); await p.fill('#tk [name=notional]', '50'); await p.click('#review'); await confirmDialog(p); await p.waitForSelector('#tkErr.ok');
  });
  await step('modify, cancel, cancel all', async () => {
    await p.goto(B + '/app#/orders'); await p.waitForSelector('[data-mod]');
    await p.click('[data-mod][data-type=limit]'); await p.fill('dialog[open] [name=limit_price]', '149'); await p.click('dialog[open] button[value=yes]'); await p.waitForTimeout(800);
    const before = await p.$$eval('[data-cancel]', e => e.length); await p.click('[data-cancel] >> nth=0'); await p.waitForTimeout(800);
    if (!((await p.$$eval('[data-cancel]', e => e.length)) < before)) throw new Error('cancel did not remove the order');
    await p.click('#cancelAll'); await confirmDialog(p); await p.waitForTimeout(1200);
    if (await p.$$eval('[data-cancel]', e => e.length)) throw new Error('open orders remain');
  });
  // Selling must match the account: "Sell all" sells exactly what Alpaca holds, and nothing more.
  await step('trade: symbol search lists matches and opens one with the keyboard', async () => {
    await p.goto(B + '/app#/trade?symbol=AAPL'); await p.waitForSelector('#search input[name=q]', { timeout: 15000 });
    await p.fill('#search input[name=q]', 'SPY'); await p.waitForFunction(() => [...document.querySelectorAll('#symList:not([hidden]) li[data-i] b')].some(b => b.textContent === 'SPY'), null, { timeout: 15000 });
    await p.screenshot({ path: path.join(OUT, 'trade-search.png') });
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => /symbol=SPY/.test(location.hash), null, { timeout: 10000 });
    await p.waitForSelector('#search input[name=q]'); await p.click('#search input[name=q]'); await p.waitForSelector('#symList li:has-text("Recent")');
  });
  await step('live: sell all matches the Alpaca account, and a sell of shares not held is refused', async () => {
    mock.autoFill = true;
    try {
      await p.goto(B + '/app#/trade?symbol=AAPL&side=sell'); await p.waitForSelector('#tk');
      await p.waitForSelector('#sellAll', { timeout: 15000 }); await p.click('#sellAll');
      const held = await p.inputValue('#tk [name=qty]'); if (held !== '10') throw new Error(`Sell all filled ${held}, the account holds 10`);
      await p.click('#review'); await confirmDialog(p); await p.waitForSelector('#tkErr.ok');
      const pos = await p.evaluate(() => fetch('/api/alpaca/positions', { headers: { 'X-Requested-With': 'qp' } }).then(r => r.json()));
      if (pos.some(x => x.symbol === 'AAPL')) throw new Error('AAPL is still held after selling all of it');
      await p.goto(B + '/app#/orders'); await p.waitForSelector('#orderTabs');
      await p.goto(B + '/app#/trade?symbol=AAPL&side=sell'); await p.waitForSelector('#tk [name=qty]'); await p.waitForSelector('#tkHold:has-text("do not own")', { timeout: 15000 });
      await p.fill('#tk [name=qty]', '1'); await p.click('#review');
      await p.waitForFunction(() => /do not own/.test(document.querySelector('#tkErr')?.textContent || ''), null, { timeout: 10000 });
      // The server refuses it too, even if the page were skipped.
      const r = await p.evaluate(() => fetch('/api/alpaca/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify({ symbol: 'AAPL', side: 'sell', qty: 1, type: 'market', time_in_force: 'day' }) }).then(x => x.status));
      if (r !== 409) throw new Error(`server accepted a sell of shares not held (${r})`);
      // Put the 10 shares back for the steps that follow.
      await p.evaluate(() => fetch('/api/alpaca/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market', time_in_force: 'day' }) }));
    } finally { mock.autoFill = false; }
  });
  await step('partial close', async () => {
    await p.goto(B + '/app#/positions'); await p.waitForSelector('[data-close]');
    await p.click('[data-close]'); await p.selectOption('dialog[open] [name=mode]', 'qty'); await p.fill('dialog[open] [name=amount]', '4'); await p.click('dialog[open] button[value=yes]');
    await p.waitForTimeout(1800);
    const q = await p.textContent('tr[data-sym=AAPL] td:nth-child(3)'); if (q.trim() !== '6') throw new Error('qty ' + q);
  });
  await step('markets & news', async () => { await p.goto(B + '/app#/markets'); await p.waitForSelector('text=NVDA'); await p.waitForSelector('text=Apple beats estimates'); });
  await step('options spread', async () => {
    await p.goto(B + '/app#/options?underlying=AAPL'); await p.waitForSelector('.chain');
    await p.click('td.pick[data-sym=AAPL261120C00150000][data-side=buy]'); await p.click('td.pick[data-sym=AAPL261120P00150000][data-side=buy]');
    await p.click('#of button'); await confirmDialog(p); await p.waitForSelector('#of .ok');
    await p.screenshot({ path: path.join(OUT, 'desktop-options.png'), fullPage: true });
  });
  await step('watchlists', async () => {
    await p.goto(B + '/app#/watchlists'); await p.fill('#nw [name=name]', 'Tech'); await p.click('#nw button'); await p.waitForSelector('#add');
    await p.fill('#add [name=symbol]', 'MSFT'); await p.click('#add button'); await p.waitForSelector('tr[data-s=MSFT]');
    await p.click('[data-rm=MSFT]'); await p.waitForTimeout(800); if (await p.$('tr[data-s=MSFT]')) throw new Error('not removed');
  });
  await step('calendar & events', async () => { await p.goto(B + '/app#/calendar'); await p.waitForSelector('text=Early close'); await p.waitForSelector('text=dividend'); });
  await step('admin: every owner page is in the menu and opens', async () => {
    for (const [k, h] of [['admin', 'Funnel'], ['admin-users', 'Changing a plan here'], ['admin-money', 'Payment processors'], ['admin-support', 'Support inbox'], ['admin-setup', 'Alpaca Broker API']]) {
      await navTo(p, k); await p.waitForSelector(`.admintabs button.on`); await p.waitForSelector(`text=${h}`);
    }
    await p.screenshot({ path: path.join(OUT, 'admin-setup.png'), fullPage: true });
    await navTo(p, 'admin-system'); await p.waitForSelector('text=Capacity plan');
    // Upgrades: the version, each tab, and an upgrade behind the password and UPGRADE.
    await navTo(p, 'admin-upgrades'); await p.waitForSelector('.upgradehead .ver b');
    for (const t of ['alpaca', 'render', 'history', 'github']) { await p.goto(B + '/app#/admin-upgrades?tab=' + t); await p.waitForSelector('.upgradehead'); }
    const v0 = await p.textContent('.upgradehead .ver b');
    await p.click('[data-rec="github:pro"]'); await p.waitForSelector('dialog.secure');
    await p.fill('dialog.secure [name=password]', 'Str0ngPassword'); await p.fill('dialog.secure [name=typed]', 'UPGRADE'); await p.check('dialog.secure [name=ok]'); await p.click('dialog.secure button[value=yes]');
    await p.waitForFunction(v => document.querySelector('.upgradehead .ver b')?.textContent !== v, v0);
    await p.screenshot({ path: path.join(OUT, 'admin-upgrades.png'), fullPage: true });
    await p.goto(B + '/app#/admin-trust'); await p.waitForSelector('#tr'); await p.fill('#inc [name=title]', 'Test incident'); await p.click('#inc button'); await p.waitForSelector('[data-inc]');
    await p.click('[data-delinc]').catch(() => {});
    await p.goto(B + '/app#/admin-data'); await p.waitForSelector('.datasrc'); await p.goto(B + '/app#/admin-comms'); await p.waitForSelector('#cs');
    await p.goto(B + '/app#/admin-phone'); await p.waitForSelector('text=Yiddish voice'); await p.waitForSelector('tr[data-k="press"]');
    // View as each plan from the header, then back to the owner view.
    // A preview asks for the password and a tick first.
    await p.selectOption('#viewAs', 'plan:free'); await p.waitForSelector('dialog.secure');
    await p.fill('dialog.secure [name=password]', 'Str0ngPassword'); await p.check('dialog.secure [name=ok]'); await p.click('dialog.secure button[value=yes]');
    await p.waitForSelector('#viewAs.on'); await p.waitForSelector('#nav a.upsell');
    await p.selectOption('#viewAs', ''); await p.waitForSelector('#viewAs:not(.on)'); await p.waitForFunction(() => !document.querySelector('#nav a.upsell'));
    await navTo(p, 'admin-users'); await p.fill('#userFind', 'desk'); await p.waitForTimeout(200);
    if ((await p.$$('#userTable tr[data-email]:not([hidden])')).length !== 1) throw new Error('user search');
  });
  await step('no idle background copy after a reload', async () => {
    // Background loading already ran in this tab: a reload must not leave a hidden copy running.
    await p.goto(B + '/app#/dashboard'); await p.waitForSelector('#view h1'); await p.waitForTimeout(3600);
    if (await p.$('#pfFrame')) throw new Error('a hidden background copy is still open');
  });
  await step('strategy backtest', async () => { await p.goto(B + '/app#/backtest'); await p.click('button:has-text("Run backtest")'); await p.waitForSelector('#btc'); });
  done(); await p.close();
}

// ---------- public account-opening page ----------
console.log('Open account page (new visitor)');
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  const p = await ctx.newPage();
  const { step, done } = harness(p, 'open-account');
  await step('create login, then the application starts', async () => {
    await p.goto(B + '/app#/open-account'); await p.waitForSelector('#oaReg');
    await p.fill('#oaReg [name=email]', 'newinvestor@example.com'); await p.fill('#oaReg [name=password]', 'Str0ngPassword'); await p.check('#oaReg [name=agree]');
    await p.click('#oaReg button'); await p.waitForSelector('#onb'); await p.waitForSelector('text=Step 1 of 5');
    if (await p.inputValue('[name=email]') !== 'newinvestor@example.com') throw new Error('email not carried over');
    await p.screenshot({ path: path.join(OUT, 'open-account.png'), fullPage: true });
  });
  done(); await ctx.close();
}

// ---------- phone flow ----------
console.log('Phone (iPhone 13)');
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  const { step, done } = harness(p, 'phone');
  await step('register', async () => {
    await p.goto(B + '/app#/register'); await p.fill('input[name=email]', 'phone@example.com'); await p.fill('input[name=password]', 'Str0ngPassword'); await p.check('input[name=agree]');
    await p.tap('button:has-text("Create account")'); await p.waitForSelector('#tabs a.on');
    await unlockHighRisk(p);
  });
  await step('connect API keys from the menu', async () => {
    await p.tap('#moreTab'); await p.waitForSelector('#nav.open'); await navTo(p, 'account', 'tap'); await p.waitForSelector('#keysForm');
    await p.fill('#keysForm [name=keyId]', 'PHONEKEY'); await p.fill('#keysForm [name=secret]', 'S'); await p.tap('#keysForm button'); await p.waitForSelector('#keysForm .ok');
  });
  await step('sticky Buy bar places an order', async () => {
    await p.tap('#tabs a[data-r=trade]'); await p.waitForSelector('#tradeBar:not([hidden])'); await p.tap('#tradeBar #toTicket'); await p.waitForTimeout(700);
    // The ticket can re-render when the live quote arrives (slower CI machines): fill, then retry once.
    for (let i = 0; i < 2; i++) {
      await p.waitForSelector('#tk [name=qty]'); await p.fill('#tk [name=qty]', '2'); await p.tap('#review');
      if (await p.waitForSelector('dialog[open]', { timeout: 5000 }).then(() => true, () => false)) break;
    }
    await confirmDialog(p, true); await p.waitForSelector('#tkErr.ok');
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(400); await p.screenshot({ path: path.join(OUT, 'phone-trade.png') });
  });
  await step('order filters and cancel', async () => {
    await p.tap('#tabs a[data-r=orders]'); await p.waitForSelector('#orderTabs button[data-k=open].on'); await p.waitForSelector('[data-cancel]');
    await p.tap('[data-cancel] >> nth=0'); await p.waitForTimeout(900); await p.screenshot({ path: path.join(OUT, 'phone-orders.png') });
  });
  await step('close half a position from its card', async () => {
    await p.tap('#tabs a[data-r=positions]'); await p.waitForSelector('[data-close]'); await p.tap('[data-close]');
    await p.selectOption('dialog[open] [name=mode]', 'percentage'); await p.fill('dialog[open] [name=amount]', '50'); await p.tap('dialog[open] button[value=yes]'); await p.waitForTimeout(1600);
    const q = await p.textContent('tr[data-sym=AAPL] td[data-label=Qty]'); if (q.trim() !== '5') throw new Error('qty ' + q);
    await p.screenshot({ path: path.join(OUT, 'phone-positions.png') });
  });
  await step('options leg bar', async () => {
    await p.goto(B + '/app#/options?underlying=AAPL'); await p.waitForSelector('.chain'); await p.tap('td.pick[data-side=buy] >> nth=0');
    await p.waitForSelector('#legBar:not([hidden])'); await p.tap('#legGo'); await p.waitForTimeout(600); await p.tap('#of button'); await confirmDialog(p, true); await p.waitForSelector('#of .ok');
  });
  await step('menu opens above everything and closes', async () => {
    await p.tap('#moreTab'); await p.waitForTimeout(400); await p.screenshot({ path: path.join(OUT, 'phone-menu.png') });
    await p.tap('#scrim', { position: { x: 360, y: 300 } }); await p.waitForTimeout(300); if (await p.isVisible('#nav.open')) throw new Error('menu stayed open');
  });
  done(); await ctx.close();
}

// ---------- language is chosen in Settings, not in the header ----------
console.log('Settings → Language');
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  const p = await ctx.newPage();
  const { step, done } = harness(p, 'language');
  await step('switch to Yiddish and back', async () => {
    await p.goto(B + '/app#/register'); await p.fill('input[name=email]', 'lang@example.com'); await p.fill('input[name=password]', 'Str0ngPassword'); await p.check('input[name=agree]');
    await p.click('form.auth button:not([type=button])'); await p.waitForSelector('#nav a.on');
    // The guided setup, all the way through: a goal, practice money, a first practice purchase, safety, next steps.
    await p.waitForSelector('.st-card h1:has-text("Welcome")'); await p.click('[data-goal=grow]'); await p.click('#stNext');
    await p.waitForSelector('text=$100,000 of practice money'); await p.click('#stNext');
    await p.click('[data-pick=SPY]'); await p.click('[data-amt="100"]'); await p.click('#stBuy'); await p.waitForSelector('#stOut .banner.ok');
    await p.screenshot({ path: path.join(OUT, 'get-started.png') });
    await p.click('#stBuy'); await p.waitForSelector('text=Keep your account safe'); await p.click('#stSkip');
    await p.waitForSelector('a.st-choice[href="#/sp500"]'); await p.click('#stDone'); await p.waitForSelector('#ticket');
    if (await p.$('#nav a[href="#/start"]')) throw new Error('Get started still in the menu after finishing');
    // Menu groups start folded and open with their arrow.
    if (await p.isVisible('#nav a[href="#/statarb"]')) throw new Error('a folded group shows its pages');
    await p.click('#nav button.grp.sec[data-g="Quant lab"]'); await p.waitForSelector('#nav a[href="#/statarb"]', { state: 'visible' });
    await p.screenshot({ path: path.join(OUT, 'menu.png') });
    if (await p.$('header #langSel, header .langsel')) throw new Error('language picker still in the header');
    await p.goto(B + '/app#/settings'); await p.selectOption('#langSel', 'yi');
    await p.waitForSelector('html[dir=rtl]'); await p.waitForFunction(() => document.querySelector('#langSel')?.value === 'yi'); await p.waitForFunction(() => /[\u05D0-\u05EA]/.test(document.querySelector('#view h1')?.textContent || ''));
    await p.screenshot({ path: path.join(OUT, 'settings-language-yi.png') });
    await p.selectOption('#langSel', 'es'); await p.waitForSelector('#nav a:has-text("Ajustes")');
    await p.selectOption('#langSel', 'ar'); await p.waitForSelector('html[dir=rtl]'); await p.waitForSelector('#nav a:has-text("الإعدادات")');
    await p.selectOption('#langSel', 'en'); await p.waitForSelector('html[dir=ltr]'); await p.waitForSelector('h1:has-text("Settings")');
  });
  await step('homepage has no language links', async () => {
    await p.goto(B + '/'); if (await p.isVisible('.top .lang, .lang-m')) throw new Error('language link on the homepage');
    if (await p.$('a[data-lang]')) throw new Error('language link on the homepage');
  });
  done(); await ctx.close();
}

// ---------- new feature pages, driven on desktop ----------
{
  console.log('Feature pages (desktop)');
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const p = await ctx.newPage();
  const { step, done } = harness(p, 'features');
  await p.goto(B + '/app#/register'); await p.fill('input[name=email]', 'features@example.com'); await p.fill('input[name=password]', 'Str0ngPassword'); await p.check('input[name=agree]');
  await p.click("form.auth button:not([type=button])"); await p.waitForSelector('#tabs a.on', { state: 'attached' });
  const go = async (r, sel) => { if (p.url() === B + '/app' + r) await p.reload(); else await p.goto(B + '/app' + r); await p.waitForSelector(sel, { timeout: 15000 }); };
  const okText = async box => { await p.waitForSelector(`${box} .ok`, { timeout: 20000 }).catch(async () => { throw new Error((await p.textContent(`${box} .err`).catch(() => '')) || 'no result'); }); };
  await step('menu lists the new pages', async () => { for (const k of ['chart', 'ai', 'scanner', 'optionslab', 'portfolios', 'fleet', 'insights', 'risk', 'values', 'private', 'realestate', 'money', 'rules', 'brief', 'taxpilot', 'invest', 'analyze', 'leaders', 'short', 'margin', 'aifunds', 'text', 'hotline']) await p.waitForSelector(`#nav a[href="#/${k}"]`, { state: 'attached' }); });
  await step('strategy builder: a design, my tickers, step a value with +, save, today\'s result', async () => {
    await p.goto(B + '/app#/strategies'); await p.waitForSelector('[data-use="bp_four_sleeve"]');
    await p.screenshot({ path: path.join(OUT, 'strategy-builder.png'), fullPage: true });
    await p.click('[data-use="bp_four_sleeve"]'); await p.waitForSelector('#tickers');
    await p.waitForSelector('#walk .banner:has-text("Choose your tickers")');
    await p.click('#exTk'); await p.click('#saveTk'); await p.waitForSelector('#tickers .pill.pos', { timeout: 15000 });
    const len = p.locator('#ruleBody input[data-path="sleeves.0.steps.1.a.2"]');
    const before = +(await len.inputValue());
    await p.locator('#ruleBody input[data-path="sleeves.0.steps.1.a.2"] + button.stp').click();
    if (+(await len.inputValue()) !== before + 1) throw new Error('+ did not step the value');
    await p.click('#saveRules'); await p.waitForSelector('#walk table.walk', { timeout: 20000 });
    await p.screenshot({ path: path.join(OUT, 'strategy-editor.png'), fullPage: true });
  });
  await step('AI assistant answers (basic mode)', async () => {
    await go('#/ai', '#ask'); await p.fill('#ask textarea', 'How does AAPL look technically?'); await p.click('#send');
    await p.waitForSelector('.msg.assistant:not(.typing)', { timeout: 20000 });
  });
  await step('scanner runs', async () => { await go('#/scanner', '#scan'); await p.fill('#scan textarea[name=rules]', 'Close > 0'); await p.click('#runScan'); await p.waitForSelector('#scanOut table', { timeout: 30000 }); });
  await step('scanner saves', async () => { await p.click('#saveScan button'); await okText('#saveScan'); });
  await step('portfolio backtest and save', async () => {
    await go('#/portfolios', '#bk'); await p.selectOption('#bk select[name=universe]', 'etfs'); await p.click('#bkTest'); await p.waitForSelector('#bkCh', { timeout: 60000 });
    await p.click('#bkSave button'); await p.waitForSelector('[data-a=deploy]', { timeout: 30000 });
    await p.click('[data-a=deploy]'); await p.waitForSelector('[data-a=stop]', { timeout: 15000 });
  });
  await step('signal channel: create, follow, send', async () => {
    await go('#/fleet', '#newChan'); await p.click('#newChan button'); await p.waitForSelector('#newHook .banner');
    await go('#/fleet', '[data-pub] button'); await p.click('[data-pub] button'); await p.click('#subForm button'); await p.waitForTimeout(1200);
    await go('#/fleet', '[data-c] form.sig'); await p.fill('[data-c] input[name=symbol]', 'AAPL'); await p.click('[data-c] form.sig button');
    await p.waitForFunction(() => /Sent to/.test(document.querySelector('[data-c] .ok')?.textContent || ''), null, { timeout: 15000 });
  });
  await step('marketplace lists shared items', async () => { await go('#/marketplace?tab=portfolios', '.cards'); });
  await step('risk limits and kill switch', async () => {
    await go('#/risk', '#rk'); await p.fill('#rk input[name=maxOrderUsd]', '5000'); await p.click('#rk button'); await okText('#rk');
    await p.click('#kill'); await p.waitForSelector('.killcard.on', { timeout: 15000 }); await p.click('#kill'); await p.waitForSelector('.killcard:not(.on)', { timeout: 15000 });
  });
  await step('insights and journal', async () => { await go('#/insights', '#twrCh'); await go('#/insights?tab=journal', '#jt'); await go('#/insights?tab=execution', 'table'); });
  await step('values investing: screen, maaser, Shabbos times', async () => {
    await go('#/values', '#hs'); await p.click('#hs button'); await p.waitForSelector('#hsOut table');
    await go('#/values?tab=maaser', '#mz'); await p.fill('#mz input[name=otherIncome]', '5000'); await p.click('#mz button'); await p.waitForSelector('#mzOut .stats');
    await go('#/values?tab=shabbos', '#sh'); await p.waitForSelector('text=Coming up');
  });
  await step('private markets and real estate', async () => {
    await go('#/private', '#add'); await p.fill('#add [name=name]', 'Seed round'); await p.fill('#add [name=invested]', '5000'); await p.fill('#add [name=value]', '8000'); await p.click('#add button'); await p.waitForSelector('text=Seed round');
    await go('#/realestate', '#add'); await p.fill('#add [name=name]', 'Two-family'); await p.fill('#add [name=value]', '500000'); await p.fill('#add [name=rent]', '4000'); await p.click('#add button'); await p.waitForSelector('text=Two-family');
  });
  await step('all my money and a crypto wallet form', async () => { await go('#/money', '#wf'); await p.waitForSelector('text=Cash flow'); });
  await step('all accounts: add a sub account, group, equalize preview', async () => {
    await go('#/accounts', '#addAcc');
    await p.fill('#addAcc [name=label]', 'Sub E2E'); await p.fill('#addAcc [name=keyId]', 'SUBE2EKEY'); await p.fill('#addAcc [name=secret]', 'SUBE2ESECRET');
    await p.click('#addAcc button'); await okText('#addAcc');
    await p.waitForFunction(() => /Sub E2E/.test(document.querySelector('table.accts')?.textContent || ''), null, { timeout: 15000 });
    await p.fill('#addAcc [name=label]', 'Sub E2E two'); await p.fill('#addAcc [name=keyId]', 'SUBE2EKEY2'); await p.fill('#addAcc [name=secret]', 'SUBE2ESECRET2');
    await p.click('#addAcc button'); await okText('#addAcc');
    await p.waitForFunction(() => /Sub E2E two/.test(document.querySelector('table.accts')?.textContent || '') && document.querySelectorAll('#grpCard [name=acc]').length >= 2, null, { timeout: 15000 });
    await p.waitForTimeout(400);
    await p.waitForSelector('#eqAll'); await p.waitForSelector('.stats .stat');
    await p.fill('#grpCard [name=name]', 'Family'); await p.check('#grpCard [name=acc] >> nth=0'); await p.check('#grpCard [name=acc] >> nth=1');
    await p.click('#grpCard button:has-text("Save group")'); await okText('#grpCard');
    await p.waitForSelector('#views button:has-text("Family")', { timeout: 15000 });
    await p.click('#eqPreview'); await p.waitForFunction(() => /The mix|No trades needed|trade/.test(document.querySelector('#eqOut')?.textContent || '') || document.querySelector('#eqErr')?.textContent, null, { timeout: 15000 });
    const eqErr = await p.textContent('#eqErr'); if (eqErr) throw new Error('Equalize preview: ' + eqErr);
    await p.screenshot({ path: path.join(OUT, 'all-accounts.png'), fullPage: true });
    await p.click('#views button:has-text("Family")'); await p.waitForFunction(() => /Family/.test(document.querySelector('#views .on')?.textContent || ''));
  });
  await step('equalize from Home and from Positions', async () => {
    // A full reload: the account list in the page is cached for a minute and the sub accounts were just added.
    await p.goto(B + '/app#/dashboard'); await p.reload(); await p.waitForSelector('#acctBoxes .acctboxes', { timeout: 15000 });
    if (!(await p.$('#eqNow'))) throw new Error('no Equalize now button: ' + (await p.innerHTML('#acctBoxes')).slice(0, 1500));
    await p.waitForTimeout(1500); await p.evaluate(() => document.querySelector('#acctBoxes').scrollIntoView()); await p.screenshot({ path: path.join(OUT, 'home-equalize.png') }); await p.click('#eqNow');
    await p.waitForFunction(() => document.querySelector('dialog[open]') || /\S/.test(document.querySelector('#eqNowOut')?.textContent || ''), null, { timeout: 15000 });
    if (await p.$('dialog[open]')) { await p.keyboard.press('Escape'); await p.waitForTimeout(300); }
    const eqHome = await p.textContent('#eqNowOut'); if (/err/.test(await p.innerHTML('#eqNowOut')) && !/same mix/.test(eqHome)) throw new Error('Equalize now: ' + eqHome);
    await go('#/positions', 'h1'); await p.waitForTimeout(2500);
    if (!(await p.$('#posAcct'))) throw new Error('no account name on Positions: ' + (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(400, 1600));
    // The button shows when the account holds two or more stocks or funds (the math: test/batch19.test.js).
    if (await p.$('#eqPos')) {
      await p.click('#eqPos'); await p.waitForSelector('#eqPosF'); await p.screenshot({ path: path.join(OUT, 'positions-equalize.png') }); await p.click('#eqPosF button');
      await p.waitForFunction(() => document.querySelector('dialog[open]') || /\S/.test(document.querySelector('#eqPosOut')?.textContent || ''), null, { timeout: 15000 });
      if (await p.$('dialog[open]')) await p.keyboard.press('Escape');
    }
  });
  await step('marketplace section: overview, AI bots, top traders tabs', async () => {
    await go('#/marketplace', '.mk-hub'); await p.waitForTimeout(1500); await p.screenshot({ path: path.join(OUT, 'marketplace.png'), fullPage: true }); await go('#/aimarket', '.viewtabs button.on');
    await go('#/traders', '.viewtabs'); await p.goto(B + '/app#/aibots?tab=market'); await p.waitForFunction(() => location.hash === '#/aimarket', null, { timeout: 15000 });
    await go('#/sharedstrategies', '.viewtabs'); await go('#/signalchannels', '.viewtabs');
  });
  await step('tokenized securities: sections and checklist', async () => {
    await go('#/tokenized', '#tkKinds .tk-kind'); await p.waitForTimeout(1500); await p.screenshot({ path: path.join(OUT, 'tokenized.png'), fullPage: true }); await p.click('[data-tkc] >> nth=0'); await p.waitForFunction(() => /^1 of/.test(document.querySelector('#tkCount')?.textContent || ''));
  });
  await step('rule across accounts: create, check, prepare', async () => {
    await go('#/rules', '#rf'); await p.click('[data-tpl="sp500"]'); await p.click('#save'); await p.waitForSelector('.rulecard');
    await p.click('[data-preview]'); await p.waitForSelector('[id^=pv] table', { timeout: 20000 });
    await p.screenshot({ path: path.join(OUT, 'rules.png'), fullPage: true });
  });
  await step('luach: zmanim, month and the tzedakah ledger', async () => {
    await go('#/luach', '.zmanim'); await p.waitForSelector('.hdate');
    await go('#/luach?tab=month', '.lgrid .lday');
    await go('#/luach?tab=tzedakah', '#tz'); await p.fill('#tz [name=amount]', '36'); await p.fill('#tz [name=recipient]', 'Hatzolah'); await p.click('#tz button'); await p.waitForSelector('text=Hatzolah');
    await p.screenshot({ path: path.join(OUT, 'luach.png'), fullPage: true });
  });
  await step('weekly brief and tax autopilot', async () => {
    await go('#/brief', '#write'); await p.click('#write'); await p.waitForSelector('.briefcard h2', { timeout: 30000 });
    await go('#/taxpilot', '#lotf');
  });
  await step('property detail shows the live value card; settings show add-ons', async () => {
    await go('#/realestate', '[data-open]'); await p.click('[data-open]'); await p.waitForSelector('text=Live value and rent');
    await go('#/settings', '#addonsCard');
  });
  await step('paper: buy, then sell all matches the paper account', async () => {
    await go('#/dashboard', '#ticket'); await p.fill('#ticket [name=symbol]', 'MSFT'); await p.fill('#ticket [name=qty]', '3');
    await p.click('#qPlace'); await p.waitForFunction(() => /MSFT: filled/.test(document.querySelector('#ticket .ok')?.textContent || ''), null, { timeout: 15000 });
    await go('#/dashboard', '#ticket'); await p.fill('#ticket [name=symbol]', 'MSFT'); await p.click('#qSide [data-s=sell]');
    await p.waitForSelector('#sellAll', { timeout: 15000 }); await p.click('#sellAll');
    if (await p.inputValue('#ticket [name=qty]') !== '3') throw new Error('Sell all did not take the 3 shares held');
    await p.click('#qPlace'); await p.waitForFunction(() => /MSFT: filled/.test(document.querySelector('#ticket .ok')?.textContent || ''), null, { timeout: 15000 });
    const h = await p.evaluate(() => fetch('/api/desk/quote/MSFT?account=paper', { headers: { 'X-Requested-With': 'qp' } }).then(r => r.json()));
    if (h.holding.qty !== 0) throw new Error(`still holding ${h.holding.qty} MSFT`);
    const r = await p.evaluate(() => fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify({ account: 'paper', symbol: 'MSFT', side: 'sell', qty: 1 }) }).then(x => x.status));
    if (r === 200) throw new Error('a sell of shares not held went through');
  });
  await step('paper limit order waits, then cancels', async () => {
    await go('#/dashboard', '#ticket'); await p.fill('#ticket [name=symbol]', 'SPY'); await p.selectOption('#ticket [name=type]', 'limit');
    await p.fill('#ticket [name=qty]', '1'); await p.fill('#ticket [name=limit_price]', '1'); await p.waitForSelector('#qGuide .oguide .og-facts');
    await (await p.$('#ticket')).screenshot({ path: path.join(OUT, 'order-type-box.png') });
    await p.click('#qPlace'); await p.waitForFunction(() => /open/.test(document.querySelector('#ticket .ok')?.textContent || ''), null, { timeout: 15000 });
    await go('#/dashboard', '[data-pcancel]'); await p.click('[data-pcancel]'); await p.waitForTimeout(800);
  });
  await step('futures, funds & savings; growth and value scan; stat-arb live scan; search', async () => {
    await go('#/invest', '[data-trade]'); await go('#/invest?tab=funds', '[data-buy]'); await go('#/invest?tab=savings', '#sg');
    await go('#/scanner', '#gvRun'); await p.click('#gvRun'); await p.waitForSelector('#gvOut table, #gvOut p', { timeout: 60000 });
    await go('#/statarb', '#scanGo'); await p.selectOption('#scanU', 'Banks'); await p.click('#scanGo'); await p.waitForSelector('.scanstat:has-text("Done")', { timeout: 60000 });
    await p.screenshot({ path: path.join(OUT, 'statarb-scan.png'), fullPage: true });
    await p.click('#searchBtn'); await p.fill('dialog.search #sq', 'futures'); await p.waitForSelector('dialog.search a.sitem[href="#/invest"]'); await p.keyboard.press('Escape');
  });
  await step('round-ups import', async () => { await go('#/spend', '#csv'); await p.fill('#csv', '2026-10-20,STARBUCKS #1,5.45\n2026-10-21,AMAZON,23.10'); await p.click('#imp'); await p.waitForFunction(() => /purchases read/.test(document.body.textContent), null, { timeout: 15000 }); });
  await step('news sentiment', async () => { await go('#/news', '#nf'); await p.waitForSelector('#sent .cards', { timeout: 20000 }); });
  await step('chart draws with candles and a trend line', async () => {
    await go('#/chart?symbol=AAPL', '.cpanel canvas'); await p.waitForFunction(() => /Scroll|Daily|Simulated/.test(document.querySelector('.cnote')?.textContent || ''), null, { timeout: 20000 });
    await p.click('[data-tool=trend]'); const b = await p.locator('.cpanel canvas').boundingBox();
    await p.mouse.move(b.x + 100, b.y + 100); await p.mouse.down(); await p.mouse.move(b.x + 300, b.y + 60); await p.mouse.up();
    await p.waitForSelector('[data-l="2"][data-locked]'); // 2-chart layouts come with Pro
  });
  await step('options lab template and payoff', async () => {
    await go('#/optionslab?symbol=AAPL', '.tpls'); await p.click('[data-t=bull_call]');
    await p.waitForFunction(() => document.querySelectorAll('#legs tr[data-i]').length >= 1 || /market|No contracts|expiration/i.test(document.querySelector('#tErr')?.textContent || ''), null, { timeout: 20000 });
    if (!(await p.$('#legs tr[data-i]'))) { await p.fill('#spot', '100'); await p.dispatchEvent('#spot', 'change'); await p.click('#addLeg'); }
    await p.waitForSelector('#pstats .stat', { timeout: 15000 });
  });
  await step('tax settings save (state, automatic rates)', async () => {
    await go('#/settings', '#taxs select[name=state]');
    await p.selectOption('#taxs select[name=state]', { index: 5 });
    await p.click('#taxs button:has-text("Save")');
    await okText('#taxs');
  });
  await step('tax page shows Schedule D', async () => { await go('#/tax', '.card'); await p.waitForFunction(() => /Schedule D/.test(document.body.textContent)); });
  await step('bots page offers frequency', async () => { await go('#/bots', 'h1'); });
  await step('lesson, long-term view, workspace, execution log', async () => {
    await go('#/learn', 'form.lesson'); const f = p.locator('form.lesson[data-id=crypto]');
    await f.locator('[name=q0][value="1"]').check(); await f.locator('[name=q1][value="1"]').check(); await f.locator('button').click();
    await p.waitForFunction(() => /lesson complete/.test(document.querySelector('form.lesson[data-id=crypto] .ok')?.textContent || ''), null, { timeout: 15000 });
    await go('#/longterm', '#ltc'); await go('#/workspace', '.wpanel'); await go('#/execution', '#rt');
    await p.click('#ver'); await p.waitForFunction(() => /check out/.test(document.querySelector('#vOut')?.textContent || ''), null, { timeout: 15000 });
  });
  await step('AI bots: plain English to rules, backtest, create', async () => {
    await go('#/aibots', '#nl'); await p.fill('#nl textarea', 'Buy QQQ when 2-day RSI crosses below 10, sell when RSI is above 70, stop loss 6%');
    await p.click('#nl button:not([type])'); await p.waitForSelector('#nlBot'); await p.click('#nlBt'); await p.waitForSelector('#nlCv', { timeout: 30000 });
    await p.click('#nlGo'); await p.waitForSelector('[data-on]', { timeout: 15000 });
  });
  await step('agents: boundaries save, token created', async () => {
    await go('#/agenthub', '#bnd'); await p.fill('#bnd [name=maxOrderUsd]', '500'); await p.click('#bnd button'); await okText('#bnd');
    await p.fill('#tokName', 'Claude'); await p.click('#newTok'); await p.waitForSelector('#tokOut code');
  });
  await step('AI signals and market intelligence open', async () => { await go('#/aisignals', '#auto'); await go('#/intel', '#askF'); await p.fill('#askF [name=q]', 'dark pool activity in AAPL'); await p.click('#askF button'); await p.waitForSelector('#askOut .card'); });
  await step('chart co-pilot answers and draws', async () => {
    await go('#/chart?symbol=AAPL', '#cpForm'); await p.waitForTimeout(800); await p.fill('#cpQ', 'show support and resistance and trendlines'); await p.click('#cpForm button:not([type])');
    await p.waitForSelector('#cpOut b', { timeout: 30000 }); await p.check('[data-ind=ai]');
  });
  await step('glossary tooltip explains a term', async () => { await go('#/longterm', '.gl'); await p.click('.gl'); await p.waitForSelector('.glpop:not([hidden])'); });
  await step('close all positions from the header (typed CLOSE and the password)', async () => {
    await p.evaluate(() => fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify({ account: 'paper', symbol: 'MSFT', side: 'buy', type: 'market', qty: 2 }) }));
    await go('#/dashboard', '#closeAllBtn'); await p.click('#closeAllBtn');
    await p.waitForSelector('dialog.secure[open]'); await p.fill('dialog.secure input[name=password]', 'Str0ngPassword'); await p.fill('dialog.secure input[name=typed]', 'CLOSE');
    await p.check('dialog.secure input[name=ok]'); await p.click('dialog.secure button[value=yes]');
    await p.waitForFunction(async () => (await (await fetch('/api/account?account=paper')).json()).positions.length === 0, null, { timeout: 15000, polling: 500 });
  });
  await step('lock on Security, then unlock', async () => {
    await go('#/security', '#lockNow'); await p.click('#lockNow'); await p.waitForSelector('#unl', { timeout: 15000 });
    await p.waitForSelector('#unl'); await p.fill('#unl input[name=password]', 'Str0ngPassword'); await p.click('#unl button');
    await p.waitForSelector('#unl .ok, .killcard + .card', { timeout: 15000 });
    await p.waitForFunction(() => /work again/.test(document.body.textContent), null, { timeout: 15000 });
  });
  done(); await ctx.close();
}

// ---------- layout audit: no sideways scrolling and no zooming inputs on any page ----------
for (const [device, width, lang] of [['iPhone 13', 390, 'en'], ['iPhone SE', 320, 'en'], ['iPhone SE', 320, 'yi']]) {
  console.log(`Layout audit (${device}, ${width}px${lang === 'yi' ? ', Yiddish' : ''})`);
  const ctx = await browser.newContext({ ...devices[device] });
  if (lang === 'yi') await ctx.addInitScript(() => localStorage.setItem('qp_lang', 'yi'));
  const p = await ctx.newPage();
  const { step, done } = harness(p, device.replace(' ', '') + (lang === 'yi' ? '-yi' : ''));
  const email = `audit${width}${lang}@example.com`;
  await p.goto(B + '/app#/register'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', 'Str0ngPassword'); await p.check('input[name=agree]');
  await p.tap("form.auth button:not([type=button])"); await p.waitForSelector('#tabs a.on');
  await p.evaluate(() => fetch('/api/alpaca/keys', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify({ keyId: 'AUDIT' + innerWidth, secret: 'S' }) }));
  await p.evaluate(() => localStorage.setItem('qp_account', 'alpaca'));
  const lib = await p.evaluate(() => fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify({ blueprintId: 'bp_four_sleeve', fillExamples: true }) }).then(r => r.json()));
  for (const r of ['/', '/yi', '/terms', '/app#/register', '/app#/login', '#/dashboard', '#/trade?symbol=AAPL', '#/orders', '#/positions', '#/watchlists', '#/markets', '#/options?underlying=AAPL', '#/calendar', '#/account', '#/open-account', '#/brokers', '#/strategies', `#/strategy?id=${lib.id}`, '#/signals', '#/pairs', '#/statarb', '#/sp500', '#/backtest', '#/bots', '#/schedule', '#/text', '#/tax', '#/funding', '#/settings', '#/chart?symbol=AAPL', '#/ai', '#/agents', '#/code', '#/news', '#/scanner', '#/optionslab', '#/institutions', '#/portfolios', '#/portfolios?tab=mine', '#/fleet', '#/marketplace', '#/aimarket', '#/sharedstrategies', '#/sharedportfolios', '#/signalchannels', '#/insights', '#/insights?tab=journal', '#/risk', '#/spend', '#/values', '#/values?tab=maaser', '#/values?tab=shabbos', '#/private', '#/realestate', '#/money', '#/rules', '#/android', '#/luach', '#/luach?tab=month', '#/luach?tab=tzedakah', '#/brief', '#/taxpilot', '#/invest', '#/invest?tab=funds', '#/invest?tab=savings', '#/security', '#/execution', '#/learn', '#/longterm', '#/workspace', '#/accounts', '#/wealth', '#/wealth?tab=compound', '#/wealth?tab=auto', '#/wealth?tab=hold', '#/wealth?tab=drip', '#/wealth?tab=understand', '#/wealth?tab=tax', '#/wealth?tab=core', '#/wealth?tab=diversify', '#/alpaca-tools', '#/referrals', '#/riskview', '#/riskview?add=SPY:1000', '#/research', '#/tokenized', '#/protection', '#/retirement', '#/business', '#/invoices', '#/books', '#/bank', '#/inventory', '#/payroll', '#/bizreports', '#/business?tab=settings', '#/traders', '#/robo', '#/currencies', '#/learn?tab=glossary', '#/learn?tab=calc', '#/analyze?symbol=AAPL', '#/analyze?symbol=VOO', '#/lowcost', '#/earnings', '#/leaders', '#/short', '#/margin', '#/aifunds', '#/hotline', '#/admin-sponsored', '#/admin-agents', '#/agenthub', '#/aibots', '#/aibots?tab=new', '#/aibots?tab=mine', '#/aibots?tab=market', '#/aisignals', '#/intel']) {
    await step(r, async () => {
      await p.goto(r.startsWith('#') ? B + '/app' + r : B + r); if (r === '#/dashboard') await p.reload();
      await p.waitForTimeout(r.includes('strategy') || r.includes('sp500') ? 3000 : 1300);
      const a = await p.evaluate(() => ({
        w: Math.max(innerWidth, document.documentElement.scrollWidth),
        small: [...document.querySelectorAll('input, select, textarea')].filter(e => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).length,
      }));
      if (a.w > width) throw new Error(`page is ${a.w}px wide on a ${width}px screen`);
      if (a.small) throw new Error(`${a.small} inputs under 16px (iOS zooms on focus)`);
    });
  }
  done(); await ctx.close();
}

await browser.close();
server.kill(); mock.close();
fs.writeFileSync(path.join(OUT, 'server.log'), serverLog.join(''));
console.log(failures ? `\n${failures} failure(s). Screenshots: e2e-output/` : '\nAll end-to-end checks passed. Screenshots: e2e-output/');
process.exit(failures ? 1 : 0);
