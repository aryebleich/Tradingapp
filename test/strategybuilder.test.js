// The strategy builder (designs with empty ticker slots, every rule editable, publishing,
// margin, plan features, the originals in Admin) and real-money orders from the AI assistant.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './mock-alpaca.js';

const mock = await startMock();
mock.autoFill = true;
Object.assign(process.env, { ALPACA_TRADING_URL: mock.url, ALPACA_LIVE_URL: mock.liveUrl, ALPACA_DATA_URL: mock.url, ALPACA_DATA_SANDBOX_URL: mock.url, ALPACA_KEY_ID: 'DKEY', ALPACA_SECRET: 'DSECRET' });
const { app } = await import('../server.js');
const { one, run } = await import('../src/db.js');
const B = await import('../src/rotation/blueprints.js');
const { tradingTools } = await import('../src/aitrading.js');

let server, base;
after(() => { server.close(); mock.close(); });
const client = () => {
  let cookie = '';
  return async (path, body, method) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
};
const owner = client(), user = client(), other = client();
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  await owner('/auth/register', { email: 'sb-owner@example.com', password: 'Str0ngPassword1', agree: true });
  await user('/auth/register', { email: 'sb-user@example.com', password: 'Str0ngPassword1', agree: true });
  await other('/auth/register', { email: 'sb-other@example.com', password: 'Str0ngPassword1', agree: true });
});

test('every original became a renamed design with empty ticker slots', () => {
  assert.equal(B.BLUEPRINTS.length, 7);
  for (const b of B.BLUEPRINTS) {
    assert.doesNotMatch(b.name, /BG Ensemble|Multi-Model|Gold Miner/);
    if (b.slots) {
      assert.ok(Object.values(b.slots).every(s => s.ticker === '' && s.example && s.role));
      assert.ok(!JSON.stringify(b.sleeves).match(/"(TQQQ|SPY|UVXY|SOXL)"/), 'no tickers left in the rules');
      // Leveraged and ordinary tickers are separate kinds of slots.
      assert.ok(Object.entries(b.slots).every(([k, s]) => (k[0] === 'L') === (s.kind === 'lev')));
    } else assert.deepEqual(b.lists, { etf: [], lev: [] });
  }
  const four = B.blueprint('bp_four_sleeve');
  assert.equal(four.slots.L1.example, 'TQQQ'); assert.equal(four.slots.E1.example, 'SPY');
  assert.throws(() => B.materialize(four), /Choose a ticker for: E1/);
  const filled = B.withExamples(four);
  assert.equal(B.materialize(filled).sleeves[0].steps[0].a[1], 'SPY');
});

test('build from a design: choose tickers, step a value up, add a step, then it runs', async () => {
  let s = (await user('/library', { blueprintId: 'bp_bull_bear_switch', name: 'My switch' })).body;
  assert.equal(s.name, 'My switch'); assert.equal(s.ready, false); assert.ok(s.missing.length > 0);
  // Not ready: no walkdown, no automation, a clear message.
  const w0 = await user(`/library/${s.id}/walkdown`, {});
  assert.equal(w0.status, 409); assert.match(w0.body.error, /Choose the tickers first/);
  assert.equal((await user(`/library/${s.id}`, { mode: 'auto' }, 'PUT')).status, 400);
  // Choose tickers (leveraged slots and ordinary slots), RSI 10 → 11, and one more step.
  const d = s.design;
  for (const [k, v] of Object.entries(d.slots)) v.ticker = v.example;
  d.sleeves[0].steps[1].a[2] = 11;
  d.sleeves[0].steps.push({ id: '13', t: 'cmp', a: ['close', '$E1', 0], op: '>', b: ['sma', '$E1', 50], yes: '@$L1', no: '@$E3' });
  d.sleeves[0].steps[0].no = '13';
  let r = await user(`/library/${s.id}`, { spec: d }, 'PUT');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  s = (await user(`/library/${s.id}`)).body;
  assert.equal(s.ready, true); assert.equal(s.spec.sleeves[0].steps[1].a[1], 'QQQ'); assert.equal(s.spec.sleeves[0].steps[1].a[2], 11);
  assert.equal(s.design.sleeves[0].steps[1].a[1], '$E2', 'the design keeps the slot');
  const w = await user(`/library/${s.id}/walkdown`, {}); assert.equal(w.status, 200, JSON.stringify(w.body));
  // A bad edit is refused with a reason; an unknown slot ticker too.
  d.sleeves[0].steps[1].hiTo = 'nowhere';
  assert.match((await user(`/library/${s.id}`, { spec: d }, 'PUT')).body.error, /there is no step "nowhere"/);
  d.sleeves[0].steps[1].hiTo = '@$L1'; d.slots.L1.ticker = 'not a ticker';
  assert.match((await user(`/library/${s.id}`, { spec: d }, 'PUT')).body.error, /not a valid ticker/);
  // Lists: ETFs and leveraged ETFs separately.
  const m = (await user('/library', { blueprintId: 'bp_top_momentum' })).body;
  const md = m.design; md.lists = { etf: ['AAPL', 'MSFT', 'SPY'], lev: ['TQQQ'] }; md.params.lookback = 127;
  assert.equal((await user(`/library/${m.id}`, { spec: md }, 'PUT')).status, 200);
  const m2 = (await user(`/library/${m.id}`)).body;
  assert.deepEqual(m2.spec.params.universe, ['AAPL', 'MSFT', 'SPY', 'TQQQ']); assert.equal(m2.spec.params.lookback, 127);
});

test('plan features: backtest years, publishing, margin and size limits', async () => {
  const s = (await user('/library', { blueprintId: 'bp_blank', fillExamples: true })).body;
  assert.equal(s.ready, true);
  assert.equal((await user(`/library/${s.id}/backtest`, { years: 15 })).status, 402); // free: 10 years
  assert.equal((await user(`/library/${s.id}`, { public: true }, 'PUT')).status, 402); // free: copy only
  assert.equal((await user(`/library/${s.id}`, { leverage: 2 }, 'PUT')).status, 402); // free: no margin
  const plans = (await user('/library/plans')).body;
  assert.equal(plans.current, 'free'); assert.ok(plans.rows.find(r => r[0] === 'Real-money orders from the AI assistant'));
  // Ultimate: publish, and margin only as far as the account allows (the practice account has none).
  await run("UPDATE users SET plan = 'ultimate', plan_status = 'active' WHERE email = 'sb-user@example.com'");
  assert.match((await user(`/library/${s.id}`, { leverage: 2 }, 'PUT')).body.error, /No margin here: The practice account has no margin/);
  assert.equal((await user('/library/margin?account=paper')).body.allowed, 1);
  assert.equal((await user(`/library/${s.id}`, { public: true, notes: 'Trend rule' }, 'PUT')).status, 200);
  const com = (await other('/library/community')).body;
  const pub = com.find(c => c.id === s.id);
  assert.ok(pub && pub.notes === 'Trend rule' && pub.tickers.includes('SPXL') && !('account' in pub));
  const copy = (await other(`/library/community/${s.id}/copy`, {})).body;
  assert.match(copy.name, /\(copy\)/); assert.equal(copy.ready, true);
  // The free plan has 4 sleeves per strategy (enough for every design).
  const big = (await other(`/library/${copy.id}`)).body.design;
  big.sleeves = [0, 1, 2, 3, 4].map(i => ({ ...big.sleeves[0], name: 'S' + i, weight: 0.2 }));
  assert.equal((await other(`/library/${copy.id}`, { spec: big }, 'PUT')).status, 402);
});

test('the originals are kept for the owner only', async () => {
  const o = await owner('/library/originals');
  assert.equal(o.status, 200); assert.ok(o.body.find(t => t.id === 'bg_ensemble' && t.name === 'BG Ensemble' && t.blueprint === 'Regime Decision Tree'));
  assert.equal((await user('/library/originals')).status, 403);
  assert.equal((await user('/library', { templateId: 'bg_ensemble' })).status, 400);
  assert.equal((await owner('/library', { templateId: 'bg_ensemble' })).status, 200);
});

test('AI real-money orders: Ultimate only, turned on with the password, confirmed, within the limit', async () => {
  const c = client(); await c('/auth/register', { email: 'sb-live@example.com', password: 'Str0ngPassword1', agree: true });
  assert.equal((await c('/alpaca/keys', { keyId: 'LIVEKEY', secret: 'S', live: true })).status, 200);
  assert.equal((await c('/ai/live-settings')).body.allowed, false);
  assert.equal((await c('/ai/live-settings', { enabled: true }, 'PUT')).status, 402);
  await run("UPDATE users SET plan = 'ultimate', plan_status = 'active' WHERE email = 'sb-live@example.com'");
  assert.equal((await c('/ai/live-settings', { enabled: true, maxOrder: 500 }, 'PUT')).status, 401); // needs the password
  assert.equal((await c('/ai/live-settings', { enabled: true, maxOrder: 500, password: 'Str0ngPassword1' }, 'PUT')).status, 200);
  const u = await one("SELECT * FROM users WHERE email = 'sb-live@example.com'");
  const { liveSettings } = await import('../src/aitrading.js');
  const ls = await liveSettings(u), ctx = { live: { ...ls, accounts: [{ id: 'alpaca', name: 'Alpaca', live: true, connected: true }] } };
  const T = tradingTools(u, ctx);
  assert.ok(T.prepare_live_order, 'the tool exists once turned on');
  await T.prepare_live_order.run({ symbol: 'AAPL', side: 'buy', dollars: 200 });
  assert.equal(ctx.order.live, true); assert.match(ctx.order.summary, /REAL MONEY/);
  assert.ok(!tradingTools(u, {}).prepare_live_order, 'no tool when it is off');
  // Over the limit: refused. Within it: sent to the live account.
  assert.match((await c('/ai/live-order', { ...ctx.order, dollars: 900 })).body.error, /above your limit of \$500/);
  const r = await c('/ai/live-order', ctx.order);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(mock.log.some(x => x.method === 'POST' && x.path === '/v2/orders' && x.headers['apca-api-key-id'] === 'LIVEKEY'));
  assert.ok(await one("SELECT 1 FROM audit_log WHERE user_id = ? AND event = 'ai_live_order'", u.id));
});
