// Strategy library, Reality Check, pairs trading, S&P 500 plan, other brokerages, deposits with a
// service fee, and the assistant's command mapping.
const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const http = await import('node:http');
const crypto = await import('node:crypto');

// Fake Tradier (token broker) and Helcim, started before the app reads their URLs.
const seen = [];
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', c => (body += c)); req.on('end', () => {
    seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization, token: req.headers['api-token'] });
    const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization && req.headers.authorization !== 'Bearer tok') return json({ fault: { faultstring: 'Invalid Access Token' } }, 401);
    if (req.url === '/v1/user/profile') return json({ profile: { account: { account_number: 'VA123' } } });
    if (req.url === '/v1/accounts/VA123/balances') return json({ balances: { total_equity: 25000, total_cash: 5000, margin: { stock_buying_power: 10000 } } });
    if (req.url === '/v1/accounts/VA123/positions') return json({ positions: { position: { symbol: 'KO', quantity: 10, cost_basis: 600 } } });
    if (req.url.startsWith('/v1/markets/quotes')) return json({ quotes: { quote: { symbol: 'KO', last: 65 } } });
    if (req.url === '/v1/accounts/VA123/orders' && req.method === 'POST') return json({ order: { id: 777, status: 'ok' } });
    if (req.url === '/v1/accounts/VA123/orders') return json({ orders: { order: [{ id: 777, symbol: 'KO', side: 'sell_short', quantity: 3, status: 'filled', avg_fill_price: 65 }] } });
    if (req.url === '/v2/helcim-pay/initialize') return json({ checkoutToken: 'ct_1', secretToken: 'st_secret' });
    json({ error: 'not found ' + req.url }, 404);
  });
});
await new Promise(r => fake.listen(0, r));
const fakeUrl = `http://127.0.0.1:${fake.address().port}`;
Object.assign(process.env, { TRADIER_BASE_URL: fakeUrl + '/v1', HELCIM_API_TOKEN: 'htok', HELCIM_API_URL: fakeUrl, DEPOSIT_FEE_PERCENT: '1', DEPOSIT_FEE_FIXED: '0.5' });

const { app } = await import('../server.js');
const { run, one } = await import('../src/db.js');
const I = await import('../src/rotation/indicators.js');
const E = await import('../src/rotation/engine.js');
const { TEMPLATES } = await import('../src/rotation/templates.js');
const { validateSpec } = await import('../src/rotation/runner.js');
const RC = await import('../src/rotation/reality.js');
const P = await import('../src/pairs.js');
const SP = await import('../src/sp500.js');
const PAY = await import('../src/payments.js');
const { toCommand } = await import('../src/assistant.js');

let server, base;
before(() => new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => { server.close(); fake.close(); });
function client() {
  let cookie = '';
  return async (path, body, method) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}

test('indicators match their definitions', () => {
  const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
  // Wilder's classic example (StockCharts: 70.53, 66.32 with unrounded prices; these are rounded to cents)
  const r = I.rsiSeries(c, 14);
  assert.ok(Math.abs(r[14] - 70.53) < 0.1 && Math.abs(r[15] - 66.32) < 0.1, String(r.slice(14, 16)));
  assert.equal(I.series('sma', [1, 2, 3, 4], 2)[3], 3.5);
  assert.ok(Math.abs(I.series('ret', [100, 110, 121], 2)[2] - 21) < 1e-9);
  assert.ok(Math.abs(I.series('avgret', [100, 110, 121], 2)[2] - 10) < 1e-9);
  assert.equal(I.series('high', [1, 5, 3, 2], 3)[3], 5);
  assert.equal(I.suggestedStop(3), 11); assert.equal(I.suggestedStop(0.2), 6); assert.equal(I.suggestedStop(20), 35);
});

test('sheet strategies: walkdown, typed values, macro weights, backtest and validation', async () => {
  const bg = TEMPLATES.find(t => t.id === 'bg_ensemble');
  const mkt = await new E.Market(null).load(E.tickersOf(bg));
  // Typed values steer the walk exactly like the sheet: GDXU RSI > 79 → GDXD at step 1.
  let d = E.decide(bg, mkt, { overrides: { 'rsi|GDXU|10': 85 } });
  assert.deepEqual(d.weights, { GDXD: 1 }); assert.equal(d.sleeves[0].path.length, 1);
  // RSI 50, QQQ 90d < 70d, GDXU 70d < 75d → TQQQ at step 6 (the sheet's example day).
  d = E.decide(bg, mkt, { overrides: { 'rsi|GDXU|10': 30.95, 'ret|QQQ|90': 0.17, 'ret|QQQ|70': 0.38, 'ret|GDXU|70': 3.55, 'ret|GDXU|75': 10.03 } });
  assert.deepEqual(d.weights, { TQQQ: 1 }); assert.deepEqual(d.sleeves[0].path.map(p => p.id), ['1', '2', '6']);
  // Multi-model: 4 sleeves of 25%.
  const mm = TEMPLATES.find(t => t.id === 'multi_model');
  const m2 = await new E.Market(null).load(E.tickersOf(mm));
  assert.ok(Math.abs(Object.values(E.decide(mm, m2).weights).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  // Macro: the sheet's numbers give SPY 90.9% and IBIT 9.1%.
  const macro = TEMPLATES.find(t => t.id === 'macro_rotation');
  const w = E.decide(macro, mkt).weights;
  assert.ok(Math.abs(w.SPY - 0.9091) < 1e-3 && Math.abs(w.IBIT - 0.0909) < 1e-3 && !w.GLD);
  // Gold Miner stops at a step whose rule is not in the export.
  const gm = TEMPLATES.find(t => t.id === 'gold_miner');
  assert.equal(E.decide(gm, mkt, { overrides: { 'rsi|GDXU|10': 50, 'ret|QQQ|90': 5, 'ret|QQQ|70': 1 } }).complete, false);
  // Backtest runs and reports SPY alongside.
  const bt = E.backtest(mm, m2, { years: 3 });
  assert.ok(bt.days > 500 && Number.isFinite(bt.m.cagr) && Number.isFinite(bt.bh.cagr) && bt.dailyStats.sd > 0);
  // Sizing in whole shares, sells for holdings that are no longer targets.
  const o = E.sizeOrders({ SPY: 1 }, 1000, t => (t === 'SPY' ? 300 : 50), { holdings: { QQQ: 2 } });
  assert.deepEqual(o.map(x => [x.ticker, x.shares, x.delta, x.action]), [['SPY', 3, 3, 'BUY'], ['QQQ', 0, -2, 'SELL']]);
  // Validation keeps edits runnable.
  assert.throws(() => validateSpec({ sleeves: [{ name: 'x', weight: 1, steps: [{ id: '1', t: 'cmp', a: ['rsi', 'SPY', 10], op: '>', b: 70, yes: '@??', no: '@SPY' }] }] }, bg), /not a valid ticker/);
  assert.throws(() => validateSpec({ sleeves: [{ name: 'x', weight: 1, steps: [{ id: '1', t: 'cmp', a: ['rsi', 'SPY', 10], op: '>', b: 70, yes: '9', no: '@SPY' }] }] }, bg), /no step "9"/);
  assert.equal(validateSpec({ sleeves: [{ name: 'x', weight: 1, steps: [{ id: '1', t: 'band', a: ['rsi', 'spy', 14], hi: 75, hiTo: '@sh', lo: null, loTo: null, mid: '@spy' }] }] }, bg).sleeves[0].steps[0].a[1], 'SPY');
});

test('strategy API: copy, edit, walkdown, execute on paper, plan limits, backtest', async () => {
  const call = client();
  await call('/auth/register', { email: 'lib@example.com', password: 'Library12345x' });
  await call('/auth/register', { email: 'lib2@example.com', password: 'Library12345x' }); // second account: not admin, free plan
  const s = (await call('/library', { templateId: 'macro_rotation' })).body;
  assert.equal(s.templateId, 'macro_rotation'); assert.equal(s.mode, 'manual');
  const w = (await call(`/library/${s.id}/walkdown`, {})).body;
  assert.ok(w.orders.find(o => o.ticker === 'SPY' && o.action === 'BUY'));
  const ex = (await call(`/library/${s.id}/execute`, {})).body;
  assert.match(ex.summary, /BUY \d+ SPY/);
  // Executing again changes nothing: holdings already match.
  assert.match((await call(`/library/${s.id}/execute`, {})).body.summary, /No change|BUY|SELL/);
  // Free plan: following by hand on a real account is the user's own trading (every plan); trading
  // by itself there is Pro. One automatic strategy on paper.
  assert.equal((await call(`/library/${s.id}`, { account: 'alpaca' }, 'PUT')).status, 200);
  assert.equal((await call(`/library/${s.id}`, { mode: 'auto' }, 'PUT')).status, 402);
  assert.equal((await call(`/library/${s.id}`, { account: 'paper' }, 'PUT')).status, 200);
  assert.equal((await call(`/library/${s.id}`, { mode: 'auto', allocation: 50 }, 'PUT')).status, 200);
  const s2 = (await call('/library', { templateId: 'pullback_mr' })).body;
  assert.equal((await call(`/library/${s2.id}`, { mode: 'auto' }, 'PUT')).status, 402);
  // Edits are validated; the backtest becomes Reality Check's yardstick.
  assert.equal((await call(`/library/${s2.id}`, { spec: { params: { rsiEntry: 500 } } }, 'PUT')).status, 400);
  const bt = (await call(`/library/${s2.id}/backtest`, { years: 3 })).body;
  assert.ok(Number.isFinite(bt.m.cagr));
  const d = (await call(`/library/${s2.id}`)).body;
  assert.equal(d.reality.status, 'learning'); assert.ok(d.state.bt.sd > 0);
  const gm = (await call('/library', { templateId: 'gold_miner' })).body;
  assert.equal((await call(`/library/${gm.id}/backtest`, {})).status, 400); // rules incomplete
  assert.equal((await call('/library', { templateId: 'cl_momentum' })).status, 402); // 4th saved strategy on the free plan
});

test('Reality Check verdicts and the win-rate split', () => {
  const bt = { mean: 0.001, sd: 0.01, dd: 20 };
  assert.equal(RC.assess(new Array(10).fill(0.001), bt).status, 'learning');
  assert.equal(RC.assess(new Array(60).fill(0.001), bt).status, 'healthy');
  const bad = RC.assess(new Array(60).fill(-0.003), bt);
  assert.equal(bad.status, 'drifting'); assert.equal(bad.multiplier, 0);
  assert.equal(RC.assess(new Array(60).fill(-0.0005), bt).status, 'watch');
  assert.ok(Math.abs(RC.normCdf(0) - 0.5) < 1e-6 && Math.abs(RC.normCdf(-1.96) - 0.025) < 1e-3);
  const split = RC.winRateSplit([{ id: 1, winRate: 90 }, { id: 2, winRate: 10 }, { id: 3, winRate: 50 }]);
  assert.ok(Math.abs(split.reduce((a, x) => a + x.allocation, 0) - 100) < 0.5);
  assert.ok(split.every(x => x.allocation >= 9.9 && x.allocation <= 70.1));
});

test('pairs: statistics on a cointegrated pair, backtest and bots', async () => {
  // B is a random walk; A = 2·B + mean-reverting noise → cointegrated with hedge ratio ≈ 1 (log-space).
  let b = 100, n = 0; const pa = [], pb = [], dates = [];
  const rnd = (s => () => ((s = (s * 16807) % 2147483647) / 2147483647))(42);
  for (let i = 0; i < 800; i++) { b *= 1 + (rnd() - 0.5) * 0.02; n = 0.8 * n + (rnd() - 0.5) * 0.02; pb.push(b); pa.push(2 * b * Math.exp(n)); dates.push(String(i)); }
  const an = P.analyze({ dates, pa, pb });
  assert.ok(Math.abs(an.beta - 1) < 0.1, 'beta ' + an.beta);
  assert.equal(an.cointegrated, 1); assert.ok(an.halfLife > 1 && an.halfLife < 10, 'half-life ' + an.halfLife);
  const bt = P.backtestPair({ dates, pa, pb });
  assert.ok(bt.neutral.trades > 5 && bt.neutral.m.cagr > 0);
  const call = client();
  await call('/auth/register', { email: 'pairs@example.com', password: 'Pairs123456x' });
  const r = (await call('/pairs/analyze', { a: 'KO', b: 'PEP' })).body;
  assert.ok(Number.isFinite(r.z) && r.backtest.neutral);
  assert.equal((await call('/pairs/analyze', { a: 'KO', b: 'KO' })).status, 400);
  assert.equal((await call('/pairs/analyze', { a: 'KO', b: 'PEP', entryZ: 1, exitZ: 2 })).status, 400);
  const scan = (await call('/pairs/scan', { pairs: [['KO', 'PEP'], ['V', 'MA']] })).body;
  assert.equal(scan.length, 2);
  assert.equal((await call('/pairs/bots', { a: 'KO', b: 'PEP', capital: 1000 })).status, 402); // free plan
});

test('S&P 500: stats, projection, plan', async () => {
  assert.ok(Math.abs(SP.monthlyFor(1e6, 30, 10) - 485) < 2);
  const p = SP.project(new Array(120).fill(0.008), { perMonth: 100, years: 10, fee: 0 });
  assert.equal(p.contributed, 12000); assert.ok(p.p50 > 12000 && p.p10 <= p.p50 && p.p50 <= p.p90);
  const call = client();
  await call('/auth/register', { email: 'spx@example.com', password: 'Spx12345678x' });
  const s = (await call('/sp500')).body;
  assert.ok(s.price > 0 && s.funds.length === 4);
  assert.ok((await call('/sp500/projection', { initial: 1000, perMonth: 300, years: 20, goal: 1e6 })).body.goal.perMonthTypical > 0);
  assert.ok((await call('/sp500/plan', { fund: 'VOO', amount: 300, day: 5, account: 'paper', repeat: 'monthly' })).body.nextRun > Date.now());
  assert.equal((await call('/sp500/plan', { fund: 'VOO', amount: 300, account: 'alpaca' })).status, 402);
  assert.equal((await call('/sp500')).body.plans.length, 1);
});

test('other brokerages: Tradier connect, summary, orders and shorts', async () => {
  const call = client();
  await call('/auth/register', { email: 'broker@example.com', password: 'Broker12345x' });
  assert.equal((await call('/brokerages/tradier/connect', { token: 'wrong' })).status, 409);
  const c = (await call('/brokerages/tradier/connect', { token: 'tok', sandbox: true })).body;
  assert.equal(c.ok, true); assert.equal(c.live, false);
  const accts = (await call('/accounts')).body;
  assert.ok(accts.find(a => a.id === 'tradier' && a.connected));
  const s = (await call('/account?account=tradier')).body;
  assert.equal(s.equity, 25000); assert.equal(s.positions[0].price, 65); assert.equal(s.positions[0].pnl, 50);
  // Free users place their own orders on a real brokerage too; automation there needs a paid plan.
  assert.equal((await call('/schedule', { account: 'tradier', symbol: 'KO', side: 'buy', qty: 1 })).status, 402);
  // An upgraded user's sell of more than held opens a short.
  await run("UPDATE users SET plan = 'pro', plan_status = 'active' WHERE email = 'broker@example.com'");
  const o = (await call('/orders', { account: 'tradier', symbol: 'PEP', side: 'sell', qty: 3 })).body;
  assert.equal(o.id, '777');
  const post = seen.filter(x => x.method === 'POST' && x.url === '/v1/accounts/VA123/orders').pop();
  assert.match(post.body, /side=sell_short/); assert.match(post.body, /quantity=3/);
  await call('/orders', { account: 'tradier', symbol: 'KO', side: 'sell', qty: 2 });
  assert.match(seen.filter(x => x.method === 'POST').pop().body, /side=sell&/);
  assert.equal((await call('/orders?account=tradier')).body[0].side, 'sell');
  // The webhook form accepts the connected brokerage.
  assert.equal((await call('/signals/hooks', { name: 'T', accounts: ['tradier', 'paper'], sizeMode: 'qty', size: 1 })).status, 200);
  assert.equal((await call('/brokerages/tradier', null, 'DELETE')).status, 200);
  assert.equal((await call('/account?account=tradier')).status, 409);
});

test('deposits: owner service fee, Helcim checkout verified by hash', async () => {
  assert.equal(PAY.serviceFee(100), 1.5);
  const call = client();
  await call('/auth/register', { email: 'pay@example.com', password: 'Payment1234x' });
  const m = (await call('/funding/methods')).body;
  assert.ok(m.methods.find(x => x.id === 'helcim')); assert.equal(m.fee.percent, 1);
  const r = (await call('/funding/deposit', { amount: 100, method: 'helcim', account: 'alpaca' })).body;
  assert.equal(r.helcim.checkoutToken, 'ct_1'); assert.equal(r.fee, 1.5);
  assert.equal(seen.find(x => x.url === '/v2/helcim-pay/initialize').token, 'htok');
  assert.match(seen.find(x => x.url === '/v2/helcim-pay/initialize').body, /"amount":101.5/);
  const data = { transactionId: 'T9', status: 'APPROVED', amount: 101.5 };
  const hash = crypto.createHash('sha256').update(JSON.stringify(data) + 'st_secret').digest('hex');
  assert.equal((await call('/funding/helcim/confirm', { ledgerId: r.ledgerId, data, hash: 'x'.repeat(64) })).status, 400);
  assert.equal((await call('/funding/helcim/confirm', { ledgerId: r.ledgerId, data: { ...data, amount: 1 }, hash: crypto.createHash('sha256').update(JSON.stringify({ ...data, amount: 1 }) + 'st_secret').digest('hex') })).status, 400);
  assert.equal((await call('/funding/helcim/confirm', { ledgerId: r.ledgerId, data, hash })).body.status, 'received');
  const fee = await one("SELECT * FROM ledger WHERE kind = 'deposit_fee' AND ref = ?", `fee:${r.ledgerId}`);
  assert.equal(fee.status, 'collected'); assert.equal(fee.amount, 1.5);
});

test('assistant output becomes the app\'s own commands; PIN never comes from the AI', () => {
  assert.equal(toCommand({ intent: 'buy', symbol: 'AAPL', qty: 5, account: 'paper' }), 'BUY 5 AAPL');
  assert.equal(toCommand({ intent: 'sell', symbol: 'SPY', dollars: 200, account: 'schwab' }), 'SELL $200 SPY SCHWAB');
  assert.equal(toCommand({ intent: 'recurring_buy', symbol: 'SPY', dollars: 50, frequency: 'monthly', account: 'alpaca' }), 'DCA $50 SPY MONTHLY LIVE');
  assert.equal(toCommand({ intent: 'balance', account: null }), 'BAL');
  assert.equal(toCommand({ intent: 'buy', symbol: 'AAPL' }), null);
  assert.equal(toCommand({ intent: 'answer', reply: 'RSI measures momentum.' }), null);
});

test('homepage in English and Yiddish, app dictionary loads', async () => {
  const en = await (await fetch(base + '/')).text(), yi = await (await fetch(base + '/yi')).text();
  assert.match(en, /<html lang="en" dir="ltr">/); assert.match(yi, /<html lang="yi" dir="rtl">/);
  assert.match(yi, /ריעליטי טשעק/); assert.match(en, /id="reality"/);
  const f = await (await fetch(base + '/api/public/features')).json();
  assert.equal(typeof f.google, 'boolean');
  const dict = await import('../public/i18n/yi.js');
  assert.ok(Object.keys(dict.strings).length > 400);
  assert.ok(Object.values(dict.strings).every(v => typeof v === 'string' && v.length));
});
