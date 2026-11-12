// Batch 22: scheduled limit orders keep their limit price on every account type, tax lots for
// short sales and covers, and one admin gate in front of every owner-only API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './mock-alpaca.js';
import { realizedGains, taxSummary } from '../src/tax.js';

const mock = await startMock();
Object.assign(process.env, { ALPACA_TRADING_URL: mock.url, ALPACA_LIVE_URL: mock.liveUrl, ALPACA_DATA_URL: mock.url, ALPACA_DATA_SANDBOX_URL: mock.url, ALPACA_KEY_ID: 'DKEY', ALPACA_SECRET: 'DSECRET' });
const { app } = await import('../server.js');
const { placeOrder, limitOf } = await import('../src/brokers.js');
const { one, run } = await import('../src/db.js');

let server, base;
before(() => new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => { server.close(); mock.close(); });
const client = () => {
  let cookie = '';
  return async (path, body, method) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
};
const D = 86400e3, T0 = Date.UTC(2026, 0, 5);

test('limit orders are read, never silently turned into market orders', () => {
  assert.equal(limitOf({}), null);
  assert.equal(limitOf({ type: 'market' }), null);
  assert.deepEqual(limitOf({ type: 'limit', limit_price: 12.5, time_in_force: 'day', extended_hours: true }), { price: 12.5, tif: 'day', extended: true });
  assert.throws(() => limitOf({ type: 'limit' }), /limit price/);
  assert.throws(() => limitOf({ type: 'stop', stop_price: 5 }), /order ticket/);
});

test('a limit order to Alpaca is sent as a limit order with its price', async () => {
  const c = client(); await c('/auth/register', { email: 'lim-alpaca@example.com', password: 'Str0ngPassword1' });
  assert.equal((await c('/alpaca/keys', { keyId: 'LKEY', secret: 'LSECRET' })).status, 200);
  const u = await one("SELECT id FROM users WHERE email = 'lim-alpaca@example.com'");
  const r = await placeOrder(u.id, 'alpaca', { symbol: 'AAPL', side: 'buy', qty: 2, type: 'limit', limit_price: 101.25, time_in_force: 'day', extended_hours: true }, 'schedule');
  assert.equal(r.type, 'limit'); assert.equal(r.limitPrice, 101.25);
  const sent = [...mock.log].reverse().find(x => x.method === 'POST' && x.path === '/v2/orders').body;
  assert.equal(sent.type, 'limit'); assert.equal(sent.limit_price, '101.25'); assert.equal(sent.qty, '2'); assert.equal(sent.extended_hours, true);
  // A dollar amount becomes shares at the limit price (Alpaca takes dollars only on market orders).
  await placeOrder(u.id, 'alpaca', { symbol: 'AAPL', side: 'buy', notional: 1000, type: 'limit', limit_price: 100 }, 'schedule');
  const sent2 = [...mock.log].reverse().find(x => x.method === 'POST' && x.path === '/v2/orders').body;
  assert.equal(sent2.type, 'limit'); assert.equal(sent2.qty, '10'); assert.equal(sent2.notional, undefined);
  // Market orders are unchanged.
  await placeOrder(u.id, 'alpaca', { symbol: 'AAPL', side: 'buy', notional: 50 }, 'schedule');
  assert.equal([...mock.log].reverse().find(x => x.method === 'POST' && x.path === '/v2/orders').body.type, 'market');
});

test('a scheduled limit order on the practice account waits for its price', async () => {
  const c = client(); await c('/auth/register', { email: 'lim-paper@example.com', password: 'Str0ngPassword1' });
  const u = await one("SELECT id FROM users WHERE email = 'lim-paper@example.com'");
  const r = await placeOrder(u.id, 'paper', { symbol: 'AAPL', side: 'buy', qty: 1, type: 'limit', limit_price: 1, time_in_force: 'day' }, 'schedule');
  assert.equal(r.status, 'open'); assert.equal(r.limitPrice, 1);
  assert.equal((await one("SELECT COUNT(*) n FROM fills WHERE user_id = ?", u.id)).n, 0);
  const po = await one("SELECT * FROM paper_orders WHERE user_id = ?", u.id);
  assert.equal(po.type, 'limit'); assert.equal(po.limit_price, 1); assert.equal(po.status, 'open');
  await run("UPDATE paper_orders SET status = 'cancelled' WHERE user_id = ?", u.id);
});

test('tax lots: a sale beyond the shares held is a short; a later buy covers it first', () => {
  const rows = realizedGains([
    { symbol: 'X', side: 'sell', qty: 10, price: 50, at: T0 },          // opens a short of 10
    { symbol: 'X', side: 'buy', qty: 15, price: 40, at: T0 + 10 * D },  // covers 10, buys 5
    { symbol: 'X', side: 'sell', qty: 5, price: 45, at: T0 + 20 * D },  // sells the 5 bought
    { symbol: 'Y', side: 'buy', qty: 3, price: 10, at: T0 },
    { symbol: 'Y', side: 'sell', qty: 5, price: 12, at: T0 + D },       // 3 long sold, 2 short opened
    { symbol: 'Y', side: 'buy', qty: 2, price: 15, at: T0 + 2 * D },    // short covered at a loss
  ]);
  const x = rows.filter(r => r.symbol === 'X');
  assert.deepEqual(x.map(r => [r.qty, r.proceeds, r.cost, r.gain, !!r.short]), [[10, 500, 400, 100, true], [5, 225, 200, 25, false]]);
  const y = rows.filter(r => r.symbol === 'Y');
  assert.deepEqual(y.map(r => [r.qty, r.gain, !!r.short]), [[3, 6, false], [2, -6, true]]);
  assert.ok(rows.filter(r => r.short).every(r => !r.longTerm));
  // A short opened in one year and covered the next counts in the year it is covered.
  const s = taxSummary([{ symbol: 'Z', side: 'sell', qty: 1, price: 100, at: Date.UTC(2025, 11, 20) }, { symbol: 'Z', side: 'buy', qty: 1, price: 80, at: Date.UTC(2026, 0, 10) }], { year: 2026 });
  assert.equal(s.shortTerm, 20);
  assert.equal(taxSummary([{ symbol: 'Z', side: 'sell', qty: 1, price: 100, at: Date.UTC(2025, 11, 20) }], { year: 2025 }).rows.length, 0);
});

test('a covered short at a loss is a wash sale when the short is re-opened within 30 days', () => {
  const rows = realizedGains([
    { symbol: 'W', side: 'sell', qty: 1, price: 10, at: T0 },
    { symbol: 'W', side: 'buy', qty: 1, price: 12, at: T0 + 5 * D },
    { symbol: 'W', side: 'sell', qty: 1, price: 11, at: T0 + 10 * D },
  ]);
  assert.equal(rows[0].gain, -2); assert.equal(rows[0].washSale, true);
});

test('every owner API refuses regular users; admins get through', async () => {
  const c = client(); await c('/auth/register', { email: 'not-owner@example.com', password: 'Str0ngPassword1' });
  for (const p of ['/admin/summary', '/admin/messages', '/admin/system', '/admin/users', '/admin/site/readme', '/admin/hosting', '/admin/seo', '/admin/agents', '/admin/aiteam', '/admin/comms', '/admin/trust', '/admin/streams', '/admin/anything-new', '/biz/overview'])
    assert.ok([401, 403].includes((await c(p)).status), p);
  assert.notEqual((await c('/biz/fx?from=USD&to=USD')).status, 403); // the currency converter is for everyone
  const a = client(); await a('/auth/register', { email: 'owner-check@example.com', password: 'Str0ngPassword1' });
  await run("UPDATE users SET role = 'admin' WHERE email = 'owner-check@example.com'");
  assert.equal((await a('/admin/summary')).status, 200);
});

test('performance-fee percentages are private: not on the homepage or in the public plan data', async () => {
  const fs = await import('node:fs');
  for (const f of ['public/index.html', 'public/yi.html', 'README.md']) {
    const h = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(h, /%\s*(?:of new profits|פון נייע געווינסן)|performance fee/i, f);
  }
  const guest = client();
  const cfg = (await guest('/config')).body;
  for (const p of Object.values(cfg.plans)) assert.equal('perfFee' in p, false, 'perfFee sent to a visitor');
  const owner = client(); await owner('/auth/register', { email: 'fee-owner@example.com', password: 'Str0ngPassword1' });
  await run("UPDATE users SET role = 'admin' WHERE email = 'fee-owner@example.com'");
  assert.equal((await owner('/config')).body.plans.pro.perfFee, 0.10); // admins still see the rates
});

test('every public page names its original at app.brightolio.com; the server replaces it with its own', async () => {
  const fs = await import('node:fs');
  for (const [f, path] of [['index.html', '/'], ['yi.html', '/yi'], ['terms.html', '/terms'], ['privacy.html', '/privacy']]) {
    const h = fs.readFileSync('public/' + f, 'utf8');
    assert.equal((h.match(/<link rel="canonical"/g) || []).length, 1, f);
    assert.ok(h.includes(`<link rel="canonical" href="https://app.brightolio.com${path}">`), f);
  }
  const { transform } = await import('../src/seo.js');
  const served = transform(fs.readFileSync('public/index.html', 'utf8'), 'index', undefined, 'https://example.test');
  assert.equal((served.match(/<link rel="canonical"/g) || []).length, 1);
  assert.equal((served.match(/property="og:url"/g) || []).length, 1);
  assert.match(served, /<link rel="canonical" href="https:\/\/example\.test\/">/);
});

test('market state for the Home clock: evenings, weekends, holidays and early closes are closed', async () => {
  const { session } = await import('../src/desk.js');
  const et = (d, h, m = 0) => Date.UTC(2026, 10, d, h + 5, m); // November: New York is UTC-5
  assert.equal(session(et(11, 10)).open, true);                                // Wed 10:00 AM, Veterans Day: stocks trade
  assert.deepEqual([session(et(11, 21, 30)).open, session(et(11, 21, 30)).status], [false, 'closed']); // 9:30 PM
  assert.deepEqual([session(et(11, 16, 30)).open, session(et(11, 16, 30)).status], [false, 'after-hours']);
  assert.deepEqual([session(et(11, 8)).open, session(et(11, 8)).status], [false, 'pre-market']);
  assert.equal(session(et(14, 11)).open, false);                               // Saturday
  const thanks = session(et(26, 11)); assert.equal(thanks.open, false); assert.equal(thanks.holiday, true); // Thanksgiving
  assert.equal(session(et(27, 12)).open, true); assert.equal(session(et(27, 12)).earlyClose, true);     // day after: open until 1 PM
  assert.equal(session(et(27, 13, 30)).open, false);
  // The clock asks again at the next change: the next close while open, the next open while closed.
  const s = session(et(11, 21, 30)); assert.ok(s.nextOpen > et(11, 21, 30) && s.nextOpen <= et(12, 9, 30));
});

test('customers read only errors about their input; setup errors go to the owner', async () => {
  const { isSetupError, GENERIC, filterErrors, listIssues, clearIssues } = await import('../src/usererrors.js');
  for (const m of ['Enter the limit price', 'Invalid symbol', 'Not enough buying power', 'Wrong password', 'Pick at least two accounts to equalize']) assert.equal(isSetupError(m), false, m);
  for (const m of ['Set STRIPE_SECRET_KEY first', 'QuickBooks is not set up on this server yet', 'Add GITHUB_TOKEN in Admin → Keys', 'SQLITE_ERROR: no such table: x', 'Cannot read properties of undefined (reading id)', 'OAuth is not configured']) assert.equal(isSetupError(m), true, m);
  await clearIssues();
  const send = (user, status, error) => { let out; const res = { statusCode: status, json: b => (out = b) }; filterErrors({ method: 'POST', path: '/x', baseUrl: '/api', user }, res, () => {}); res.json({ error }); return out.error; };
  assert.equal(send({ id: 5, role: 'user' }, 400, 'Set PLAID_SECRET in Admin → Keys'), GENERIC);
  assert.equal(send({ id: 1, role: 'admin' }, 400, 'Set PLAID_SECRET in Admin → Keys'), 'Set PLAID_SECRET in Admin → Keys');
  assert.equal(send({ id: 5, role: 'user' }, 400, 'Enter the limit price'), 'Enter the limit price');
  assert.equal(send(undefined, 500, 'SQLITE_BUSY: database is locked'), GENERIC);
  const list = listIssues();
  assert.equal(list.find(i => /PLAID_SECRET/.test(i.message)).count, 2);
  assert.ok(list.some(i => /SQLITE_BUSY/.test(i.message)) && !list.some(i => /limit price/.test(i.message)));
  await clearIssues();
});

test('the private README says nothing twice', async () => {
  const { organize } = await import('../src/readme-auto.js');
  const a = '<!-- auto:x -->\n## From the code\n- The app is one bundled file and pages open from memory.\n<!-- /auto:x -->';
  const text = `# Guide\n\n## Setup\n- Add the Stripe key in the admin page, then press the button.\n- Add the Stripe key in the admin page, then press the button.\n\n${a}\n\n## Notes\n- The app is one bundled file and pages open from memory.\n- A line that is only here, long enough to count.\n\n## Setup\n- Add the Stripe key in the admin page, then press the button.\n- Another setup step that appears only in the second copy.\n\n## Empty\n- The app is one bundled file and pages open from memory.\n`;
  const out = organize(text);
  assert.equal(out.match(/Add the Stripe key/g).length, 1);
  assert.equal(out.match(/one bundled file/g).length, 1);
  assert.equal(out.match(/^## Setup$/gm).length, 1);
  assert.ok(/Another setup step/.test(out) && /only here/.test(out) && !/## Empty/.test(out) && out.includes(a));
  assert.equal(organize(out), out); // already in order: unchanged
});

test('admin: accounts opened by phone and by text', async () => {
  const { phoneAccounts, signupSettings } = await import('../src/phoneaccounts.js');
  const { run, audit } = await import('../src/db.js');
  const { createUser } = await import('../src/auth.js');
  const a = await createUser({ email: `bytext${Date.now()}@t.co` }), b = await createUser({ email: `p15550001111.x${Date.now()}@phone.invalid` });
  await run('UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?', '+15550002222', a); await audit(a, 'sms_signup', {}, '+15550002222');
  await run('UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?', '+15550001111', b); await audit(b, 'hotline_signup', {}, '+15550001111');
  const list = await phoneAccounts(), A = list.find(x => x.id === a), B = list.find(x => x.id === b);
  assert.deepEqual([A.how, B.how, B.email, B.hasPassword], ['text', 'phone', null, false]);
  assert.match(A.email, /^bytext/);
  assert.equal(typeof signupSettings().text, 'boolean');
});
