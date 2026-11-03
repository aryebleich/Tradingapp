// The AI assistant's trading tools: quotes and history, practice orders (prepared, then sent with
// the button), order status and buying power, and read-only real-money balances.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './mock-alpaca.js';

const mock = await startMock();
mock.autoFill = true;
Object.assign(process.env, { ALPACA_TRADING_URL: mock.url, ALPACA_LIVE_URL: mock.liveUrl, ALPACA_DATA_URL: mock.url, ALPACA_DATA_SANDBOX_URL: mock.url, ALPACA_KEY_ID: 'DKEY', ALPACA_SECRET: 'DSECRET', ANTHROPIC_API_KEY: 'test-only' }); // a non-free provider: account figures may be shared (Admin → AI & privacy default)
const { app } = await import('../server.js');
const { tradingTools, cleanPaperOrder } = await import('../src/aitrading.js');
const { one } = await import('../src/db.js');

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

test('order checks in plain words', () => {
  assert.throws(() => cleanPaperOrder({ symbol: 'AAPL', side: 'buy' }, 'builtin'), /how many shares, or how many dollars/);
  assert.throws(() => cleanPaperOrder({ symbol: 'AAPL', side: 'buy', type: 'limit', qty: 1 }, 'builtin'), /needs a limit price/);
  assert.throws(() => cleanPaperOrder({ symbol: 'AAPL', side: 'buy', type: 'limit', dollars: 100, limit_price: 1 }, 'builtin'), /Dollar amounts work with market orders/);
  assert.throws(() => cleanPaperOrder({ symbol: 'AAPL261218C00200000', side: 'buy', qty: 1 }, 'builtin'), /need an Alpaca paper account/);
  assert.equal(cleanPaperOrder({ symbol: 'btcusd', side: 'buy', dollars: 50 }, 'alpaca').symbol, 'BTC/USD');
  assert.equal(cleanPaperOrder({ symbol: 'BTC/USD', side: 'buy', qty: 0.01 }, 'alpaca').time_in_force, 'gtc');
  assert.equal(cleanPaperOrder({ symbol: 'AAPL261218C00200000', side: 'buy', qty: 2, type: 'limit', limit_price: 3 }, 'alpaca').assetClass, 'option');
});

test('built-in practice account: quote, history, prepare then send, status and buying power', async () => {
  const c = client(); await c('/auth/register', { email: 'ai-paper@example.com', password: 'Str0ngPassword1', agree: true });
  const user = await one("SELECT * FROM users WHERE email = 'ai-paper@example.com'");
  const ctx = {}, T = tradingTools(user, ctx);
  const q = await T.live_quote.run({ symbol: 'AAPL' });
  assert.ok(q.price > 0); assert.equal(q.kind, 'stock or ETF'); assert.ok('youOwn' in q);
  const h = await T.price_history.run({ symbol: 'SPY', period: '6M' });
  assert.ok(h.startPrice > 0 && h.endPrice > 0 && h.points.length <= 41 && typeof h.changePercent === 'number');
  // Prepared, not sent.
  const p = await T.prepare_paper_order.run({ symbol: 'AAPL', side: 'buy', dollars: 500 });
  assert.equal(p.shownToUser, true); assert.match(ctx.order.summary, /Buy \$500 of AAPL, at the current price \(market order\)\. Practice money, in your Brightfolio practice account\./);
  assert.equal((await one("SELECT COUNT(*) n FROM fills WHERE user_id = ?", user.id)).n, 0);
  // The button sends it.
  const r = await c('/ai/paper-order', ctx.order);
  assert.equal(r.status, 200); assert.equal(r.body.status, 'filled'); assert.ok(r.body.filledQty > 0);
  const o = await T.paper_orders.run({ symbol: 'AAPL' });
  assert.equal(o.orders[0].status, 'filled'); assert.ok(o.orders[0].filledQty > 0);
  const bp = await T.paper_buying_power.run({});
  assert.ok(bp.buyingPower < 100000 && bp.buyingPower > 99000);
  // A limit order waits for its price.
  const lim = await c('/ai/paper-order', { symbol: 'AAPL', side: 'buy', type: 'limit', qty: 1, limit_price: 1 });
  assert.match(lim.body.status, /open/);
  // No real account connected.
  assert.match((await T.live_balances.run({})).note, /No real-money account/);
});

test('Alpaca paper account: practice orders go through the Trading API (stocks, crypto, options)', async () => {
  const c = client(); await c('/auth/register', { email: 'ai-alpaca@example.com', password: 'Str0ngPassword1', agree: true });
  assert.equal((await c('/alpaca/keys', { keyId: 'AIPAPER', secret: 'S' })).status, 200);
  const user = await one("SELECT * FROM users WHERE email = 'ai-alpaca@example.com'");
  const ctx = {}, T = tradingTools(user, ctx);
  await T.prepare_paper_order.run({ symbol: 'MSFT', side: 'buy', qty: 3 });
  assert.match(ctx.order.summary, /your Alpaca paper account/);
  const sent = n => mock.log.filter(x => x.method === 'POST' && x.path === '/v2/orders' && x.headers['apca-api-key-id'] === 'AIPAPER').length >= n;
  let r = await c('/ai/paper-order', ctx.order); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(sent(1));
  r = await c('/ai/paper-order', { symbol: 'BTC/USD', side: 'buy', dollars: 100 }); assert.equal(r.status, 200, JSON.stringify(r.body));
  const crypto = mock.log.filter(x => x.path === '/v2/orders' && x.method === 'POST').at(-1).body;
  assert.equal(crypto.symbol, 'BTC/USD'); assert.equal(crypto.time_in_force, 'gtc'); assert.equal(+crypto.notional, 100);
  r = await c('/ai/paper-order', { symbol: 'AAPL261218C00200000', side: 'buy', qty: 1, type: 'limit', limit_price: 2.5 }); assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = await T.paper_orders.run({});
  assert.equal(o.account, 'your Alpaca paper account'); assert.ok(o.orders.length >= 3); assert.ok('filledQty' in o.orders[0]);
  const bp = await T.paper_buying_power.run({}); assert.ok(bp.buyingPower > 0);
  // Holdings appear in the quote for that account.
  const q = await T.live_quote.run({ symbol: 'AAPL', account: 'alpaca' }); assert.ok(q.youOwn);
});
