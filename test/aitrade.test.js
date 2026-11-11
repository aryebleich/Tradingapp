// AI trading: plan limits, agent boundaries and approvals (and the MCP connector), AI bots (DCA,
// grid, scalping, plain-English rules, backtests, marketplace), AI signals (engine, automatic
// trades with moving stops), market intelligence (summaries, options flow, FINRA off-exchange
// volume, whale wallets, questions) and the chart co-pilot.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// A fake FINRA file host and Bitcoin explorer.
const fake = http.createServer((req, res) => {
  const m = /\/(FNRA|CNMS)shvol(\d{8})\.txt$/.exec(req.url);
  if (m) { const day = new Date(Date.UTC(+m[2].slice(0, 4), +m[2].slice(4, 6) - 1, +m[2].slice(6))); const big = day.getUTCDate() % 7 === 0; res.end(`Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\n${m[2]}|AAPL|${m[1] === 'CNMS' ? (big ? 900 : 400) : 300}|0|${big ? 5000 : 1000}|${m[1] === 'CNMS' ? 'B,Q,N' : 'D'}\n`); return; }
  if (req.url.startsWith('/address/')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ chain_stats: { funded_txo_sum: (globalThis.__btc ?? 500) * 1e8, spent_txo_sum: 0 }, mempool_stats: {} })); return; }
  res.statusCode = 404; res.end('');
});
await new Promise(r => fake.listen(0, r));
process.env.FINRA_CDN_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.BTC_API_URL = `http://127.0.0.1:${fake.address().port}`;

const { serve } = await import('./client.js');
const { run, one, all } = await import('../src/db.js');
const AP = await import('../src/aiplans.js');
const AG = await import('../src/agentic.js');
const BOT = await import('../src/aibots.js');
const SIG = await import('../src/aisignals.js');
const INT = await import('../src/intel.js');
const CA = await import('../public/chartai.js');
const { syntheticBars } = await import('../src/brokers.js');

let s;
before(async () => { s = await serve(); });
after(() => { s.close(); fake.close(); });
const plan = (id, p) => run("UPDATE users SET plan = ?, plan_status = 'active' WHERE id = ?", p, id);
// Wednesday 2026-11-11, 3:45 PM New York: the session is open, in the last half hour.
const SESSION = Date.UTC(2026, 10, 11, 20, 45);

test('plan limits: one table, more on each higher plan, shown on Plans & billing', async () => {
  const keys = ['bots', 'botEveryMin', 'agentTokens', 'signals', 'copilot', 'apiPerMin'];
  for (const k of keys) {
    const v = ['free', 'pro', 'elite', 'ultimate'].map(p => AP.AI_PLAN[p][k]);
    for (let i = 1; i < v.length; i++) assert.ok(k === 'botEveryMin' ? v[i] <= v[i - 1] : v[i] >= v[i - 1], k);
  }
  assert.ok(AP.AI_PLAN.ultimate.bots >= 50 && AP.AI_PLAN.ultimate.botEveryMin === 1);
  assert.equal(AP.aiLimits({ plan: 'free' }).label, 'Starter');
  assert.equal(AP.aiLimits({ plan: 'elite', plan_status: 'active' }).label, 'Elite');
  assert.equal(AP.aiLimits({ plan: 'elite', plan_status: 'canceled' }).label, 'Starter'); // lapsed plans fall back
  const c = s.client(); await c.signup('aiplans@example.com');
  const t = (await c('/aiplans')).body;
  assert.deepEqual(Object.values(t.plans), ['Starter', 'Pro', 'Elite', 'Ultimate']);
  assert.ok(t.rows.some(r => r[0] === 'AI bots running at once' && r[4] === '60'));
});

test('agents: boundaries per account and plan, automatic, ask-me and blocked orders, approval', async () => {
  const lim = p => AP.AI_PLAN[p];
  assert.equal(AG.effectiveMode({ accounts: { alpaca: 'auto' } }, lim('free'), 'alpaca'), 'off');
  assert.equal(AG.effectiveMode({ accounts: { alpaca: 'auto' } }, lim('pro'), 'alpaca'), 'approve');
  assert.equal(AG.effectiveMode({ accounts: { alpaca: 'auto' } }, lim('elite'), 'alpaca'), 'auto');
  assert.equal(AG.effectiveMode({ accounts: {} }, lim('free'), 'paper'), 'auto');
  const c = s.client(), u = await c.signup('agent@example.com');
  // Starter cannot let agents trade real accounts, or trade in extended hours.
  assert.equal((await c('/agent/boundaries', { accounts: { alpaca: 'approve' } }, 'PUT')).status, 402);
  assert.equal((await c('/agent/boundaries', { extendedHours: true }, 'PUT')).status, 402);
  assert.equal((await c('/agent/boundaries', { maxOrderUsd: 2000, symbols: 'spy, aapl, $$$', blocked: 'GME' }, 'PUT')).status, 200);
  const b = await AG.boundaries(u.id);
  assert.deepEqual(b.symbols, ['SPY', 'AAPL']); assert.deepEqual(b.blocked, ['GME']);
  const B = await import('../src/brokers.js'), { accountsFor } = await import('../src/ext/routes.js'), notes = [];
  const deps = { accountSummary: B.accountSummary, accountsFor, lastPrice: B.lastPrice, placeOrder: B.placeOrder, notify: async (id, m) => notes.push(m) };
  const user = await one('SELECT * FROM users WHERE id = ?', u.id);
  const ok = await AG.submit(user, 'Claude', { symbol: 'SPY', side: 'buy', qty: 1, reason: 'test' }, deps);
  assert.equal(ok.status, 'placed', JSON.stringify(ok));
  assert.equal((await AG.submit(user, 'Claude', { symbol: 'TSLA', side: 'buy', qty: 1, reason: 'x' }, deps)).status, 'blocked'); // not on the list
  const big = await AG.submit(user, 'Claude', { symbol: 'SPY', side: 'buy', notional: 5000, reason: 'x' }, deps);
  assert.equal(big.status, 'blocked'); assert.match(big.reason, /largest agent order/);
  const short = await AG.submit(user, 'Claude', { symbol: 'AAPL', side: 'sell', qty: 5, reason: 'x' }, deps);
  assert.match(short.reason, /short sale/);
  assert.equal((await AG.submit(user, 'Claude', { symbol: 'SPY', side: 'buy', qty: 1, account: 'tradier', reason: 'x' }, deps).catch(e => e)).status, 400); // not connected
  // "Ask me first" on the practice account: the order waits, the user is told, then approves.
  await c('/agent/boundaries', { accounts: { paper: 'approve' } }, 'PUT');
  const wait = await AG.submit(user, 'Claude', { symbol: 'AAPL', side: 'buy', qty: 2, reason: 'breakout' }, deps);
  assert.equal(wait.status, 'pending'); assert.match(notes.at(-1), /wants to buy 2 AAPL/);
  const hub = (await c('/agent')).body;
  assert.equal(hub.orders.find(o => o.id === wait.id).status, 'pending'); assert.equal(hub.effective.paper, 'approve');
  const ap = (await c(`/agent/orders/${wait.id}/approve`, {})).body; assert.equal(ap.status, 'placed', JSON.stringify(ap));
  assert.equal((await c(`/agent/orders/${wait.id}/approve`, {})).status, 409); // decided once
  const w2 = await AG.submit(user, 'Claude', { symbol: 'AAPL', side: 'buy', qty: 1, reason: 'x' }, deps);
  assert.equal((await c(`/agent/orders/${w2.id}/reject`, {})).body.status, 'rejected');
  // Daily order count.
  await c('/agent/boundaries', { accounts: { paper: 'auto' }, maxOrdersPerDay: 2 }, 'PUT');
  const lim2 = await AG.submit(user, 'Claude', { symbol: 'SPY', side: 'buy', qty: 1, reason: 'x' }, deps);
  assert.equal(lim2.status, 'blocked'); assert.match(lim2.reason, /orders today/);
  // Elite: real accounts may be automatic.
  await plan(u.id, 'elite');
  assert.equal((await c('/agent/boundaries', { accounts: { alpaca: 'auto' }, extendedHours: true }, 'PUT')).status, 200);
  // The MCP connector uses the same checks.
  const { token } = (await c('/tokens', { name: 'ChatGPT' })).body;
  const rpc = body => fetch(s.base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }).then(r => r.json());
  const res = (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'submit_order', arguments: { symbol: 'GME', side: 'buy', qty: 1, reason: 'meme' } } })).result;
  assert.equal(res.structuredContent.status, 'blocked'); assert.match(res.structuredContent.reason, /blocked/);
  const scan = (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'scan_market', arguments: { universe: 'SPY, QQQ, AAPL', sort: 'rsi14' } } })).result.structuredContent;
  assert.equal(scan.scanned, 3); assert.ok('rsi14' in scan.results[0]);
  const book = (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_order_book', arguments: { symbol: 'SPY' } } })).result.structuredContent;
  assert.ok(book.price > 0);
  const bnd = (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_boundaries', arguments: {} } })).result.structuredContent;
  assert.equal(bnd.planAllows.realAccounts, 'auto');
  const mine = (await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_agent_orders', arguments: {} } })).result.structuredContent.items;
  assert.ok(mine.some(o => o.agent === 'ChatGPT' && o.symbol === 'GME'));
});

test('plain English becomes rules; backtests for rules, DCA and grids', () => {
  const r = BOT.parseRules('Buy NVDA when 14-day RSI crosses below 30 and institutional volume spikes, sell when RSI goes above 70, stop loss 5%');
  assert.equal(r.symbol, 'NVDA');
  assert.deepEqual(r.entry.map(c => c.ind), ['rsi', 'volume']); assert.equal(r.entry[0].op, 'crosses_below'); assert.equal(r.entry[0].value, 30);
  assert.equal(r.exit[0].op, 'crosses_above'); assert.equal(r.stopPct, 5);
  const g = BOT.parseRules('Buy SPY on a golden cross, sell on a death cross');
  assert.equal(g.entry[0].ref.period, 200); assert.equal(g.exit[0].op, 'crosses_below');
  const q = BOT.parseRules('Buy $500 of QQQ when it drops 3% in a day, take profit 8%, hold 10 days');
  assert.deepEqual([q.amount.notional, q.targetPct, q.holdDays, q.entry[0].value], [500, 8, 10, -3]);
  assert.throws(() => BOT.parseRules('make money please'), /No buy rule/);
  const c = syntheticBars('SPY').closes;
  const bt = BOT.backtestRule(BOT.checkConfig('rule', BOT.parseRules('Buy when 2-day RSI crosses below 10, sell when RSI is above 70').valueOf()), c);
  assert.ok(bt.trades > 5 && bt.winRate != null && Number.isFinite(bt.totalReturn) && bt.maxDrawdown <= 0);
  const d = BOT.backtestDca({ amountUsd: 100, everyDays: 5, dipPct: 10, dipExtraUsd: 200 }, c);
  assert.ok(d.buys >= Math.floor(c.length / 5) && d.invested >= d.buys * 100 && d.avgCost > 0);
  // Grid: each lot is bought at one level and sold a level higher, so a range-bound price profits.
  const wave = Array.from({ length: 600 }, (_, i) => 100 + 8 * Math.sin(i / 9));
  const gr = BOT.backtestGrid({ lower: 90, upper: 110, levels: 9, qtyPerLevel: 1 }, wave);
  assert.ok(gr.sells > 20 && gr.gridProfit > 0 && Math.abs(gr.net - gr.gridProfit) < 1e-6 + gr.openValue + 1);
  assert.throws(() => BOT.checkConfig('grid', { lower: 10, upper: 10, qtyPerLevel: 1 }), /highest price/);
});

test('AI bots: plan limits, running DCA, grid, scalping and rule bots, marketplace', async () => {
  const c = s.client(), u = await c.signup('bots@example.com');
  // Plain-English builds a day: 3 on Starter.
  for (let i = 0; i < 3; i++) assert.equal((await c('/aibots/parse', { text: 'Buy SPY when RSI is below 30' })).status, 200);
  assert.equal((await c('/aibots/parse', { text: 'Buy SPY when RSI is below 30' })).status, 402);
  const bt = (await c('/aibots/backtest', { kind: 'dca', symbol: 'SPY', years: 50, config: { amountUsd: 50, everyDays: 7 } })).body;
  assert.equal(bt.years, AP.AI_PLAN.free.backtestYears); assert.ok(bt.invested > 0);
  assert.equal((await c('/aibots', { kind: 'dca', symbol: 'SPY', account: 'alpaca', config: { amountUsd: 50 } })).status, 402); // real accounts: Pro
  const a = (await c('/aibots', { kind: 'dca', symbol: 'BTC/USD', config: { amountUsd: 50, everyDays: 1 }, everyMin: 1 })).body;
  assert.equal(a.every_min, AP.AI_PLAN.free.botEveryMin); // never more often than the plan
  const b2 = (await c('/aibots', { kind: 'grid', symbol: 'ETH/USD', config: { lower: 90, upper: 110, levels: 5, qtyPerLevel: 1 } })).body;
  assert.equal((await c('/aibots/' + a.id, { active: true }, 'PUT')).status, 200);
  assert.equal((await c('/aibots/' + b2.id, { active: true }, 'PUT')).status, 402); // one at a time on Starter
  await plan(u.id, 'pro');
  assert.equal((await c('/aibots/' + b2.id, { active: true }, 'PUT')).status, 200);
  // Run them with a scripted price and a recording broker.
  const orders = []; let px = 100;
  const deps = { lastPrice: async () => px, placeOrder: async (uid, acct, o) => { orders.push(o); return { status: 'filled', price: px }; } };
  const row = async id => one('SELECT * FROM ai_bots WHERE id = ?', id);
  assert.match(await BOT.stepBot(await row(a.id), deps, SESSION), /bought \$50/);
  assert.equal(await BOT.stepBot(await row(a.id), deps, SESSION + 3600e3), 'no trade'); // not due yet
  assert.match(await BOT.stepBot(await row(b2.id), deps, SESSION), /grid started/);
  px = 94; assert.match(await BOT.stepBot(await row(b2.id), deps, SESSION), /bought 2 levels/); // 100 → 94 crosses 100 and 95
  // Each lot sells one level above where it was bought: the 95 lot at 100, the 100 lot at 105.
  px = 101; assert.match(await BOT.stepBot(await row(b2.id), deps, SESSION), /sold 1 level at 101/);
  px = 106; assert.match(await BOT.stepBot(await row(b2.id), deps, SESSION), /sold 1 level at 106/);
  // Scalping: buys a drop below the recent average, sells the target.
  const sc = (await c('/aibots', { kind: 'scalp', symbol: 'SOL/USD', config: { amountUsd: 100, dropPct: 1, takePct: 1, stopPct: 2, window: 6 } })).body;
  for (const p of [100, 100, 100]) { px = p; await BOT.stepBot(await row(sc.id), deps, SESSION); }
  px = 98; assert.match(await BOT.stepBot(await row(sc.id), deps, SESSION), /bought/);
  px = 99.2; assert.match(await BOT.stepBot(await row(sc.id), deps, SESSION), /sold .*\+1\.22%/);
  // A plain-English bot on a stock: buys when its rule holds near the close, sells at its target.
  const rb = (await c('/aibots', { kind: 'rule', symbol: 'SPY', config: { entry: [{ ind: 'price', op: 'above', value: 1 }], exit: [], targetPct: 5, amount: { notional: 1000 } } })).body;
  assert.equal(rb.every_min, 1380); // daily rules: one decision a day, near the close
  px = 100; assert.match(await BOT.stepBot(await row(rb.id), deps, SESSION), /bought 10 at 100/);
  px = 106; assert.match(await BOT.stepBot(await row(rb.id), deps, SESSION), /sold at 106\.00 \(take profit/);
  // Stock bots wait for the session without using up their turn; crypto bots run at any hour.
  await c('/aibots/' + rb.id, { active: true }, 'PUT');
  const night = Date.UTC(2026, 10, 12, 3, 0);
  await run('UPDATE ai_bots SET last_run = NULL WHERE id = ?', rb.id);
  await BOT.runAiBots(night, deps);
  assert.equal((await row(rb.id)).last_run, null);
  // The minute job: due bots run, results are kept.
  await run('UPDATE ai_bots SET last_run = NULL WHERE id = ?', a.id);
  assert.ok(await BOT.runAiBots(SESSION, deps) >= 1);
  assert.match((await row(a.id)).last_result, /bought|no trade/);
  // Marketplace: Pro shares, Starter browses but cannot copy.
  assert.equal((await c(`/aibots/${b2.id}/publish`, { description: 'Range grid on ether' })).status, 200);
  const other = s.client(); await other.signup('copier@example.com');
  const m = (await other('/aibots/market')).body;
  assert.ok(m.items.some(x => x.id === b2.id && x.description === 'Range grid on ether')); assert.equal(m.canCopy, false);
  assert.equal((await other(`/aibots/market/${b2.id}/copy`, {})).status, 402);
  const mine = (await c(`/aibots/market/${b2.id}/copy`, {})).body;
  assert.equal(mine.account, 'paper'); assert.equal(mine.active, 0); assert.equal(mine.copied_from, b2.id);
  assert.equal((await one('SELECT copies FROM ai_bots WHERE id = ?', b2.id)).copies, 1);
});

test('AI signals: nightly engine, plan-limited list, automatic trades with moving stops', async () => {
  const series = Object.fromEntries(SIG.UNIVERSE.slice(0, 30).map(x => [x, syntheticBars(x).closes]));
  const r = SIG.signalsFrom(series, { day: '2026-11-12' });
  assert.ok(r.scenarios > 500000, r.scenarios); assert.equal(r.symbols, 30);
  for (const x of r.signals) { assert.ok(x.stop < x.entry && x.target > x.entry && x.win_rate >= 50 && SIG.SETUPS[x.setup]); }
  assert.equal(new Set(r.signals.map(x => x.symbol)).size, r.signals.length); // one per symbol
  // Stored signals for a day, shown by plan.
  for (let i = 0; i < 6; i++) await run('INSERT INTO ai_signals (day, symbol, setup, side, entry, stop, target, win_rate, avg_return, samples, score, horizon, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', '2026-11-11', ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'][i], 'breakout20', 'buy', 100, 95, 110, 62, 1.5, 40, 10 - i, 10, Date.now());
  const c = s.client(), u = await c.signup('signals@example.com');
  const g = (await c('/aisignals')).body;
  assert.equal(g.day, '2026-11-11'); assert.equal(g.signals.length, 3); assert.equal(g.total, 6);
  assert.equal((await c('/aisignals/auto', { enabled: true }, 'PUT')).status, 402);
  await plan(u.id, 'pro');
  assert.equal((await c('/aisignals/auto', { enabled: true, account: 'alpaca' }, 'PUT')).status, 402); // real accounts: Elite
  assert.equal((await c('/aisignals/auto', { enabled: true, account: 'paper', perTradeUsd: 1000, maxOpen: 2, minWinRate: 55 }, 'PUT')).status, 200);
  assert.equal((await c('/aisignals/custom', { symbols: 'AAPL' })).status, 402);
  // Automatic trades: two opened (max open), then stops move and targets close.
  let px = 100; const orders = [];
  const deps = { lastPrice: async () => px, placeOrder: async (uid, acct, o) => { orders.push({ uid, ...o }); return { status: 'filled' }; } };
  assert.equal(await SIG.runSignalTrades(SESSION, deps), 2);
  const open = await all("SELECT * FROM signal_trades WHERE user_id = ? AND status = 'open'", u.id);
  assert.equal(open.length, 2); assert.equal(open[0].qty, 10); assert.equal(open[0].stop, 95);
  px = 105.5; await SIG.runSignalTrades(SESSION, deps); // +1R: stop to break-even
  assert.equal((await one('SELECT stop FROM signal_trades WHERE id = ?', open[0].id)).stop, 100);
  px = 111; await SIG.runSignalTrades(SESSION, deps); // target
  assert.equal((await one('SELECT status, note FROM signal_trades WHERE id = ?', open[0].id)).note, 'target');
  assert.ok(orders.filter(o => o.uid === u.id && o.side === 'sell').length >= 2);
  // Elite: custom engines.
  await plan(u.id, 'elite');
  const cu = (await c('/aisignals/custom', { symbols: 'AAPL, MSFT, NVDA' })).body;
  assert.equal(cu.symbols, 3); assert.ok(cu.scenarios > 0);
});

test('market intelligence: summaries, options flow, off-exchange volume, whales, questions', async () => {
  const text = 'Good afternoon. Revenue grew 18% to $4.2 billion this quarter, a record. Operating margin expanded 150 basis points. For the full year we expect revenue of $17 billion, raising our guidance. We see some headwind from tariffs and slower demand in Europe. Could you talk about the AI backlog? Free cash flow was $1.1 billion and we repurchased $500 million of stock. '.repeat(3);
  const e = INT.extractive(text);
  assert.ok(e.highlights.length && e.keyNumbers.some(n => /4\.2 billion/.test(n)) && e.guidance.length && e.risks.length);
  assert.equal(e.tone, 'Confident');
  const rows = INT.unusual([{ symbol: 'X1', type: 'call', strike: 110, expiration: '2026-12-18', volume: 5000, openInterest: 200, bid: 1, ask: 1.2 }, { symbol: 'X2', type: 'put', strike: 90, expiration: '2026-12-18', volume: 50, openInterest: 10, bid: 1, ask: 1 }, { symbol: 'X3', type: 'put', strike: 95, expiration: '2026-12-18', volume: 900, openInterest: 5000, bid: 2, ask: 2 }], 100);
  assert.deepEqual(rows.map(r => r.symbol), ['X1']); assert.equal(rows[0].premium, 550000); assert.equal(rows[0].moneyness, 'out of the money');
  assert.deepEqual(INT.route('show unusual options on NVDA'), { intent: 'flow', symbol: 'NVDA' });
  assert.equal(INT.route('dark pool activity in AAPL').intent, 'darkpool');
  assert.equal(INT.route('summarize the earnings call').intent, 'earnings');
  assert.equal(INT.parseRegSho('Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\n20261110|AAPL|10|0|40|D\n').get('AAPL').total, 40);
  const c = s.client(), u = await c.signup('intel@example.com');
  const dp = (await c('/intel/darkpool?symbol=AAPL')).body;
  assert.ok(dp.days.length >= 10 && dp.days.some(d => d.spike) && dp.days[0].shortPct > 0, JSON.stringify(dp).slice(0, 300));
  const ask = (await c('/intel/ask', { q: 'dark pool volume for AAPL' })).body; assert.equal(ask.symbol, 'AAPL'); assert.ok(ask.result.days.length);
  assert.equal((await c('/intel/flow?symbol=SPY')).status, 503); // needs the market-data connection
  // Earnings summaries: Pro and up, monthly allowance.
  assert.equal((await c('/intel/earnings', { text })).status, 402);
  await plan(u.id, 'pro');
  const sm = (await c('/intel/earnings', { symbol: 'acme', title: 'Q3 call', text })).body;
  assert.equal(sm.symbol, 'ACME'); assert.equal(sm.left, AP.AI_PLAN.pro.earningsSummaries - 1); assert.ok(sm.summary.highlights.length);
  assert.equal((await c('/intel/earnings/' + sm.id)).body.title, 'Q3 call');
  // Whale wallets: followed, read, alerted when they move.
  assert.equal((await c('/intel/whales', { chain: 'btc', address: 'nope' })).status, 400);
  const w = (await c('/intel/whales', { chain: 'btc', address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', label: 'Cold wallet', threshold: 100 })).body;
  assert.equal(w.balance, 500);
  globalThis.__btc = 350; assert.equal(await INT.checkWhales(), 1);
  const ww = (await c('/intel')).body.whales[0]; assert.equal(ww.balance, 350); assert.equal(ww.prev_balance, 500); assert.ok(ww.moved_at);
});

test('chart co-pilot: patterns, zones and lines found, prompts read, answers with quota', async () => {
  // A clear head and shoulders: shoulders at 110, head at 120, troughs near 100.
  const path = [100, 105, 110, 105, 100, 110, 120, 110, 101, 105, 110, 105, 100, 95, 90];
  const closes = []; for (let k = 0; k < path.length - 1; k++) for (let j = 0; j < 6; j++) closes.push(path[k] + (path[k + 1] - path[k]) * j / 6);
  const bars = closes.map((c, i) => ({ t: Date.UTC(2026, 0, 1) + i * 864e5, o: c, h: c + 0.2, l: c - 0.2, c }));
  const found = CA.patterns(bars);
  const hs = found.find(p => p.key === 'hs'); assert.ok(hs, JSON.stringify(found.map(p => p.key)));
  assert.ok(Math.abs(hs.neckline - 100.5) < 1.5);
  const z = CA.zones(bars); assert.ok(z.length && z.every(x => x.touches >= 2));
  const ask = CA.parsePrompt('Highlight all head-and-shoulders patterns from the last quarter and cross-reference with short interest spikes');
  assert.deepEqual([ask.patterns, ask.short, ask.days], [['hs'], true, 63]);
  assert.deepEqual(CA.parsePrompt('any inverse head and shoulders?').patterns, ['ihs']);
  assert.ok(CA.parsePrompt('where is support and resistance').zones);
  const c = s.client(); await c.signup('copilot@example.com');
  const r = (await c('/chartai/ask', { symbol: 'AAPL', prompt: 'Highlight all head-and-shoulders patterns from the last quarter and cross-reference with short interest spikes' })).body;
  assert.equal(r.symbol, 'AAPL'); assert.match(r.answer, /head and shoulders/); assert.ok(r.short && Array.isArray(r.short.spikes)); assert.equal(r.left, AP.AI_PLAN.free.copilot - 1);
  const r2 = (await c('/chartai/ask', { symbol: 'AAPL', prompt: 'show support and resistance and trendlines' })).body;
  assert.ok(r2.zones.length && r2.zones[0].from > 0); assert.match(r2.answer, /support/i);
  for (let i = 0; i < 3; i++) await c('/chartai/ask', { symbol: 'AAPL', prompt: 'support' });
  assert.equal((await c('/chartai/ask', { symbol: 'AAPL', prompt: 'support' })).status, 402);
});
