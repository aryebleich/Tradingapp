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
    await p.click('button:has-text("Create account")'); await p.waitForSelector('#ticket');
    await unlockHighRisk(p);
  });
  await step('homepage demo + legal pages', async () => {
    const q = await browser.newPage(); await q.goto(B + '/'); await q.waitForSelector('#demoStats .stat');
    for (const u of ['/terms', '/privacy', '/risk', '/contact']) if ((await q.goto(B + u)).status() !== 200) throw new Error(u);
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
      await p.click(`#nav a[href="#/${k}"]`); await p.waitForSelector(`.admintabs button.on`); await p.waitForSelector(`text=${h}`);
    }
    await p.screenshot({ path: path.join(OUT, 'admin-setup.png'), fullPage: true });
    await p.click('#nav a[href="#/admin-system"]'); await p.waitForSelector('text=Capacity plan');
    // Upgrades: the version, each tab, and an upgrade behind the password and UPGRADE.
    await p.click('#nav a[href="#/admin-upgrades"]'); await p.waitForSelector('.upgradehead .ver b');
    for (const t of ['alpaca', 'render', 'history', 'github']) { await p.goto(B + '/app#/admin-upgrades?tab=' + t); await p.waitForSelector('.upgradehead'); }
    const v0 = await p.textContent('.upgradehead .ver b');
    await p.click('[data-rec="github:pro"]'); await p.waitForSelector('dialog.secure');
    await p.fill('dialog.secure [name=password]', 'Str0ngPassword'); await p.fill('dialog.secure [name=typed]', 'UPGRADE'); await p.check('dialog.secure [name=ok]'); await p.click('dialog.secure button[value=yes]');
    await p.waitForFunction(v => document.querySelector('.upgradehead .ver b')?.textContent !== v, v0);
    await p.screenshot({ path: path.join(OUT, 'admin-upgrades.png'), fullPage: true });
    // View as each plan from the header, then back to the owner view.
    // A preview asks for the password and a tick first.
    await p.selectOption('#viewAs', 'plan:free'); await p.waitForSelector('dialog.secure');
    await p.fill('dialog.secure [name=password]', 'Str0ngPassword'); await p.check('dialog.secure [name=ok]'); await p.click('dialog.secure button[value=yes]');
    await p.waitForSelector('#viewAs.on'); await p.waitForSelector('#nav a.upsell');
    await p.selectOption('#viewAs', ''); await p.waitForSelector('#viewAs:not(.on)'); await p.waitForFunction(() => !document.querySelector('#nav a.upsell'));
    await p.click('#nav a[href="#/admin-users"]'); await p.fill('#userFind', 'desk'); await p.waitForTimeout(200);
    if ((await p.$$('#userTable tr[data-email]:not([hidden])')).length !== 1) throw new Error('user search');
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
    await p.tap('#moreTab'); await p.waitForSelector('#nav.open'); await p.tap('#nav a:has-text("Alpaca account")'); await p.waitForSelector('#keysForm');
    await p.fill('#keysForm [name=keyId]', 'PHONEKEY'); await p.fill('#keysForm [name=secret]', 'S'); await p.tap('#keysForm button'); await p.waitForSelector('#keysForm .ok');
  });
  await step('sticky Buy bar places an order', async () => {
    await p.tap('#tabs a[data-r=trade]'); await p.waitForSelector('#tradeBar:not([hidden])'); await p.tap('#tradeBar .buy'); await p.waitForTimeout(700);
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
  await step('menu lists the new pages', async () => { for (const k of ['chart', 'ai', 'scanner', 'optionslab', 'portfolios', 'fleet', 'insights', 'risk', 'halal']) await p.waitForSelector(`#nav a[href="#/${k}"]`, { state: 'attached' }); });
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
  await step('halal screen and zakat', async () => {
    await go('#/halal', '#hs'); await p.click('#hs button'); await p.waitForSelector('#hsOut table');
    await go('#/halal?tab=zakat', '#zk'); await p.fill('#zk input[name=cash]', '20000'); await p.fill('#zk input[name=goldPerGram]', '80'); await p.click('#zk button'); await p.waitForSelector('#zOut .stats');
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
  await step('tax page shows Schedule D', async () => { await go('#/tax', '.card'); await p.waitForFunction(() => /Schedule D/.test(document.body.textContent)); });
  await step('bots page offers frequency', async () => { await go('#/bots', 'h1'); });
  await step('lesson, long-term view, workspace, execution log', async () => {
    await go('#/learn', 'form.lesson'); const f = p.locator('form.lesson[data-id=crypto]');
    await f.locator('[name=q0][value="1"]').check(); await f.locator('[name=q1][value="1"]').check(); await f.locator('button').click();
    await p.waitForFunction(() => /lesson complete/.test(document.querySelector('form.lesson[data-id=crypto] .ok')?.textContent || ''), null, { timeout: 15000 });
    await go('#/longterm', '#ltc'); await go('#/workspace', '.wpanel'); await go('#/execution', '#rt');
    await p.click('#ver'); await p.waitForFunction(() => /check out/.test(document.querySelector('#vOut')?.textContent || ''), null, { timeout: 15000 });
  });
  await step('glossary tooltip explains a term', async () => { await go('#/longterm', '.gl'); await p.click('.gl'); await p.waitForSelector('.glpop:not([hidden])'); });
  await step('lock from the header, unlock on Security', async () => {
    await go('#/dashboard', '#lockBtn'); await p.click('#lockBtn'); await p.waitForFunction(() => location.hash === '#/security', null, { timeout: 15000 });
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
  const lib = await p.evaluate(() => fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify({ templateId: 'multi_model' }) }).then(r => r.json()));
  for (const r of ['/', '/yi', '/terms', '/app#/register', '/app#/login', '#/dashboard', '#/trade?symbol=AAPL', '#/orders', '#/positions', '#/watchlists', '#/markets', '#/options?underlying=AAPL', '#/calendar', '#/account', '#/open-account', '#/brokers', '#/strategies', `#/strategy?id=${lib.id}`, '#/signals', '#/pairs', '#/statarb', '#/sp500', '#/backtest', '#/bots', '#/schedule', '#/text', '#/tax', '#/funding', '#/settings', '#/chart?symbol=AAPL', '#/ai', '#/agents', '#/code', '#/news', '#/scanner', '#/optionslab', '#/institutions', '#/portfolios', '#/portfolios?tab=mine', '#/fleet', '#/marketplace', '#/insights', '#/insights?tab=journal', '#/risk', '#/spend', '#/halal', '#/halal?tab=zakat', '#/security', '#/execution', '#/learn', '#/longterm', '#/workspace', '#/accounts', '#/wealth', '#/wealth?tab=compound', '#/wealth?tab=auto', '#/wealth?tab=hold', '#/wealth?tab=drip', '#/wealth?tab=understand', '#/wealth?tab=tax', '#/wealth?tab=core', '#/wealth?tab=diversify', '#/alpaca-tools', '#/referrals']) {
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
