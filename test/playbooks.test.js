// Playbooks: the shared JSON format and its validation, evaluation (weights, if/else, filters,
// inverse volatility), the AI builder's checks, backtests with costs and a benchmark, versions,
// deploy (backtest first, step-up for real money), the daily run before the close (once per day,
// expired when missed, holidays and early closes), previews, history, overrides, the library with
// reports and moderation, and guided discovery.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './mock-alpaca.js';

const mock = await startMock(); mock.autoFill = true;
Object.assign(process.env, { ALPACA_TRADING_URL: mock.url, ALPACA_LIVE_URL: mock.liveUrl, ALPACA_DATA_URL: mock.url, ALPACA_DATA_SANDBOX_URL: mock.url });
const { app } = await import('../server.js');
const { one, all, run } = await import('../src/db.js');
const C = await import('../src/rotation/playbook-core.js');
const PB = await import('../src/playbooks.js');
const T = await import('../src/time.js');
const { stepUpSessions } = await import('../src/security.js');

let server, base;
const client = () => {
  let cookie = '';
  return async (path, body, method) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
};
const c = client();
let uid;
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  uid = (await c('/auth/register', { email: 'playbooks@example.com', password: 'Str0ngPassword1', agree: true })).body.user.id;
  await run("UPDATE users SET plan = 'pro', plan_status = 'active' WHERE id = ?", uid);
});
after(() => { server.close(); mock.close(); });

const simple = { kind: 'playbook', version: 1, rebalance: 'monthly', root: { type: 'group', weighting: 'specified', children: [{ type: 'asset', ticker: 'SPY', weight: 60 }, { type: 'asset', ticker: 'AGG', weight: 40 }] } };
const trend = { kind: 'playbook', version: 1, rebalance: 'weekly', weekday: 3, root: { type: 'if', cond: { a: ['close', 'SPY', 0], op: '>', b: ['sma', 'SPY', 200] }, then: { type: 'filter', metric: ['ret', 63], select: 'top', count: 2, weighting: 'invvol', children: ['QQQ', 'SPY', 'IWM', 'EFA'].map(t => ({ type: 'asset', ticker: t })) }, else: { type: 'asset', ticker: 'BIL' } } };

// ---------------------------------------------------------------- format and validation
test('format: validation lists every problem; weights must add to 100%; rules must be executable', () => {
  assert.ok(C.checkPlaybook(simple).ok);
  assert.ok(C.checkPlaybook(trend).ok);
  const bad = C.checkPlaybook({ rebalance: 'hourly', root: { type: 'group', weighting: 'specified', children: [{ type: 'asset', ticker: 'spy', weight: 70 }, { type: 'asset', ticker: '12$', weight: 20 }, { type: 'if', cond: { a: ['macd', 'SPY', 9], op: '=', b: 1 }, then: { type: 'asset', ticker: 'QQQ' } }] } });
  assert.equal(bad.ok, false);
  const all = bad.problems.join('\n');
  assert.match(all, /Rebalance/); assert.match(all, /"12\$" is not a valid ticker/); assert.match(all, /unknown indicator "macd"/);
  assert.match(all, /compare with/); assert.match(all, /a block is missing/); assert.match(all, /add up to 90%/);
  assert.equal(bad.playbook.root.children[0].ticker, 'SPY', 'tickers are upper-cased');
  assert.match(C.checkPlaybook({ root: { type: 'filter', metric: ['ret', 20], count: 5, weighting: 'equal', children: [{ type: 'asset', ticker: 'A' }] } }).problems.join(), /pick 1 to 1/);
  assert.match(C.checkPlaybook({ root: { type: 'filter', metric: ['ret', 20], count: 1, weighting: 'equal', children: [{ type: 'cash' }] } }).problems.join(), /ranks assets only/);
});

test('evaluation: specified, equal, inverse volatility, if/else, votes and top-N filters', () => {
  const closes = { SPY: Array.from({ length: 300 }, (_, i) => 100 + i), AGG: Array.from({ length: 300 }, (_, i) => 50 + (i % 2)), QQQ: Array.from({ length: 300 }, (_, i) => 100 + 2 * i), IWM: Array.from({ length: 300 }, () => 80), EFA: Array.from({ length: 300 }, (_, i) => 90 + (i % 7)) };
  const last = t => closes[t].at(-1);
  const val = m => { if (typeof m === 'number') return m; const [fn, t, n] = m; const c = closes[t]; if (!c) return NaN; if (fn === 'close') return last(t); if (fn === 'sma') return c.slice(-n).reduce((a, b) => a + b, 0) / n; if (fn === 'ret') return (c.at(-1) / c.at(-1 - n) - 1) * 100; return NaN; };
  const ev = pb => C.evaluate(C.checkPlaybook(pb).playbook, val, t => closes[t] || []);
  assert.deepEqual(ev(simple).weights, { SPY: 0.6, AGG: 0.4 });
  const r = ev(trend);
  assert.deepEqual(Object.keys(r.weights).sort(), ['QQQ', 'SPY'], 'SPY above its 200-day average: the top 2 by 63-day return');
  assert.ok(Math.abs(r.weights.QQQ + r.weights.SPY - 1) < 1e-6);
  assert.equal(r.trace[0].result, 'then'); assert.match(r.trace[1].result, /QQQ, SPY/);
  closes.SPY = closes.SPY.map((_, i) => 400 - i);
  assert.deepEqual(ev(trend).weights, { BIL: 1 }, 'below the average: the else branch');
  const vote = ev({ root: { type: 'if', cond: { need: 2, of: [{ a: ['close', 'QQQ', 0], op: '>', b: 100 }, { a: ['close', 'IWM', 0], op: '>', b: 100 }, { a: ['close', 'EFA', 0], op: '>', b: 50 }] }, then: { type: 'asset', ticker: 'QQQ' }, else: { type: 'cash' } } });
  assert.deepEqual(vote.weights, { QQQ: 1 });
  const nodata = ev({ root: { type: 'if', cond: { a: ['close', 'ZZZ', 0], op: '>', b: 1 }, then: { type: 'asset', ticker: 'QQQ' }, else: { type: 'cash' } } });
  assert.equal(nodata.complete, false, 'missing data never silently picks a branch');
});

test('existing designs convert to Playbooks (library seed), and quarterly / holiday rebalance days', () => {
  const lib = PB.seedLibrary();
  assert.ok(lib.length >= 3, 'blueprints with examples become Playbooks');
  for (const x of lib) assert.ok(C.checkPlaybook(x.playbook).ok, x.name);
  const isT = d => !['2026-01-01', '2026-07-03'].includes(d) && ![0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay());
  const prev = d => { let x = T.addDays(d, -1); while (!isT(x)) x = T.addDays(x, -1); return x; };
  assert.equal(C.rebalanceDue({ rebalance: 'monthly' }, '2026-01-02', isT, prev), true, 'first trading day of January (the 1st is a holiday)');
  assert.equal(C.rebalanceDue({ rebalance: 'quarterly' }, '2026-04-01', isT, prev), true);
  assert.equal(C.rebalanceDue({ rebalance: 'quarterly' }, '2026-05-01', isT, prev), false);
  assert.equal(C.rebalanceDue({ rebalance: 'daily' }, '2026-07-03', isT, prev), false, 'holiday');
});

// ---------------------------------------------------------------- API
test('create, version, backtest (costs, slippage, benchmark), deploy needs a backtest; history and preview', async () => {
  const bad = await c('/playbooks', { name: 'Bad', playbook: { root: { type: 'asset', ticker: '' } } });
  assert.equal(bad.status, 400); assert.ok(bad.body.problems.length);
  const p = await c('/playbooks', { name: 'Sixty forty', playbook: simple });
  assert.equal(p.status, 200, JSON.stringify(p.body)); assert.equal(p.body.version, 1);
  const id = p.body.id;
  assert.equal((await c(`/playbooks/${id}/deploy`, { account: 'paper', allocation: 20 })).status, 409, 'not backtested yet');
  const bt = await c(`/playbooks/${id}/backtest`, { years: 3, costBps: 10, slippageBps: 10, benchmark: 'QQQ' });
  assert.equal(bt.status, 200, JSON.stringify(bt.body));
  for (const k of ['ret', 'cagr', 'dd', 'vol', 'sharpe']) assert.ok(Number.isFinite(bt.body.stats[k]), k);
  assert.equal(bt.body.benchmark, 'QQQ'); assert.ok(bt.body.curve.length > 10 && bt.body.bhCurve.length === bt.body.curve.length);
  assert.match(bt.body.disclaimer, /past results do not predict/);
  assert.ok(Array.isArray(bt.body.walkForward.parts));
  // An edit is a new version; deploy then needs a new backtest.
  const e = await c(`/playbooks/${id}`, { playbook: { ...simple, rebalance: 'quarterly' }, note: 'Quarterly' }, 'PUT');
  assert.equal(e.body.version, 2); assert.equal(e.body.versions.at(-1).note, 'Quarterly');
  assert.equal((await c(`/playbooks/${id}/deploy`, { account: 'paper', allocation: 20 })).status, 409);
  await c(`/playbooks/${id}/backtest`, { years: 3 });
  const d = await c(`/playbooks/${id}/deploy`, { account: 'paper', allocation: 20 });
  assert.equal(d.status, 200, JSON.stringify(d.body)); assert.equal(d.body.mode, 'auto');
  const r = await c(`/playbooks/${id}/restore`, { version: 1 });
  assert.equal(r.body.version, 3); assert.equal(r.body.playbook.rebalance, 'monthly');
  const pv = await c(`/playbooks/${id}/preview`);
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.match(pv.body.estimate, /fills may differ/);
  const spy = pv.body.trades.find(t => t.ticker === 'SPY');
  assert.ok(spy && spy.targetShares > 0 && spy.change > 0 && spy.dollars > 0, 'buys SPY towards 60%');
  const h = await c(`/playbooks/${id}/history`);
  assert.ok(h.body.some(x => x.kind === 'deployed'));
});

test('daily run: before the close, once per day, through placeOrder; missed or late runs expire with a note', async () => {
  const p = await c('/playbooks', { name: 'Runner', playbook: simple });
  const id = p.body.id;
  await c(`/playbooks/${id}/backtest`, { years: 3 }); await c(`/playbooks/${id}/deploy`, { account: 'paper', allocation: 20 });
  await run('UPDATE user_strategies SET created_at = 0 WHERE id = ?', id);
  const claims = new Set(), claim = async k => (claims.has(k) ? false : (claims.add(k), true));
  const at = (day, hh, mm) => T.nyAt(day, hh * 60 + mm);
  // 2026-12-01 is the first trading day of December (monthly rebalance day).
  assert.equal(await PB.runPlaybooks(at('2026-12-01', 15, 0), claim), 0, 'too early');
  assert.ok(await PB.runPlaybooks(at('2026-12-01', 15, 41), claim) >= 1);
  const once = (await all("SELECT id FROM strategy_runs WHERE strategy_id = ? AND kind = 'auto'", id)).length;
  await PB.runPlaybooks(at('2026-12-01', 15, 50), claim);
  assert.equal((await all("SELECT id FROM strategy_runs WHERE strategy_id = ? AND kind = 'auto'", id)).length, once, 'at most once per day');
  assert.equal(once, 1);
  const fills = await all("SELECT symbol FROM fills WHERE user_id = ? AND source = ?", uid, `strategy:${id}`);
  assert.deepEqual([...new Set(fills.map(f => f.symbol))].sort(), ['AGG', 'SPY']);
  const runs = await all('SELECT kind, summary, detail FROM strategy_runs WHERE strategy_id = ? ORDER BY id', id);
  assert.ok(runs.some(r => r.kind === 'auto' && /BUY/.test(r.summary)));
  // Too close to the close: expired, nothing sent.
  const p2 = await c('/playbooks', { name: 'Late', playbook: { ...simple, rebalance: 'daily' } });
  await c(`/playbooks/${p2.body.id}/backtest`, { years: 3 }); await c(`/playbooks/${p2.body.id}/deploy`, { account: 'paper', allocation: 20 });
  await run('UPDATE user_strategies SET created_at = 0 WHERE id = ?', p2.body.id);
  await PB.runPlaybooks(at('2026-12-02', 15, 57), claim);
  assert.ok((await all("SELECT summary FROM strategy_runs WHERE strategy_id = ? AND kind = 'expired'", p2.body.id)).some(r => /Too close to the close.*nothing was sent/.test(r.summary)));
  // Early close (Nov 27, 2026, day after Thanksgiving): runs at 12:40, not 15:40.
  const n0 = (await all("SELECT id FROM strategy_runs WHERE strategy_id = ? AND kind = 'auto'", p2.body.id)).length;
  await PB.runPlaybooks(at('2026-11-27', 12, 41), claim);
  assert.equal((await all("SELECT id FROM strategy_runs WHERE strategy_id = ? AND kind = 'auto'", p2.body.id)).length, n0 + 1);
  // A day the server slept through: expired the next morning.
  await PB.runPlaybooks(at('2026-12-04', 9, 0), claim);
  assert.ok((await all("SELECT summary FROM strategy_runs WHERE strategy_id = ? AND kind = 'expired'", p2.body.id)).some(r => /Missed the 2026-12-03 rebalance/.test(r.summary)));
});

test('overrides: pause, resume, skip next, swap an asset, close all; each logged', async () => {
  const p = await c('/playbooks', { name: 'Overrides', playbook: { ...simple, rebalance: 'daily' } });
  const id = p.body.id;
  await c(`/playbooks/${id}/backtest`, { years: 3 }); await c(`/playbooks/${id}/deploy`, { account: 'paper', allocation: 20 });
  await run('UPDATE user_strategies SET created_at = 0 WHERE id = ?', id);
  const ex = await c(`/playbooks/${id}/execute`, {});
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  const claims = new Set(), claim = async k => (claims.has(k) ? false : (claims.add(k), true));
  assert.equal((await c(`/playbooks/${id}/pause`, {})).body.paused, true);
  const mineFills = async () => (await all('SELECT id FROM fills WHERE user_id = ? AND source = ?', uid, `strategy:${id}`)).length;
  const before = await mineFills();
  await PB.runPlaybooks(T.nyAt('2026-12-08', 941), claim);
  assert.equal(await mineFills(), before, 'paused: nothing traded');
  assert.equal((await c(`/playbooks/${id}/resume`, {})).body.paused, false);
  assert.equal((await c(`/playbooks/${id}/skip`, {})).body.skipNext, true);
  await PB.runPlaybooks(T.nyAt('2026-12-09', 941), claim);
  assert.ok((await all("SELECT id FROM strategy_runs WHERE strategy_id = ? AND kind = 'skipped'", id)).length);
  const sw = await c(`/playbooks/${id}/swap`, { from: 'AGG', to: 'BND' });
  assert.equal(sw.status, 200, JSON.stringify(sw.body));
  assert.ok(JSON.stringify(sw.body.playbook).includes('BND') && !JSON.stringify(sw.body.playbook).includes('AGG'));
  const cl = await c(`/playbooks/${id}/close`, {});
  assert.equal(cl.status, 200, JSON.stringify(cl.body)); assert.ok(cl.body.results.every(r => r.ok)); assert.equal(cl.body.mode, 'manual');
  const kinds = (await c(`/playbooks/${id}/history`)).body.filter(x => x.kind === 'override').map(x => x.summary).join('\n');
  for (const w of [/Paused/, /Resumed/, /skipped/, /Swapped AGG for BND/, /Closed all positions/]) assert.match(kinds, w);
});

test('real money: deploy, resume and close need the step-up confirmation', async () => {
  const p = await c('/playbooks', { name: 'Live', playbook: simple });
  await c(`/playbooks/${p.body.id}/backtest`, { years: 3 });
  assert.equal((await c('/alpaca/keys', { keyId: 'PBLIVE', secret: 'S', live: true })).status, 200);
  const { token_hash } = await one('SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', uid);
  stepUpSessions.set(token_hash, 'test');
  try {
    const d = await c(`/playbooks/${p.body.id}/deploy`, { account: 'alpaca' });
    assert.equal(d.status, 401); assert.equal(d.body.stepUp, true);
    assert.notEqual((await c(`/playbooks/${p.body.id}/deploy`, { account: 'paper', allocation: 20 })).status, 401, 'paper is not held');
  } finally { stepUpSessions.delete(token_hash); }
});

test('AI builder: validated and backtested before it can be saved; labelled AI-generated', async () => {
  const r = await c('/playbooks/ai', { prompt: 'Hold QQQ and XLV equally, only while SPY is above its 200-day average, otherwise BIL. Rebalance monthly.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.valid, true, JSON.stringify(r.body.problems)); assert.match(r.body.label, /AI-generated. Not investment advice/);
  assert.ok(r.body.backtest.stats); assert.equal(r.body.playbook.root.type, 'if');
  const saved = await c('/playbooks', { name: r.body.name, playbook: r.body.playbook, aiGenerated: true });
  assert.equal(saved.status, 200); assert.equal(saved.body.aiGenerated, true); assert.ok(saved.body.backtest, 'backtested when saved');
  assert.match(saved.body.label, /AI-generated/);
  // Invalid output is rejected with the reasons.
  assert.equal((await c('/playbooks', { name: 'x', playbook: { root: { type: 'group', weighting: 'specified', children: [{ type: 'asset', ticker: 'SPY', weight: 50 }] } }, aiGenerated: true })).status, 400);
});

test('library: Brightolio designs, publish (backtested), sort, backtest, independent copies, reports hide after 3, moderation', async () => {
  const lib = await c('/playbooks/library?sort=cagr');
  assert.equal(lib.status, 200);
  assert.ok(lib.body.some(x => x.official && x.by === 'Brightolio'));
  assert.match(lib.body[0].disclaimer, /past results do not predict/);
  const mine = await c('/playbooks', { name: 'Shared one', playbook: simple, notes: 'Plain 60/40' });
  assert.equal((await c(`/playbooks/${mine.body.id}`, { public: true }, 'PUT')).status, 400, 'backtest before publishing');
  await c(`/playbooks/${mine.body.id}/backtest`, { years: 3 });
  assert.equal((await c(`/playbooks/${mine.body.id}`, { public: true }, 'PUT')).status, 200);
  const other = client();
  const oid = (await other('/auth/register', { email: 'pb-other@example.com', password: 'Str0ngPassword1', agree: true })).body.user.id;
  await run("UPDATE users SET plan = 'pro', plan_status = 'active' WHERE id = ?", oid);
  assert.ok((await other('/playbooks/library')).body.some(x => x.id === String(mine.body.id)));
  assert.equal((await other(`/playbooks/library/${mine.body.id}/backtest`, { years: 2 })).status, 200);
  const copy = await other(`/playbooks/library/${mine.body.id}/copy`, {});
  assert.equal(copy.status, 200); assert.notEqual(copy.body.id, mine.body.id);
  await c(`/playbooks/${mine.body.id}`, { playbook: { ...simple, rebalance: 'daily' } }, 'PUT');
  assert.equal((await other(`/playbooks/${copy.body.id}`)).body.playbook.rebalance, 'monthly', 'copies are independent');
  const off = (await other('/playbooks/library')).body.find(x => x.official);
  assert.equal((await other(`/playbooks/library/${encodeURIComponent(off.id)}/copy`, {})).status, 200);
  // Reports: three people hide it; an admin restores it.
  assert.equal((await other(`/playbooks/library/${mine.body.id}/report`, { reason: 'Misleading description' })).status, 200);
  for (let i = 0; i < 2; i++) {
    const u = client(); const id = (await u('/auth/register', { email: `pb-rep${i}@example.com`, password: 'Str0ngPassword1', agree: true })).body.user.id;
    assert.ok(id); await u(`/playbooks/library/${mine.body.id}/report`, { reason: 'Looks like spam to me' });
  }
  assert.ok(!(await other('/playbooks/library')).body.some(x => x.id === String(mine.body.id)), 'hidden after 3 reports');
  assert.equal((await other(`/playbooks/moderation`)).status, 403);
  const admin = await one("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  if (admin) {
    await run("UPDATE users SET role = 'admin' WHERE id = ?", uid);
    const q = await c('/playbooks/moderation');
    assert.ok(q.body.some(x => x.id === mine.body.id && x.hidden && x.reports.length === 3));
    await c(`/playbooks/moderation/${mine.body.id}`, { action: 'restore' });
    assert.ok((await other('/playbooks/library')).body.some(x => x.id === String(mine.body.id)));
  }
});

test('discovery: three answers, matching examples with reasons, framed as education', async () => {
  assert.equal((await c('/playbooks/discover', { goal: 'growth' })).status, 400);
  const r = await c('/playbooks/discover', { goal: 'preserve', risk: 'low', horizon: 'short' });
  assert.equal(r.status, 200);
  assert.match(r.body.education, /not personal investment advice/);
  assert.ok(r.body.matches.length <= 3);
  for (const m of r.body.matches) { assert.ok(m.why.length >= 2); assert.ok(m.bt.dd <= 10); }
  const hi = await c('/playbooks/discover', { goal: 'growth', risk: 'high', horizon: 'long' });
  assert.ok(hi.body.matches.length >= 1);
});

test('AI fallback draft: tickers named only in the trend rule are not held', () => {
  const d = PB.ruleDraft('Hold QQQ and XLV equally while SPY is above its 200-day average, otherwise BIL.');
  assert.equal(d.playbook.root.type, 'if');
  assert.deepEqual(d.playbook.root.then.children.map(c => c.ticker), ['QQQ', 'XLV']);
  assert.equal(d.playbook.root.else.ticker, 'BIL');
});
