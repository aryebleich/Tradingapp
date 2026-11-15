// Batch 23: the Home AI analysis of today's P/L, and the other features of this batch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './mock-alpaca.js';

const mock = await startMock();
for (const k of ['ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'AI_BASE_URL', 'AI_PROVIDER']) delete process.env[k];
Object.assign(process.env, { ALPACA_TRADING_URL: mock.url, ALPACA_LIVE_URL: mock.liveUrl, ALPACA_DATA_URL: mock.url, ALPACA_DATA_SANDBOX_URL: mock.url, ALPACA_KEY_ID: 'DKEY', ALPACA_SECRET: 'DSECRET' });
const { app } = await import('../server.js');
const { run, one } = await import('../src/db.js');

let server, base;
before(() => new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => { server.close(); mock.close(); });
export const client = () => {
  let cookie = '';
  return async (path, body, method) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
};
const owner = client();
let ownerReady;
const ownerUp = () => (ownerReady ||= owner('/auth/register', { email: 'site-owner@example.com', password: 'Str0ngPassword!9' }));

test('P/L attribution: market, sector and the stock itself add up to the day', async () => {
  const { attribute, plainFactors } = await import('../src/pnlwhy.js');
  const snaps = { SPY: { changePct: -1 }, XLK: { changePct: -3 }, AAPL: { price: 194, changePct: -3, prevDailyBar: { c: 200 } }, XOM: { price: 101, changePct: 1, prevDailyBar: { c: 100 } } };
  const a = attribute({ positions: [{ symbol: 'AAPL', qty: 10, price: 194, value: 1940 }, { symbol: 'XOM', qty: -5, price: 101, value: -505 }], snaps, betas: { AAPL: 1.2 }, sectorOf: s => (s === 'AAPL' ? 'Technology' : 'Energy') });
  assert.equal(a.total, -65); // AAPL -60, the XOM short -5
  const aapl = a.rows.find(r => r.symbol === 'AAPL');
  assert.equal(aapl.market, -24);   // 2000 x 1.2 x -1%
  assert.equal(aapl.sector$, -36);  // 2000 x (-3% - 1.2 x -1%)
  assert.equal(aapl.own, 0);
  const xom = a.rows.find(r => r.symbol === 'XOM');
  assert.equal(xom.short, true); assert.equal(xom.market, 5); // a short gains when the market falls
  for (const r of a.rows) assert.equal(Math.round((r.market + r.sector$ + r.own) * 100) / 100, r.pnl);
  const f = plainFactors(a, { XOM: [{ headline: 'Oil jumps' }] });
  assert.ok(f.length >= 2); assert.ok(Math.abs(f[0].impact) >= Math.abs(f.at(-1).impact));
  assert.match(f.find(x => x.kind === 'stock' && x.name === 'XOM').text, /Oil jumps/);
});

test('Home P/L box: saved per plan interval, early refresh costs credits, the owner can switch it off', async () => {
  await ownerUp();
  const u = await one("SELECT id FROM users WHERE email = 'site-owner@example.com'");
  await run("INSERT INTO positions (user_id, account, symbol, qty, avg_price) VALUES (?, 'paper', 'AAPL', 10, 90) ON CONFLICT DO NOTHING", u.id);
  const a = await owner('/pnlwhy?account=paper');
  assert.equal(a.status, 200);
  assert.equal(a.body.total, 100); // mock: 110 now, 100 yesterday, 10 shares
  assert.ok(a.body.factors.length >= 1);
  assert.equal(a.body.engine, null); // no AI key: plain summary
  assert.equal(a.body.everyMin, 15); // the owner gets the Ultimate interval
  const b = await owner('/pnlwhy?account=paper');
  assert.equal(b.body.at, a.body.at); // saved, not worked out again
  // Early refresh spends the configured credits.
  const before = (await owner('/credits')).body;
  const c = await owner('/pnlwhy/refresh', { account: 'paper' });
  assert.equal(c.status, 200); assert.equal(c.body.charged, 2);
  const afterB = (await owner('/credits')).body;
  assert.equal((before.total ?? before.balance?.total) - (afterB.total ?? afterB.balance?.total), 2);
  // Owner settings.
  const s = await owner('/admin/site/pnlwhy', { on: false, every: { free: 720 } }, 'PUT');
  assert.equal(s.body.on, false); assert.equal(s.body.every.free, 720);
  assert.equal((await owner('/pnlwhy?account=paper')).body.off, true);
  await owner('/admin/site/pnlwhy', { on: true }, 'PUT');
});

// A falling stock: 260 days from 200 down to about 120, with small daily swings.
const falling = Array.from({ length: 260 }, (_, i) => { const c = 200 - i * 0.3 + Math.sin(i) * 1.5; return { o: c + 0.5, h: c + 2, l: c - 2, c, v: 1e6 + (Math.sin(i) < 0 ? 4e5 : 0) }; });
const rising = falling.map(b => ({ ...b })).reverse();

test('short desk: technicals, weakness, squeeze risk and the short plan', async () => {
  const { technicals, weakness, squeezeRisk, shortPlan, SHORT_RULES } = await import('../src/shortdesk.js');
  const t = technicals(falling), up = technicals(rising);
  assert.ok(t.price < t.sma50 && t.sma50 < t.sma200);
  assert.ok(weakness(t) >= 60, 'a steady downtrend scores as weak'); assert.ok(weakness(up) < 20);
  assert.equal(technicals(falling.slice(0, 10)), null); // too little history
  const calm = squeezeRisk(t), hard = squeezeRisk(t, { easyToBorrow: false });
  assert.ok(hard.score > calm.score); assert.match(hard.reasons.join(' '), /hard to borrow/);
  assert.equal(squeezeRisk({ ...t, rsi: 22, vol20: 80, gapUps60: 3, price: 4 }).level, 'high');
  const p = shortPlan({ t, equity: 100000, riskPct: 1, feePct: 3.65, days: 10 });
  assert.ok(p.stop > p.entry && p.targets[0] < p.entry && p.targets[1] < p.targets[0]);
  assert.ok(p.maxLoss <= 1000 + 1e-6 && p.maxLoss > 900); // 1% of equity at the stop
  assert.equal(p.initialMargin, Math.round(p.value * (SHORT_RULES.initial - 1) * 100) / 100);
  assert.equal(p.borrowCost, Math.round(p.value * 0.0365 * 10 / 365 * 100) / 100);
  assert.ok(p.callPrice > p.entry); // a margin call needs the price to rise
});

test('margin switch: off by default, shorts refused until it is on, buying power doubles on the practice account', async () => {
  const u = client();
  await u('/auth/register', { email: 'b23-margin@example.com', password: 'Str0ngPassword!9' });
  await u('/account?account=paper');
  const m0 = (await u('/shortdesk/margin?account=paper')).body;
  assert.equal(m0.status, 'off'); assert.equal(m0.approval, 'none');
  const r = await u('/orders', { symbol: 'AAPL', side: 'sell', qty: 1, account: 'paper', allowShort: true });
  assert.equal(r.status, 409); assert.match(r.body.error, /needs margin/);
  // Without margin a buy is limited to the cash; with it, to Reg T (2x equity).
  assert.match((await u('/orders', { symbol: 'AAPL', side: 'buy', notional: 150000, account: 'paper' })).body.error, /Not enough paper cash/);
  assert.equal((await u('/shortdesk/margin', { account: 'paper', on: true }, 'PUT')).body.status, 'on');
  const big = await u('/orders', { symbol: 'AAPL', side: 'buy', notional: 150000, account: 'paper' });
  assert.equal(big.status, 200, JSON.stringify(big.body));
  const acct = (await u('/account?account=paper')).body;
  assert.ok(acct.cash < 0, 'the practice account borrowed');
  assert.equal((await u('/orders', { symbol: 'MSFT', side: 'sell', qty: 1, account: 'paper', allowShort: true })).status, 200);
  // The desk's other views answer for this account.
  assert.ok((await u('/shortdesk/monitor?account=paper')).body.shorts.some(s => s.symbol === 'MSFT'));
  const h = (await u('/shortdesk/hedge?account=paper')).body;
  assert.ok(h.longValue > 0); assert.equal(h.options.length, 3);
  const th = (await u('/shortdesk/cover-plan', { account: 'paper' })).body;
  assert.equal(th.positions[0].symbol, 'MSFT'); assert.equal(th.engine, null);
  assert.equal((await u('/shortdesk/margin', { account: 'paper', on: false }, 'PUT')).body.status, 'off');
});

test('options desk: Greeks, moneyness, contract economics, time decay and returns', async () => {
  const { greeks, enrich, analyzeContract, moneyness, probAbove } = await import('../src/optionsdesk.js');
  const g = greeks(100, 100, 30 / 365, 0.3, 'call'), p = greeks(100, 100, 30 / 365, 0.3, 'put');
  assert.ok(g.delta > 0.5 && g.delta < 0.56); assert.ok(p.delta < 0 && p.delta > -0.5);
  assert.ok(g.theta < 0 && g.gamma > 0 && g.vega > 0);
  assert.ok(Math.abs((g.price - p.price) - (100 - 100 * Math.exp(-0.04 * 30 / 365))) < 0.01); // put-call parity
  assert.deepEqual([moneyness('call', 95, 100).label, moneyness('call', 100.3, 100).label, moneyness('put', 95, 100).label], ['ITM', 'ATM', 'OTM']);
  assert.ok(Math.abs(probAbove(100, 100, 1, 0.2) - 0.54) < 0.01); // with the 4% rate drift
  const exp = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const c = enrich({ symbol: 'XYZ', type: 'call', strike: 95, expiration: exp, bid: 6.9, ask: 7.1, iv: 0.3 }, 100);
  assert.equal(c.moneyness, 'ITM'); assert.equal(c.mid, 7); assert.equal(c.intrinsic, 5); assert.equal(c.timeValue, 2); assert.equal(c.breakeven, 102);
  const buy = analyzeContract(c, 100, { side: 'buy', qty: 2 });
  assert.equal(buy.cost, 1400); assert.equal(buy.maxLoss, 1400); assert.equal(buy.maxGain, 'unlimited');
  assert.ok(buy.decay[0].value > buy.decay.at(-1).value, 'value decays toward intrinsic'); assert.equal(buy.decay.at(-1).value, 5);
  const up10 = buy.scenarios.find(s => s.move === 10).cells.find(x => x.label === 'At expiry');
  assert.equal(up10.pnl, 1600); // (110 - 95 - 7) x 200
  assert.ok(up10.roi > 100);
  const sell = analyzeContract({ ...c, type: 'put', strike: 90, mid: 1, intrinsic: 0, timeValue: 1, decayPerDay: 3 }, 100, { side: 'sell' });
  assert.equal(sell.maxGain, 100); assert.equal(sell.maxLoss, 8900); assert.match(sell.assignment, /buy 100 shares at 90/);
  assert.ok(sell.thetaPerDay > 0, 'time decay works for a seller');
});

test('options desk over the API: chain, contract, positions, AI strategist without AI', async () => {
  const u = client();
  await u('/auth/register', { email: 'b23-opt@example.com', password: 'Str0ngPassword!9' });
  const ch = (await u('/optdesk/chain/AAPL?expiration=2026-11-20')).body;
  assert.equal(ch.expiration, '2026-11-20'); assert.equal(ch.spot, 110);
  const call150 = ch.contracts.find(c => c.symbol === 'AAPL261120C00150000');
  assert.equal(call150.moneyness, 'OTM'); assert.equal(call150.mid, 5.2); assert.equal(call150.delta, 0.55);
  assert.ok(ch.contracts.some(c => c.type === 'put' && c.moneyness === 'ITM'));
  const k = (await u('/optdesk/contract/AAPL261120P00150000?side=buy&qty=1')).body;
  assert.equal(k.contract.moneyness, 'ITM'); assert.equal(k.analysis.cost, 410);
  assert.equal((await u('/optdesk/contract/NOTANOPTION')).status, 400);
  assert.deepEqual((await u('/optdesk/positions?account=paper')).body.positions, []);
  const s = await u('/optdesk/ai/strategy', { underlying: 'AAPL', outlook: 'bullish', budget: 2000, expiration: '2026-11-20' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.ok(s.body.candidates.length >= 2); assert.equal(s.body.engine, null);
  assert.ok(s.body.candidates.every(c => c.probProfit >= 0 && c.probProfit <= 100));
  assert.equal((await u('/optdesk/exercise', { account: 'paper', symbol: 'AAPL261120C00150000' })).status, 400); // exercise is on Alpaca
});

test('AI hedge funds: multi-strategy book and the option hedge choices', async () => {
  const { multiBook, STYLES, HEDGES, buildBook } = await import('../src/aifunds.js');
  assert.ok(STYLES.multi && HEDGES.puts && HEDGES.putspread);
  const up = n => Array.from({ length: 300 }, (_, i) => 100 * (1 + n / 1000) ** i);
  const pull = Array.from({ length: 300 }, (_, i) => (i < 294 ? 50 + i * 0.2 : 50 + 293 * 0.2 - (i - 293) * 1.5)); // uptrend, then a sharp week down
  const series = { SPY: up(1), TLT: up(-1), GLD: up(0.5), AAA: up(3), BBB: up(2), CCC: up(-2), DDD: pull };
  const book = multiBook(3, series, { canShort: false });
  assert.ok(book.length >= 2);
  assert.ok(book.some(b => /pullback/.test(b.why) && b.symbol === 'DDD'));
  // With puts as protection, the "hedged" style no longer needs an inverse fund.
  assert.ok(!buildBook('hedged', 3, series, { canShort: false, hedge: 'puts' }).some(b => b.symbol === 'SH'));
  assert.ok(buildBook('hedged', 3, series, { canShort: false, hedge: 'etf' }).some(b => b.symbol === 'SH'));
});
