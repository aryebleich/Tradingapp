// /api/library: the strategy library, each user's editable copies, walkdown, orders, backtests
// and Reality Check.
import express from 'express';
import { one, all, run, now } from '../db.js';
import { requireUser } from '../auth.js';
import { isPaid } from '../fees.js';
import { template, TEMPLATES } from './templates.js';
import { BLUEPRINTS, blueprint, blueprintsList, isDesign, materialize, withExamples, cleanSlots, withPlaceholders, fromPlaceholders } from './blueprints.js';
import { publicName } from '../crypto.js';
import { Market, tickersOf, backtest } from './engine.js';
import { parse, mine, validateSpec, walkdown, execute, templatesList, ACCOUNTS, decidePending, nyNow, marginMultiple } from './runner.js';
import { realityFor, winRateSplit } from './reality.js';
import { adviserMode, adviserFor } from '../site.js';

// What each plan gets in the strategy builder. Free: build and follow by hand, automate one on
// paper, copy community strategies. Paid plans add automation on real accounts, longer backtests,
// publishing, margin and (Ultimate) real-money orders from the AI assistant.
export const STRATEGY_LIMITS = {
  free: { saved: 3, auto: 1, backtestYears: 3, publish: false, margin: 1, steps: 20, sleeves: 4, label: 'Free' },
  pro: { saved: 10, auto: 5, backtestYears: 8, publish: true, margin: 1.5, steps: 60, sleeves: 6, label: 'Pro' },
  elite: { saved: 50, auto: 25, backtestYears: 10, publish: true, margin: 2, steps: 120, sleeves: 8, label: 'Elite' },
  ultimate: { saved: 200, auto: 100, backtestYears: 10, publish: true, margin: 2, steps: 200, sleeves: 8, aiLiveOrders: true, label: 'Ultimate' },
};
export const PLAN_FEATURES = [
  ['Saved strategies', p => String(p.saved)], ['Running automatically at once', p => String(p.auto)], ['Automatic on real accounts', p => (p.label === 'Free' ? 'Paper only' : 'Yes')],
  ['Backtest history', p => `${p.backtestYears} years`], ['Steps per strategy', p => String(p.steps)], ['Sleeves (separate models)', p => String(p.sleeves)],
  ['Publish to the community', p => (p.publish ? 'Yes' : 'Copy only')], ['Margin (when your account allows it)', p => (p.margin > 1 ? `Up to ${p.margin}x` : 'No')],
  ['Real-money orders from the AI assistant', p => (p.aiLiveOrders ? 'Yes' : '-')],
];
export const planOf = u => (u.role === 'admin' && !u.previewPlan ? 'ultimate' : isPaid(u) ? (STRATEGY_LIMITS[u.plan] ? u.plan : 'pro') : 'free');
const limits = u => STRATEGY_LIMITS[planOf(u)];
// The design a strategy's rules are checked against.
const baseOf = s => bpById(s.templateId) || template(s.templateId) || s.design;
// Checks a design (with ticker slots) or concrete rules from the browser.
function checkDesign(spec, base, lim) {
  if (!isDesign(base) && !isDesign(spec)) return validateSpec(spec, base);
  const cleaned = cleanSlots(spec, isDesign(base) ? base : spec);
  const v = validateSpec(withPlaceholders(cleaned), withPlaceholders(isDesign(base) ? { ...base, ...cleaned } : cleaned));
  const out = fromPlaceholders(v, cleaned);
  if (lim && out.kind === 'tree') {
    if (out.sleeves.length > lim.sleeves) throw upgradeOr(`Your plan allows ${lim.sleeves} sleeves in one strategy`);
    const n = out.sleeves.reduce((a, sl) => a + sl.steps.length, 0);
    if (n > lim.steps) throw upgradeOr(`Your plan allows ${lim.steps} steps in one strategy`);
  }
  return out;
}
const upgradeOr = msg => Object.assign(new Error(msg + '. Upgrade for more.'), { status: 402, upgrade: true, feature: 'Bigger strategies' });
// A fresh strategy from scratch: one comparison and two slots.
const BLANK = { id: 'bp_blank', name: 'My strategy', tagline: 'Start from one rule and build it up', kind: 'tree', rebalance: 'daily', risk: 'medium',
  about: 'One rule to start: if your index is above its 200-day average, hold your leveraged ETF; otherwise hold your safe ETF. Add steps, sleeves and indicators from there.',
  slots: { E1: { kind: 'etf', role: 'The index the rule watches', example: 'SPY', ticker: '' }, L1: { kind: 'lev', role: 'What to hold when the rule is true', example: 'SPXL', ticker: '' }, E2: { kind: 'etf', role: 'What to hold otherwise', example: 'BIL', ticker: '' } },
  sleeves: [{ name: 'Main', weight: 1, steps: [{ id: '1', t: 'cmp', label: 'Trend', a: ['close', '$E1', 0], op: '>', b: ['sma', '$E1', 200], yes: '@$L1', no: '@$E2' }] }] };
const bpById = id => (id === 'bp_blank' ? BLANK : blueprint(id));
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
// Letting Brightfolio's own ready-made strategies trade real money by themselves is managing money,
// which needs a registered investment adviser. In software-only mode they run automatically on
// paper only; on a real account the user follows them by hand (the same rules for everyone).
export const ADVISER_ONLY = 'Automatic trading of the ready-made strategies on a real account is available once the business is a registered investment adviser. Run it automatically on paper, or follow it by hand on your real account.';
const adviserOnly = () => Object.assign(new Error(ADVISER_ONLY), { status: 403, adviserOnly: true });
const upgrade = feature => Object.assign(new Error(`${feature} is part of the Pro plan`), { status: 402, upgrade: true, feature });
const backtests = new Map(); // `${id}:${hash}` -> { at, result }, so reopening a page does not re-run it

const materializeOk = d => { try { materialize(d); return true; } catch { return false; } };
export const router = express.Router();
router.use(requireUser);

router.get('/templates', (req, res) => res.json([{ ...blueprintsList()[0], ...BLANK, slots: Object.entries(BLANK.slots).map(([k, v]) => ({ key: k, kind: v.kind, role: v.role, example: v.example })), sleeves: 1, steps: 1 }, ...blueprintsList()]));
router.get('/plans', (req, res) => res.json({ current: planOf(req.user), plans: Object.entries(STRATEGY_LIMITS).map(([k, p]) => ({ id: k, ...p })), rows: PLAN_FEATURES.map(([t, f]) => [t, ...Object.values(STRATEGY_LIMITS).map(f)]) }));
router.get('/margin', async (req, res) => { const m = await marginMultiple(req.user.id, String(req.query.account || 'paper')).catch(e => ({ max: 1, margin: false, why: e.message })); res.json({ ...m, planMax: limits(req.user).margin, allowed: Math.min(m.max, limits(req.user).margin) }); });
// The original strategies, kept for the owner (Admin → Original strategies).
router.get('/originals', (req, res) => { if (req.user.role !== 'admin') throw bad('Admin only', 403); res.json(TEMPLATES.map(t => ({ ...t, blueprint: BLUEPRINTS.find(b => b.original === t.id)?.name || null }))); });
// Strategies people chose to publish: the rules and tickers, never the owner, the account or the money.
router.get('/community', async (req, res) => {
  const rows = (await all('SELECT * FROM user_strategies WHERE public = 1 ORDER BY published_at DESC LIMIT 100')).map(parse);
  res.json(rows.map(s => ({ id: s.id, name: s.name, notes: s.notes, kind: s.design?.kind, rebalance: s.design?.rebalance, by: publicName(s.userId), mine: s.userId === req.user.id, publishedAt: s.publishedAt,
    tickers: s.design?.slots ? Object.values(s.design.slots).map(x => x.ticker).filter(Boolean) : [...(s.design?.lists?.etf || []), ...(s.design?.lists?.lev || [])].slice(0, 12),
    backtest: s.state.bt ? { cagr: s.state.bt.cagr, dd: s.state.bt.dd, years: s.state.bt.years } : null })));
});
router.post('/community/:id/copy', async (req, res) => {
  const src = parse(await one('SELECT * FROM user_strategies WHERE id = ? AND public = 1', +req.params.id));
  if (!src) throw bad('That strategy is no longer published', 404);
  const n = (await one('SELECT COUNT(*) n FROM user_strategies WHERE user_id = ?', req.user.id)).n;
  if (n >= limits(req.user).saved) throw isPaid(req.user) ? bad(`Your plan holds ${limits(req.user).saved} strategies`) : upgrade('More saved strategies');
  const r = await run('INSERT INTO user_strategies (user_id, template_id, name, spec, notes, copied_from, created_at) VALUES (?,?,?,?,?,?,?)', req.user.id, src.templateId, `${src.name} (copy)`.slice(0, 60), JSON.stringify(src.design), src.notes, src.id, now());
  res.json(parse(await one('SELECT * FROM user_strategies WHERE id = ?', r.lastInsertRowid)));
});

router.get('/', async (req, res) => {
  const rows = (await all('SELECT * FROM user_strategies WHERE user_id = ? ORDER BY id', req.user.id)).map(parse);
  const list = await Promise.all(rows.map(async s => {
    const rc = s.ready ? await realityFor(s) : { status: 'learning', days: 0 };
    return { id: s.id, templateId: s.templateId, name: s.name, kind: s.design?.kind, ready: s.ready, missing: s.missing, public: s.public, account: s.account, allocation: s.allocation, mode: s.mode, lastRun: s.lastRun, lastResult: s.lastResult, reality: { status: rc.status, days: rc.days, winRate: rc.winRate, cumReturn: rc.cumReturn, throttle: rc.throttle } };
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
  // New strategies start from a blueprint with empty tickers; the originals only for the owner.
  const id = String(req.body.blueprintId || req.body.templateId || '');
  const t = bpById(id) || (req.user.role === 'admin' ? template(id) : null);
  if (!t) throw bad('Pick a design from the library');
  const n = (await one('SELECT COUNT(*) n FROM user_strategies WHERE user_id = ?', req.user.id)).n;
  if (n >= limits(req.user).saved) throw isPaid(req.user) ? bad(`Your plan holds ${limits(req.user).saved} strategies`) : upgrade('More saved strategies');
  let spec = JSON.parse(JSON.stringify(t));
  if (req.body.fillExamples && isDesign(spec)) spec = withExamples(spec);
  // Tickers can be given right away (slot keys, or the two lists).
  if (req.body.slots && spec.slots) for (const [k, v] of Object.entries(req.body.slots)) if (spec.slots[k]) spec.slots[k].ticker = String(v || '');
  if (req.body.lists && spec.lists) spec.lists = req.body.lists;
  const clean = isDesign(spec) ? checkDesign(spec, t) : spec;
  const name = String(req.body.name || t.name).trim().slice(0, 60) || t.name;
  const r = await run('INSERT INTO user_strategies (user_id, template_id, name, spec, created_at) VALUES (?,?,?,?,?)', req.user.id, t.id, name, JSON.stringify(clean), now());
  res.json(parse(await one('SELECT * FROM user_strategies WHERE id = ?', r.lastInsertRowid)));
});

router.get('/:id', async (req, res) => {
  const s = await mine(req.params.id, req.user.id);
  const runs = await all('SELECT kind, summary, at FROM strategy_runs WHERE strategy_id = ? ORDER BY id DESC LIMIT 30', s.id);
  if (s.state.pending && s.state.pending.day !== nyNow().day) s.state = { ...s.state, pending: undefined };
  const bp = bpById(s.templateId);
  res.json({ ...s, template: bp ? { id: bp.id, name: bp.name, tagline: bp.tagline, about: bp.about } : templatesList().find(t => t.id === s.templateId) || null, runs, reality: await realityFor(s), limits: limits(req.user), plan: planOf(req.user), autoRealAllowed: !s.templateId || adviserFor(req.user) });
});

router.put('/:id', async (req, res) => {
  const s = await mine(req.params.id, req.user.id), b = req.body, base = baseOf(s), lim = limits(req.user);
  const spec = b.spec ? checkDesign(b.spec, base, lim) : s.design;
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
  // Margin: what the plan allows and what the account allows today.
  let leverage = s.leverage;
  if (b.leverage !== undefined) {
    leverage = pct(b.leverage, 1, 1, 4);
    if (leverage > 1) {
      if (lim.margin <= 1) throw upgrade('Margin in strategies');
      const m = await marginMultiple(req.user.id, account);
      if (leverage > Math.min(m.max, lim.margin)) throw bad(m.max <= 1 ? `No margin here: ${m.why}` : `Up to ${Math.min(m.max, lim.margin)}x here (${m.why})`);
    }
  }
  // Publishing: the rules and tickers become visible to everyone (never the account or the money).
  let pub = s.public;
  if (b.public !== undefined) {
    pub = !!b.public;
    if (pub && !lim.publish) throw upgrade('Publishing strategies');
    if (pub && isDesign(spec) && !materializeOk(spec)) throw bad('Choose every ticker before publishing');
  }
  const notes = b.notes === undefined ? s.notes : String(b.notes || '').slice(0, 1000);
  if (mode !== 'manual' && isDesign(spec) && !materializeOk(spec)) throw bad('Choose every ticker before it can run by itself');
  await run('UPDATE user_strategies SET name = ?, spec = ?, account = ?, allocation = ?, cash_buffer = ?, mode = ?, whole_shares = ?, stop_pct = ?, run_at = ?, state = ?, leverage = ?, public = ?, published_at = ?, notes = ? WHERE id = ?',
    String(b.name ?? s.name).trim().slice(0, 60) || s.name, JSON.stringify(spec), account, pct(b.allocation, s.allocation, 1, 100), pct(b.cashBuffer, s.cashBuffer, 0, 90),
    mode, b.wholeShares === undefined ? (s.wholeShares ? 1 : 0) : (b.wholeShares ? 1 : 0), stop, runAt, JSON.stringify(state), leverage, pub ? 1 : 0, pub ? (s.publishedAt || now()) : null, notes, s.id);
  res.json(parse(await one('SELECT * FROM user_strategies WHERE id = ?', s.id)));
});

// Back to the original rules from the library (settings such as account and allocation are kept).
router.post('/:id/reset', async (req, res) => {
  const s = await mine(req.params.id, req.user.id), t = bpById(s.templateId) || template(s.templateId);
  if (!t) throw bad('This strategy has no library design');
  // Back to the design's rules; the tickers you chose stay.
  const fresh = JSON.parse(JSON.stringify(t));
  if (fresh.slots && s.design?.slots) for (const k of Object.keys(fresh.slots)) fresh.slots[k].ticker = s.design.slots[k]?.ticker || '';
  if (fresh.lists && s.design?.lists) fresh.lists = s.design.lists;
  await run('UPDATE user_strategies SET spec = ? WHERE id = ?', JSON.stringify(fresh), s.id);
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
  const spec = req.body.spec ? materialize(checkDesign(req.body.spec, baseOf(s))) : undefined;
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
  if (!req.body.spec && !s.ready) throw bad(`Choose the tickers first: ${s.missing.join(', ')}`, 409);
  let spec = req.body.spec ? materialize(checkDesign(req.body.spec, baseOf(s))) : s.spec;
  if (spec.kind === 'tree' && spec.sleeves.some(sl => sl.steps.some(st => st.t === 'missing'))) throw bad('Some steps still need a rule, so this strategy cannot be backtested yet. Fill them in under "Edit rules".');
  // Typed-in monthly predictions cannot be replayed; the backtest uses the automatic stand-in.
  if (spec.kind === 'macro') spec = { ...spec, params: { ...spec.params, source: 'auto' } };
  const maxYears = limits(req.user).backtestYears;
  if (+req.body.years > maxYears) throw upgradeOr(`Your plan backtests up to ${maxYears} years`);
  const years = Math.min(maxYears, Math.max(1, +req.body.years || Math.min(5, maxYears)));
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
