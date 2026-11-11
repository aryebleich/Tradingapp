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
