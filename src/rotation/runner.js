// A user's copy of a library strategy: walkdown with live data, placing the orders (by hand or
// automatically each trading day), trailing stops, and the daily model return that Reality Check uses.
import { one, all, run, now } from '../db.js';
import { adviserMode } from '../site.js';
import { placeOrder, accountSummary, lastPrice, validSymbol } from '../brokers.js';
import { TEMPLATES, template } from './templates.js';
import { Market, decide, tickersOf, sizeOrders, stopsFor, isRebalanceDay, keyOf } from './engine.js';
import { FNS } from './indicators.js';
import { realityFor } from './reality.js';
import { sendSms, sendEmail } from '../notify.js';

export { ACCOUNT_IDS as ACCOUNTS } from '../brokers.js';
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const J = s => { try { return JSON.parse(s || 'null'); } catch { return null; } };

export const parse = row => row && ({
  id: row.id, userId: row.user_id, templateId: row.template_id, name: row.name, spec: J(row.spec), account: row.account, allocation: row.allocation, cashBuffer: row.cash_buffer,
  mode: row.mode, wholeShares: !!row.whole_shares, stopPct: row.stop_pct, runAt: row.run_at, state: J(row.state) || {}, lastRun: row.last_run, lastResult: J(row.last_result), createdAt: row.created_at,
});
export async function mine(id, userId) {
  const r = await one('SELECT * FROM user_strategies WHERE id = ? AND user_id = ?', +id, userId);
  if (!r) throw bad('Strategy not found', 404);
  return parse(r);
}

// ---------- validation: everything is editable, but only into something the engine can run ----------

const num = (v, lo, hi, what) => { const n = +v; if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`${what} must be between ${lo} and ${hi}`); return n; };
function metric(m, where) {
  if (typeof m === 'number' && Number.isFinite(m)) return m;
  if (!Array.isArray(m) || m.length !== 3) throw bad(`${where}: an indicator looks like ["rsi", "SPY", 10]`);
  const [fn, t, n] = m;
  if (!FNS.includes(fn)) throw bad(`${where}: unknown indicator "${fn}"`);
  const T = String(t).toUpperCase();
  if (!validSymbol(T)) throw bad(`${where}: "${t}" is not a valid ticker`);
  return [fn, T, fn === 'close' ? 0 : Math.round(num(n, 1, 400, `${where} length`))];
}
export function validateSpec(spec, base) {
  if (!spec || typeof spec !== 'object') throw bad('Missing strategy settings');
  const out = { ...base, ...spec, id: base.id, kind: base.kind };
  if (out.kind === 'tree') {
    if (!Array.isArray(spec.sleeves) || !spec.sleeves.length || spec.sleeves.length > 8) throw bad('A tree strategy needs 1 to 8 sleeves');
    out.sleeves = spec.sleeves.map((sl, k) => {
      if (!Array.isArray(sl.steps) || !sl.steps.length || sl.steps.length > 200) throw bad(`Sleeve ${k + 1} needs 1 to 200 steps`);
      const ids = new Set(sl.steps.map(s => String(s.id)));
      if (ids.size !== sl.steps.length) throw bad(`Sleeve ${k + 1} has two steps with the same id`);
      const target = (to, where) => {
        if (to == null || to === '') return null;
        to = String(to);
        if (to.startsWith('@')) { const T = to.slice(1).toUpperCase(); if (!validSymbol(T)) throw bad(`${where}: "${to.slice(1)}" is not a valid ticker`); return '@' + T; }
        if (!ids.has(to)) throw bad(`${where}: there is no step "${to}"`);
        return to;
      };
      const steps = sl.steps.map(s => {
        const w = `Step ${s.id}`, o = { id: String(s.id), t: s.t, ...(s.label ? { label: String(s.label).slice(0, 80) } : {}), ...(s.rebuilt ? { rebuilt: true } : {}) };
        if (s.t === 'cmp') Object.assign(o, { a: metric(s.a, w), op: ['>', '<', '>=', '<='].includes(s.op) ? s.op : bad(`${w}: compare with >, <, >= or <=`), b: metric(s.b, w), yes: target(s.yes, w), no: target(s.no, w) });
        else if (s.t === 'band') Object.assign(o, { a: metric(s.a, w), hi: s.hi === null || s.hi === '' ? null : num(s.hi, -1e6, 1e6, `${w} upper level`), hiTo: target(s.hiTo, w), lo: s.lo === null || s.lo === '' ? null : num(s.lo, -1e6, 1e6, `${w} lower level`), loTo: target(s.loTo, w), mid: target(s.mid, w) });
        else if (s.t === 'higher') Object.assign(o, { a: metric(s.a, w), b: metric(s.b, w), aTo: target(s.aTo, w), bTo: target(s.bTo, w) });
        else if (s.t === 'vote') Object.assign(o, { conds: (s.conds || []).slice(0, 10).map(c => ({ a: metric(c.a, w), op: ['>', '<', '>=', '<='].includes(c.op) ? c.op : '>', b: metric(c.b, w) })), need: Math.round(num(s.need, 1, 10, `${w} votes needed`)), yes: target(s.yes, w), no: target(s.no, w) });
        else if (s.t === 'missing') Object.assign(o, { ...(s.a ? { a: metric(s.a, w) } : {}), ...(s.b ? { b: metric(s.b, w) } : {}) });
        else throw bad(`${w}: unknown step type "${s.t}"`);
        if (o.t === 'band' && o.hi == null && o.lo == null) throw bad(`${w}: give an upper or a lower level`);
        if (['cmp', 'vote'].includes(o.t) && (!o.yes || !o.no)) throw bad(`${w}: both outcomes need a target`);
        return o;
      });
      return { name: String(sl.name || `Sleeve ${k + 1}`).slice(0, 60), weight: num(sl.weight, 0, 1, `Sleeve ${k + 1} weight`), steps };
    });
    const tot = out.sleeves.reduce((a, s) => a + s.weight, 0);
    if (tot > 1.0001) throw bad('Sleeve weights add up to more than 100%');
  } else {
    const p = { ...base.params, ...(spec.params || {}) };
    const list = v => [...new Set((Array.isArray(v) ? v : String(v).split(/[\s,]+/)).map(x => String(x).trim().toUpperCase()).filter(Boolean))];
    if (out.kind === 'momentum') Object.assign(p, { universe: list(p.universe), lookback: Math.round(num(p.lookback, 5, 400, 'Lookback')), top: Math.round(num(p.top, 1, 10, 'Stocks to hold')), stopPct: p.stopPct === '' || p.stopPct == null ? null : num(p.stopPct, 1, 50, 'Stop') });
    if (out.kind === 'pullback') Object.assign(p, { universe: list(p.universe), bbLen: Math.round(num(p.bbLen, 5, 100, 'Band length')), bbMult: num(p.bbMult, 0.5, 4, 'Band multiplier'), rsiLen: Math.round(num(p.rsiLen, 2, 50, 'RSI length')), rsiEntry: num(p.rsiEntry, 5, 95, 'RSI entry level'), minPullback: num(p.minPullback, 0, 50, 'Minimum pullback'), highLen: Math.round(num(p.highLen, 5, 250, 'High lookback')), maxPositions: Math.round(num(p.maxPositions, 1, 30, 'Max positions')), maxHoldDays: Math.round(num(p.maxHoldDays, 1, 120, 'Max holding days')) });
    if (out.kind === 'macro') {
      Object.assign(p, { assets: list(p.assets), btc: p.btc ? String(p.btc).toUpperCase() : null, btcCap: num(p.btcCap, 0, 100, 'Bitcoin cap'), maxTotal: num(p.maxTotal, 10, 100, 'Total weight'), source: p.source === 'auto' ? 'auto' : 'manual', proxyDays: Math.round(num(p.proxyDays, 5, 252, 'Proxy lookback')) });
      p.predictions = Object.fromEntries(p.assets.map(t => [t, p.predictions?.[t] === '' || p.predictions?.[t] == null ? null : num(p.predictions[t], -100, 100, `${t} prediction`)]));
    }
    if (p.universe && (p.universe.length < 1 || p.universe.length > 100)) throw bad('The list needs 1 to 100 tickers');
    if (p.assets && (p.assets.length < 1 || p.assets.length > 12)) throw bad('Use 1 to 12 assets');
    const wrong = [...(p.universe || []), ...(p.assets || [])].find(t => !validSymbol(t));
    if (wrong) throw bad(`"${wrong}" is not a valid ticker`);
    out.params = p;
  }
  if (out.rebalance === 'weekly') out.weekday = Math.round(num(out.weekday ?? 3, 1, 5, 'Weekday'));
  return out;
}

// ---------- walkdown + orders ----------

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

export async function capitalFor(s, userId) {
  const a = await accountSummary(userId, s.account);
  // Reality Check auto-throttle: less money (or none) while live results drift from the backtest.
  const throttle = s.state.throttle ? s.state.reality?.multiplier ?? 1 : 1;
  const investable = a.equity * (s.allocation / 100) * (1 - s.cashBuffer / 100) * throttle;
  return { equity: a.equity, cash: a.cash, investable, throttle, positions: a.positions };
}

// The full picture for the strategy page: today's walk, target weights, sized orders, stops.
export async function walkdown(s, userId, { overrides, spec } = {}) {
  spec = spec || s.spec;
  const mkt = await new Market(userId).load(tickersOf(spec));
  const day = today();
  const d = decide(spec, mkt, { overrides, state: s.state, today: day });
  let cap = null, orders = [];
  try {
    cap = await capitalFor(s, userId);
    const priceCache = {};
    for (const t of new Set([...Object.keys(d.weights), ...Object.keys(s.state.holdings || {})]))
      priceCache[t] = await lastPrice(t, userId).catch(() => mkt.price(t));
    orders = sizeOrders(d.weights, cap.investable, t => priceCache[t], { whole: s.wholeShares, holdings: s.state.holdings || {} });
  } catch (e) { cap = { error: e.message }; }
  const failed = Object.fromEntries(mkt.failed);
  return {
    day, rebalanceDay: isRebalanceDay(spec, day), ...d, orders, capital: cap,
    stops: stopsFor(Object.keys(d.weights), mkt), failed, source: [...new Set([...mkt.bars.values()].map(b => b.source))],
  };
}

// Places the orders that move this strategy's holdings to today's targets: sells first, then buys.
export async function execute(s, userId, { overrides, kind = 'manual' } = {}) {
  const w = await walkdown(s, userId, { overrides });
  if (w.capital?.error) throw bad(w.capital.error, 409);
  if (s.spec.kind === 'tree' && !w.complete) throw bad('Not every step could be decided today: ' + (w.sleeves.find(x => !x.ticker)?.error || 'a step needs a rule'));
  const holdings = { ...(s.state.holdings || {}) }, results = [];
  const todo = w.orders.filter(o => o.delta !== 0).sort((a, b) => a.delta - b.delta);
  for (const o of todo) {
    const side = o.delta > 0 ? 'buy' : 'sell', qty = Math.abs(o.delta);
    try {
      const r = await placeOrder(userId, s.account, { symbol: o.ticker, side, qty }, `strategy:${s.id}`);
      holdings[o.ticker] = +((holdings[o.ticker] || 0) + (side === 'buy' ? qty : -qty)).toFixed(4);
      results.push({ ticker: o.ticker, side, qty, ok: true, price: r.price ?? null, status: r.status });
    } catch (e) {
      // A position sold by hand outside the strategy: forget it instead of failing every day.
      if (side === 'sell' && /hold|position|insufficient/i.test(e.message)) holdings[o.ticker] = 0;
      results.push({ ticker: o.ticker, side, qty, ok: false, error: e.message });
    }
  }
  for (const [t, q] of Object.entries(holdings)) if (!(q > 0)) delete holdings[t];
  const state = { ...s.state, holdings, highs: Object.fromEntries(Object.keys(holdings).map(t => [t, Math.max(s.state.highs?.[t] || 0, w.orders.find(o => o.ticker === t)?.price || 0)])) };
  if (s.spec.kind === 'pullback') state.held = Object.fromEntries(Object.keys(w.weights).map(t => [t, s.state.held?.[t] || w.day]));
  const summary = todo.length ? results.map(r => `${r.ok ? '' : '✗ '}${r.side.toUpperCase()} ${r.qty} ${r.ticker}`).join(', ') : 'No change: holdings already match the targets';
  await run('UPDATE user_strategies SET state = ?, last_run = ?, last_result = ? WHERE id = ?', JSON.stringify(state), w.day, JSON.stringify({ weights: w.weights, summary, at: now() }), s.id);
  await run('INSERT INTO strategy_runs (strategy_id, user_id, kind, summary, detail, at) VALUES (?,?,?,?,?,?)', s.id, userId, kind, summary, JSON.stringify({ weights: w.weights, results }), now());
  return { ...w, results, summary };
}

// ---------- automation (called by the scheduler) ----------

const nyNow = (t = now()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: (+p.hour % 24) * 60 + +p.minute, weekend: ['Sat', 'Sun'].includes(p.weekday) };
};

// Auto strategies trade once on each rebalance day, at their run time (default 15:45 New York,
// close to the close the signals are read from).
export async function runAuto(t = now(), claim) {
  const n = nyNow(t);
  if (n.weekend) return 0;
  const rows = (await all("SELECT * FROM user_strategies WHERE mode = 'auto'")).map(parse);
  let ran = 0;
  for (const s of rows) {
    if (n.minutes < s.runAt || n.minutes > 960 || !isRebalanceDay(s.spec, n.day)) continue;
    // Ready-made strategies trade real accounts by themselves only in registered-adviser mode.
    if (s.account !== 'paper' && s.templateId && !adviserMode()) continue;
    if (!await claim(`strategy:${s.id}:${n.day}`)) continue;
    try { await execute(s, s.userId, { kind: 'auto' }); ran++; }
    catch (e) { await run('INSERT INTO strategy_runs (strategy_id, user_id, kind, summary, at) SELECT id, user_id, ?, ?, ? FROM user_strategies WHERE id = ?', 'error', e.message.slice(0, 300), now(), s.id); }
  }
  return ran;
}

// Trailing stops on what each strategy holds, checked during market hours.
export async function checkStops(t = now()) {
  const n = nyNow(t);
  if (n.weekend || n.minutes < 570 || n.minutes >= 960) return 0;
  const rows = await all("SELECT * FROM user_strategies WHERE stop_pct IS NOT NULL AND state LIKE '%holdings%'");
  let hits = 0;
  for (const raw of rows) {
    const s = parse(raw), holdings = { ...(s.state.holdings || {}) }, highs = { ...(s.state.highs || {}) };
    let changed = false;
    for (const [tk, q] of Object.entries(holdings)) {
      const px = await lastPrice(tk, raw.user_id).catch(() => null);
      if (!px) continue;
      if (px > (highs[tk] || 0)) { highs[tk] = px; changed = true; }
      if (px <= highs[tk] * (1 - s.stopPct / 100)) {
        try {
          await placeOrder(raw.user_id, s.account, { symbol: tk, side: 'sell', qty: q }, `strategy:${s.id}:stop`);
          delete holdings[tk]; delete highs[tk]; changed = true; hits++;
          await run('INSERT INTO strategy_runs (strategy_id, user_id, kind, summary, at) VALUES (?,?,?,?,?)', s.id, raw.user_id, 'stop', `Trailing stop: SELL ${q} ${tk} at about $${px.toFixed(2)} (${s.stopPct}% below its high)`, now());
        } catch (e) { console.warn('strategy stop', s.id, e.message); }
      }
    }
    if (changed) await run('UPDATE user_strategies SET state = ? WHERE id = ?', JSON.stringify({ ...s.state, holdings, highs }), s.id);
  }
  return hits;
}

// After the close: the model's return for the day from yesterday's target weights. This is the
// live, out-of-sample record that Reality Check compares with the backtest.
export async function recordDaily(t = now()) {
  const n = nyNow(t);
  if (n.weekend) return 0;
  const rows = (await all("SELECT * FROM user_strategies WHERE mode = 'auto' OR last_result IS NOT NULL")).map(parse);
  let done = 0;
  for (const s of rows) {
    try {
      const mkt = await new Market(s.userId).load(tickersOf(s.spec));
      const cal = mkt.calendar('SPY');
      const i = cal.length - 1;
      if (cal[i] !== n.day) continue; // no bar for today yet (holiday, or data not updated)
      const prev = await one('SELECT weights FROM strategy_days WHERE strategy_id = ? AND day < ? ORDER BY day DESC LIMIT 1', s.id, n.day);
      const w = J(prev?.weights) || s.lastResult?.weights || {};
      let r = 0;
      for (const [tk, wt] of Object.entries(w)) { const a = mkt.price(tk, cal[i - 1]), b = mkt.price(tk, cal[i]); if (a > 0 && b > 0) r += wt * (b / a - 1); }
      const d = decide(s.spec, mkt, { state: s.state, today: n.day });
      const nw = s.spec.kind === 'tree' && !d.complete ? w : isRebalanceDay(s.spec, n.day) ? d.weights : w;
      await run('INSERT INTO strategy_days (strategy_id, day, ret, weights) VALUES (?,?,?,?) ON CONFLICT DO UPDATE SET ret = excluded.ret, weights = excluded.weights', s.id, n.day, r, JSON.stringify(nw));
      // Reality Check verdict; tell the owner when it gets worse.
      const rc = await realityFor(s), before = s.state.reality?.status;
      await run('UPDATE user_strategies SET state = ? WHERE id = ?', JSON.stringify({ ...s.state, reality: { status: rc.status, multiplier: rc.multiplier, at: n.day } }), s.id);
      if (before && before !== rc.status && ['watch', 'drifting'].includes(rc.status))
        await notifyUser(s.userId, `Reality Check: "${s.name}" is now ${rc.status.toUpperCase()}. ${rc.why}${s.state.throttle ? ` Auto-throttle now trades ${rc.multiplier * 100}% of its money.` : ''}`);
      done++;
    } catch (e) { console.warn('strategy daily', s.id, e.message); }
  }
  return done;
}

async function notifyUser(userId, msg) {
  const u = await one('SELECT email, phone, phone_verified FROM users WHERE id = ?', userId);
  if (u?.phone && u.phone_verified) await sendSms(u.phone, msg).catch(e => console.warn('sms', e.message));
  else if (u?.email) await sendEmail(u.email, 'Brightfolio Reality Check', msg).catch(e => console.warn('email', e.message));
}

export const templatesList = () => TEMPLATES.map(t => ({ id: t.id, name: t.name, tagline: t.tagline, kind: t.kind, rebalance: t.rebalance, risk: t.risk, qc: t.qc, about: t.about, note: t.note || null }));
export { template, keyOf };
