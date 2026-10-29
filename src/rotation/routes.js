// /api/library: the strategy library, each user's editable copies, walkdown, orders, backtests
// and Reality Check.
import express from 'express';
import { one, all, run, now } from '../db.js';
import { requireUser } from '../auth.js';
import { isPaid } from '../fees.js';
import { template } from './templates.js';
import { Market, tickersOf, backtest } from './engine.js';
import { parse, mine, validateSpec, walkdown, execute, templatesList, ACCOUNTS, decidePending, nyNow } from './runner.js';
import { realityFor, winRateSplit } from './reality.js';
import { adviserMode, adviserFor } from '../site.js';

// Free: try everything by hand and automate one strategy on paper. Paid plans automate real accounts.
export const STRATEGY_LIMITS = { free: { saved: 3, auto: 1 }, pro: { saved: 10, auto: 5 }, elite: { saved: 50, auto: 25 }, ultimate: { saved: 200, auto: 100 } };
const limits = u => (u.role === 'admin' && !u.previewPlan ? STRATEGY_LIMITS.ultimate : isPaid(u) ? STRATEGY_LIMITS[u.plan] || STRATEGY_LIMITS.pro : STRATEGY_LIMITS.free);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
// Letting Brightfolio's own ready-made strategies trade real money by themselves is managing money,
// which needs a registered investment adviser. In software-only mode they run automatically on
// paper only; on a real account the user follows them by hand (the same rules for everyone).
export const ADVISER_ONLY = 'Automatic trading of the ready-made strategies on a real account is available once the business is a registered investment adviser. Run it automatically on paper, or follow it by hand on your real account.';
const adviserOnly = () => Object.assign(new Error(ADVISER_ONLY), { status: 403, adviserOnly: true });
const upgrade = feature => Object.assign(new Error(`${feature} is part of the Pro plan`), { status: 402, upgrade: true, feature });
const backtests = new Map(); // `${id}:${hash}` -> { at, result }, so reopening a page does not re-run it

export const router = express.Router();
router.use(requireUser);

router.get('/templates', (req, res) => res.json(templatesList()));

router.get('/', async (req, res) => {
  const rows = (await all('SELECT * FROM user_strategies WHERE user_id = ? ORDER BY id', req.user.id)).map(parse);
  const list = await Promise.all(rows.map(async s => {
    const rc = await realityFor(s);
    return { id: s.id, templateId: s.templateId, name: s.name, kind: s.spec.kind, account: s.account, allocation: s.allocation, mode: s.mode, lastRun: s.lastRun, lastResult: s.lastResult, reality: { status: rc.status, days: rc.days, winRate: rc.winRate, cumReturn: rc.cumReturn, throttle: rc.throttle } };
  }));
  res.json({ strategies: list, limits: limits(req.user), split: winRateSplit(list.map(s => ({ id: s.id, name: s.name, winRate: s.reality.winRate }))) });
});

// Strategies with orders waiting for approval today (for the banner on every page).
router.get('/pending', async (req, res) => {
  const today = nyNow().day;
  const rows = (await all("SELECT * FROM user_strategies WHERE user_id = ? AND state LIKE '%pending%'", req.user.id)).map(parse).filter(s => s.state.pending?.day === today);
  res.json(rows.map(s => ({ id: s.id, name: s.name, account: s.account, orders: s.state.pending.orders, at: s.state.pending.at })));
});

router.post('/', async (req, res) => {
  const t = template(String(req.body.templateId || ''));
  if (!t) throw bad('Pick a strategy from the library');
  const n = (await one('SELECT COUNT(*) n FROM user_strategies WHERE user_id = ?', req.user.id)).n;
  if (n >= limits(req.user).saved) throw isPaid(req.user) ? bad(`Your plan holds ${limits(req.user).saved} strategies`) : upgrade('More saved strategies');
  const spec = JSON.parse(JSON.stringify(t));
  const r = await run('INSERT INTO user_strategies (user_id, template_id, name, spec, created_at) VALUES (?,?,?,?,?)', req.user.id, t.id, t.name, JSON.stringify(spec), now());
  res.json(parse(await one('SELECT * FROM user_strategies WHERE id = ?', r.lastInsertRowid)));
});

router.get('/:id', async (req, res) => {
  const s = await mine(req.params.id, req.user.id);
  const runs = await all('SELECT kind, summary, at FROM strategy_runs WHERE strategy_id = ? ORDER BY id DESC LIMIT 30', s.id);
  if (s.state.pending && s.state.pending.day !== nyNow().day) s.state = { ...s.state, pending: undefined };
  res.json({ ...s, template: templatesList().find(t => t.id === s.templateId) || null, runs, reality: await realityFor(s), limits: limits(req.user), autoRealAllowed: !s.templateId || adviserFor(req.user) });
});

router.put('/:id', async (req, res) => {
  const s = await mine(req.params.id, req.user.id), b = req.body, base = template(s.templateId) || s.spec;
  const spec = b.spec ? validateSpec(b.spec, base) : s.spec;
  const account = b.account ?? s.account;
  if (!ACCOUNTS.includes(account)) throw bad('Pick an account');
  const mode = ['auto', 'manual', 'approve'].includes(b.mode) ? b.mode : s.mode;
  // Following a strategy by hand or approving each trade is the user's own trading: every plan.
  // Trading by itself on a real account is automation (paid plans).
  if (account !== 'paper' && mode === 'auto' && !isPaid(req.user)) throw upgrade('Running strategies on your brokerage account');
  if (mode === 'auto' && account !== 'paper' && s.templateId && !adviserMode()) throw adviserOnly();
  if (mode !== 'manual' && mode !== s.mode && s.mode === 'manual') {
    const autos = (await one("SELECT COUNT(*) n FROM user_strategies WHERE user_id = ? AND mode IN ('auto', 'approve')", req.user.id)).n;
    if (autos >= limits(req.user).auto) throw isPaid(req.user) ? bad(`Your plan runs ${limits(req.user).auto} automatic strategies at once`) : upgrade('More than one automatic strategy');
  }
  const pct = (v, d, lo = 0, hi = 100) => { if (v === undefined) return d; const n = +v; if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`Use a number from ${lo} to ${hi}`); return n; };
  const stop = b.stopPct === undefined ? s.stopPct : b.stopPct === '' || b.stopPct === null ? null : pct(b.stopPct, null, 1, 50);
  const runAt = b.runAt === undefined ? s.runAt : Math.round(pct(b.runAt, s.runAt, 570, 955));
  const state = { ...s.state, ...(b.throttle !== undefined ? { throttle: !!b.throttle } : {}) };
  await run('UPDATE user_strategies SET name = ?, spec = ?, account = ?, allocation = ?, cash_buffer = ?, mode = ?, whole_shares = ?, stop_pct = ?, run_at = ?, state = ? WHERE id = ?',
    String(b.name ?? s.name).trim().slice(0, 60) || s.name, JSON.stringify(spec), account, pct(b.allocation, s.allocation, 1, 100), pct(b.cashBuffer, s.cashBuffer, 0, 90),
    mode, b.wholeShares === undefined ? (s.wholeShares ? 1 : 0) : (b.wholeShares ? 1 : 0), stop, runAt, JSON.stringify(state), s.id);
  res.json(parse(await one('SELECT * FROM user_strategies WHERE id = ?', s.id)));
});

// Back to the original rules from the library (settings such as account and allocation are kept).
router.post('/:id/reset', async (req, res) => {
  const s = await mine(req.params.id, req.user.id), t = template(s.templateId);
  if (!t) throw bad('This strategy has no library original');
  await run('UPDATE user_strategies SET spec = ? WHERE id = ?', JSON.stringify(t), s.id);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const s = await mine(req.params.id, req.user.id);
  await run('DELETE FROM strategy_days WHERE strategy_id = ?', s.id);
  await run('DELETE FROM strategy_runs WHERE strategy_id = ?', s.id);
  await run('DELETE FROM user_strategies WHERE id = ?', s.id);
  res.json({ ok: true });
});

// Today's walk. `overrides` are typed values (manual mode); `spec` previews unsaved edits.
router.post('/:id/walkdown', async (req, res) => {
  const s = await mine(req.params.id, req.user.id);
  const spec = req.body.spec ? validateSpec(req.body.spec, template(s.templateId) || s.spec) : undefined;
  res.json(await walkdown(s, req.user.id, { overrides: req.body.overrides || {}, spec }));
});

// Placing today's orders by hand: the user's own orders, on every plan.
router.post('/:id/execute', async (req, res) => {
  const s = await mine(req.params.id, req.user.id);
  res.json(await execute(s, req.user.id, { overrides: req.body.overrides || {} }));
});
// "Approve each trade": approve (place) or skip the orders prepared today.
router.post('/:id/approve', async (req, res) => {
  const s = await mine(req.params.id, req.user.id);
  res.json(await decidePending(s, req.user.id, req.body?.approve === true, nyNow().day));
});

router.post('/:id/backtest', async (req, res) => {
  const s = await mine(req.params.id, req.user.id);
  let spec = req.body.spec ? validateSpec(req.body.spec, template(s.templateId) || s.spec) : s.spec;
  if (spec.kind === 'tree' && spec.sleeves.some(sl => sl.steps.some(st => st.t === 'missing'))) throw bad('Some steps still need a rule, so this strategy cannot be backtested yet. Fill them in under "Edit rules".');
  // Typed-in monthly predictions cannot be replayed; the backtest uses the automatic stand-in.
  if (spec.kind === 'macro') spec = { ...spec, params: { ...spec.params, source: 'auto' } };
  const years = Math.min(10, Math.max(1, +req.body.years || 5));
  const key = `${s.id}:${years}:${JSON.stringify(spec).length}:${JSON.stringify(spec).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)}`;
  const hit = backtests.get(key);
  let result = hit && now() - hit.at < 3600e3 ? hit.result : null;
  if (!result) {
    const mkt = await new Market(req.user.id).load(tickersOf(spec));
    result = backtest(spec, mkt, { years });
    result.failed = Object.fromEntries(mkt.failed);
    backtests.set(key, { at: now(), result });
    if (backtests.size > 200) backtests.delete(backtests.keys().next().value);
  }
  // The saved rules' backtest becomes Reality Check's yardstick.
  if (!req.body.spec) await run('UPDATE user_strategies SET state = ? WHERE id = ?', JSON.stringify({ ...s.state, bt: { mean: result.dailyStats.mean, sd: result.dailyStats.sd, dd: result.m.dd, cagr: result.m.cagr, years, at: now() } }), s.id);
  res.json(result);
});

// Applies the win-rate split to the allocations of the given strategies.
router.post('/split/apply', async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  for (const it of items) await run('UPDATE user_strategies SET allocation = ? WHERE id = ? AND user_id = ?', Math.min(100, Math.max(1, +it.allocation || 0)), +it.id, req.user.id);
  res.json({ ok: true });
});
