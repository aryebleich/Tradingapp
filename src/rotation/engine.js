// Runs the sheet strategies: the daily walkdown (with optional typed-in values, like the sheet's
// yellow cells), target weights, order sizing, stop suggestions, and a day-by-day backtest.
import { getBars } from '../brokers.js';
import { series, warmup, dailyVol, suggestedStop } from './indicators.js';
import { metricLabel } from './templates.js';
import { metrics } from '../engine.js';

// ---------- market data ----------

const START = `${new Date().getUTCFullYear() - 6}-01-01`;
const keyOf = m => m.join('|');

// Loads daily closes once per ticker and computes indicator series on demand. In a backtest,
// `at` moves through the calendar of the first ticker loaded with the longest history (SPY).
export class Market {
  constructor(userId) { this.userId = userId; this.bars = new Map(); this.cache = new Map(); this.failed = new Map(); }
  async load(tickers) {
    const todo = [...new Set(tickers)].filter(t => !this.bars.has(t) && !this.failed.has(t));
    for (let i = 0; i < todo.length; i += 6) {
      await Promise.all(todo.slice(i, i + 6).map(async t => {
        try {
          const b = await getBars(t, START, this.userId);
          this.bars.set(t, { closes: b.closes, dates: b.dates, index: new Map(b.dates.map((d, j) => [d, j])), source: b.source });
        } catch (e) { this.failed.set(t, e.message); }
      }));
    }
    return this;
  }
  has(t) { return this.bars.has(t); }
  closes(t) { return this.bars.get(t)?.closes || []; }
  // Index of the last bar on or before `date` (undefined = latest bar).
  idx(t, date) {
    const b = this.bars.get(t);
    if (!b) return -1;
    if (!date) return b.closes.length - 1;
    const i = b.index.get(date);
    if (i !== undefined) return i;
    let lo = 0, hi = b.dates.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (b.dates[mid] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }
  value(m, date) {
    if (typeof m === 'number') return m;
    const [fn, t, n] = m;
    const b = this.bars.get(t);
    if (!b) return NaN;
    const k = keyOf(m);
    if (!this.cache.has(k)) this.cache.set(k, series(fn, b.closes, n));
    const i = this.idx(t, date);
    return i < 0 ? NaN : this.cache.get(k)[i];
  }
  price(t, date) { const i = this.idx(t, date); return i < 0 ? NaN : this.closes(t)[i]; }
  calendar(t = 'SPY') { return this.bars.get(t)?.dates || [...this.bars.values()][0]?.dates || []; }
}

// ---------- tree walk ----------

const OPS = { '>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b };
const fmt = v => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(2)) : '-');
const where = to => (!to ? '-' : to.startsWith('@') ? `BUY ${to.slice(1)}` : `step ${to}`);

export function tickersOf(spec) {
  const out = new Set();
  const add = m => { if (Array.isArray(m)) out.add(m[1]); };
  const leaf = to => { if (typeof to === 'string' && to.startsWith('@')) out.add(to.slice(1)); };
  for (const sl of spec.sleeves || []) for (const s of sl.steps) {
    add(s.a); add(s.b); (s.conds || []).forEach(c => { add(c.a); add(c.b); });
    [s.yes, s.no, s.hiTo, s.loTo, s.mid, s.aTo, s.bTo].forEach(leaf);
  }
  if (spec.params?.universe) spec.params.universe.forEach(t => out.add(t));
  if (spec.params?.assets) spec.params.assets.forEach(t => out.add(t));
  if (spec.kind !== 'tree') out.add('SPY');
  return [...out];
}

// One sleeve's walk. `val(m)` returns a number; overrides (typed values) are applied by the caller.
function walk(sleeve, val) {
  const steps = new Map(sleeve.steps.map(s => [s.id, s]));
  const path = [];
  let cur = sleeve.steps[0]?.id;
  for (let guard = 0; guard < 300 && cur; guard++) {
    if (cur.startsWith('@')) return { path, ticker: cur.slice(1) };
    const s = steps.get(cur);
    if (!s) return { path, missing: cur, error: `Step ${cur} does not exist` };
    const row = { id: s.id, t: s.t, label: s.label || (s.t === 'vote' ? 'Vote' : `${metricLabel(s.a)}${s.b !== undefined && s.t !== 'band' ? ' vs ' + metricLabel(s.b) : ''}`), rebuilt: !!s.rebuilt };
    if (s.t === 'missing') { row.va = val(s.a); row.vb = s.b === undefined ? undefined : val(s.b); row.decision = 'Needs a rule (not in the sheet export)'; path.push(row); return { path, missing: s.id }; }
    let next;
    if (s.t === 'cmp') {
      const a = val(s.a), b = val(s.b);
      Object.assign(row, { va: a, vb: typeof s.b === 'number' ? undefined : b, rule: `${metricLabel(s.a)} ${s.op} ${metricLabel(s.b)}` });
      if (!Number.isFinite(a) || !Number.isFinite(b)) { row.decision = 'Waiting for data'; path.push(row); return { path, missing: s.id, error: `No data for ${row.label}` }; }
      next = OPS[s.op](a, b) ? s.yes : s.no;
      row.decision = `${fmt(a)} ${OPS[s.op](a, b) ? s.op : 'not ' + s.op} ${typeof s.b === 'number' ? s.b : fmt(b)} → ${where(next)}`;
    } else if (s.t === 'band') {
      const a = val(s.a);
      Object.assign(row, { va: a, rule: [s.hi != null && `> ${s.hi} → ${where(s.hiTo)}`, s.lo != null && `< ${s.lo} → ${where(s.loTo)}`, `otherwise → ${where(s.mid)}`].filter(Boolean).join(' · ') });
      if (!Number.isFinite(a)) { row.decision = 'Waiting for data'; path.push(row); return { path, missing: s.id, error: `No data for ${row.label}` }; }
      next = s.hi != null && a > s.hi ? s.hiTo : s.lo != null && a < s.lo ? s.loTo : s.mid;
      row.decision = `${fmt(a)} → ${where(next)}`;
    } else if (s.t === 'higher') {
      const a = val(s.a), b = val(s.b);
      Object.assign(row, { va: a, vb: b, rule: `higher of ${metricLabel(s.a)} and ${metricLabel(s.b)}` });
      if (!Number.isFinite(a) || !Number.isFinite(b)) { row.decision = 'Waiting for data'; path.push(row); return { path, missing: s.id, error: `No data for ${row.label}` }; }
      next = a >= b ? s.aTo : s.bTo;
      row.decision = `${fmt(a)} vs ${fmt(b)} → ${where(next)}`;
    } else if (s.t === 'vote') {
      const votes = s.conds.map(c => { const a = val(c.a), b = val(c.b); return { label: `${metricLabel(c.a)} ${c.op} ${metricLabel(c.b)}`, va: a, vb: b, ok: Number.isFinite(a) && Number.isFinite(b) && OPS[c.op](a, b) }; });
      const n = votes.filter(v => v.ok).length;
      next = n >= s.need ? s.yes : s.no;
      Object.assign(row, { votes, rule: `${s.need} of ${votes.length} → ${where(s.yes)}, else ${where(s.no)}`, decision: `${n} of ${votes.length} votes → ${where(next)}` });
    } else return { path, missing: s.id, error: `Unknown step type "${s.t}"` };
    row.next = next;
    path.push(row);
    cur = next;
  }
  return { path, missing: cur, error: 'The steps loop back on themselves' };
}

// ---------- the four strategy kinds ----------

// `opts.overrides` maps "fn|TICKER|n" to a typed value (manual mode); `opts.date` evaluates on a past day.
export function decide(spec, mkt, opts = {}) {
  const ov = opts.overrides || {}, date = opts.date;
  const val = m => (typeof m === 'number' ? m : ov[keyOf(m)] !== undefined && ov[keyOf(m)] !== '' ? +ov[keyOf(m)] : mkt.value(m, date));
  const p = spec.params || {};
  if (spec.kind === 'tree') {
    const weights = {}, sleeves = [];
    for (const sl of spec.sleeves) {
      const r = walk(sl, val);
      sleeves.push({ name: sl.name, weight: sl.weight, ...r });
      if (r.ticker) weights[r.ticker] = (weights[r.ticker] || 0) + sl.weight;
    }
    return { weights, sleeves, complete: sleeves.every(s => s.ticker) };
  }
  if (spec.kind === 'momentum') {
    const rows = p.universe.map(t => ({ ticker: t, score: val(['ret', t, p.lookback]) })).filter(r => Number.isFinite(r.score)).sort((a, b) => b.score - a.score);
    const pick = rows.slice(0, p.top || 1);
    return { weights: Object.fromEntries(pick.map(r => [r.ticker, 1 / pick.length])), ranking: rows, complete: pick.length > 0 };
  }
  if (spec.kind === 'pullback') {
    const held = opts.state?.held || {}, day = date || opts.today;
    const rows = p.universe.map(t => {
      const c = val(['close', t, 0]), s200 = val(['sma', t, 200]), sN = val(['sma', t, p.bbLen]), sd = val(['pstdev', t, p.bbLen]), r = val(['rsi', t, p.rsiLen]), hi = val(['high', t, p.highLen]);
      const z = (c - sN) / sd, pull = (c / hi - 1) * 100;
      const checks = { uptrend: c > s200, belowBand: c < sN - p.bbMult * sd, rsi: r <= p.rsiEntry, pullback: pull <= -p.minPullback };
      return { ticker: t, close: c, sma200: s200, smaN: sN, z, rsi: r, pullback: pull, checks, entry: [c, s200, sN, sd, r, hi].every(Number.isFinite) && Object.values(checks).every(Boolean) };
    });
    // Exits for what this strategy holds: back to the 15-day average, trend broken, or held too long.
    const keep = [], exits = [];
    for (const [t, since] of Object.entries(held)) {
      const r = rows.find(x => x.ticker === t) || { close: val(['close', t, 0]), smaN: val(['sma', t, p.bbLen]), sma200: val(['sma', t, 200]) };
      const days = tradingDaysBetween(since, day);
      const why = r.close >= r.smaN ? 'back to the 15-day average' : r.close < r.sma200 ? 'below the 200-day average' : days >= p.maxHoldDays ? `held ${days} days` : null;
      (why ? exits : keep).push({ ticker: t, why, days });
    }
    const entries = rows.filter(r => r.entry && !held[r.ticker]).sort((a, b) => a.z - b.z || a.rsi - b.rsi);
    const buys = entries.slice(0, Math.max(0, p.maxPositions - keep.length));
    const hold = [...keep.map(k => k.ticker), ...buys.map(b => b.ticker)];
    return { weights: Object.fromEntries(hold.map(t => [t, 1 / hold.length])), candidates: rows, entries, buys: buys.map(b => b.ticker), exits, keep, complete: true };
  }
  if (spec.kind === 'macro') {
    const preds = Object.fromEntries(p.assets.map(t => [t, p.source === 'auto' ? val(['ret', t, p.proxyDays]) / (p.proxyDays / 21) : +(p.predictions?.[t] ?? NaN)]));
    const pos = Object.entries(preds).filter(([, v]) => Number.isFinite(v) && v > 0);
    const sum = pos.reduce((a, [, v]) => a + v, 0), max = (p.maxTotal ?? 100) / 100, cap = (p.btcCap ?? 10) / 100;
    let w = Object.fromEntries(pos.map(([t, v]) => [t, (v / sum) * max]));
    // Bitcoin above its cap: cut it to the cap, re-scale the others to the full total, then normalise to the maximum.
    if (p.btc && w[p.btc] > cap) {
      const others = Object.keys(w).filter(t => t !== p.btc), oSum = others.reduce((a, t) => a + w[t], 0);
      others.forEach(t => (w[t] = oSum ? (w[t] / oSum) * max : 0));
      w[p.btc] = cap;
      const tot = Object.values(w).reduce((a, b) => a + b, 0);
      if (tot > max) w = Object.fromEntries(Object.entries(w).map(([t, v]) => [t, (v / tot) * max]));
    }
    return { weights: w, predictions: preds, complete: Object.values(preds).every(Number.isFinite) };
  }
  throw new Error(`Unknown strategy kind "${spec.kind}"`);
}

const tradingDaysBetween = (a, b) => {
  if (!a || !b) return 0;
  let n = 0; const d = new Date(a + 'T12:00:00Z'), end = new Date(b + 'T12:00:00Z');
  while (d < end) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6) n++; }
  return n;
};

// Is today a trading day for this strategy? (weekly: its weekday; monthly: first trading day)
export function isRebalanceDay(spec, day) {
  const d = new Date(day + 'T12:00:00Z'), wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  if (spec.rebalance === 'weekly') return wd === (spec.weekday ?? 3);
  if (spec.rebalance === 'monthly') { const p = new Date(d); do p.setUTCDate(p.getUTCDate() - 1); while (p.getUTCDay() === 0 || p.getUTCDay() === 6); return p.getUTCMonth() !== d.getUTCMonth(); }
  return true;
}

// ---------- sizing ----------

// Shares to buy for each target, from the strategy's capital. Whole shares by default, like the sheet.
export function sizeOrders(weights, capital, priceOf, { whole = true, holdings = {} } = {}) {
  const tickers = [...new Set([...Object.keys(weights), ...Object.keys(holdings)])];
  return tickers.map(t => {
    const w = weights[t] || 0, price = priceOf(t), dollars = capital * w;
    let shares = Number.isFinite(price) && price > 0 ? dollars / price : 0;
    shares = whole ? Math.floor(shares) : +shares.toFixed(4);
    const have = holdings[t] || 0, delta = +(shares - have).toFixed(4);
    return { ticker: t, weight: w, dollars, price, shares, have, delta, action: delta > 0 ? 'BUY' : delta < 0 ? 'SELL' : 'HOLD' };
  }).sort((a, b) => b.weight - a.weight);
}

export const stopsFor = (tickers, mkt) => Object.fromEntries(tickers.map(t => { const v = dailyVol(mkt.closes(t)); return [t, { vol: Number.isFinite(v) ? +v.toFixed(2) : null, stopPct: suggestedStop(v) }]; }));

// ---------- backtest ----------

// Decides at each close and earns the next day's return; `costBps` per unit of turnover.
export function backtest(spec, mkt, { years = 5, costBps = 5 } = {}) {
  const cal = mkt.calendar('SPY');
  if (cal.length < 300) throw new Error('Not enough price history to backtest');
  // Start once every ticker the rules read has enough history (trees), or after a year (lists).
  const firstIdx = t => (mkt.has(t) ? Math.max(0, mkt.idx('SPY', mkt.calendar(t)[0])) : 0);
  const need = spec.kind === 'tree' ? Math.max(0, ...tickersOf(spec).map(firstIdx)) + 210 : 260;
  let from = Math.max(need, cal.length - Math.round(years * 252) - 1);
  if (from >= cal.length - 30) throw new Error('Not enough overlapping history for these tickers');
  const eq = [10000], bh = [10000], dates = [cal[from]], hist = [];
  let w = {}, state = { held: {} };
  const spy0 = mkt.price('SPY', cal[from]);
  for (let i = from; i < cal.length - 1; i++) {
    const day = cal[i], next = cal[i + 1];
    if (isRebalanceDay(spec, day) || i === from) {
      let d;
      try { d = decide(spec, mkt, { date: day, state, today: day }); } catch { d = { weights: w }; }
      if (spec.kind === 'pullback') {
        const held = {};
        for (const t of Object.keys(d.weights)) held[t] = state.held[t] || day;
        state = { held };
      }
      const nw = d.complete === false && spec.kind === 'tree' ? w : d.weights;
      const turnover = [...new Set([...Object.keys(w), ...Object.keys(nw)])].reduce((a, t) => a + Math.abs((nw[t] || 0) - (w[t] || 0)), 0);
      eq[eq.length - 1] *= 1 - turnover * costBps / 1e4;
      if (JSON.stringify(nw) !== JSON.stringify(w)) hist.push({ day, weights: nw });
      w = nw;
    }
    let r = 0;
    for (const [t, wt] of Object.entries(w)) {
      const a = mkt.price(t, day), b = mkt.price(t, next);
      if (Number.isFinite(a) && Number.isFinite(b) && a > 0) r += wt * (b / a - 1);
    }
    eq.push(eq[eq.length - 1] * (1 + r));
    bh.push(10000 * mkt.price('SPY', next) / spy0);
    dates.push(next);
  }
  const step = Math.max(1, Math.floor(eq.length / 300));
  const daily = eq.slice(1).map((v, i) => v / eq[i] - 1);
  return {
    m: metrics(eq), bh: metrics(bh), from: dates[0], to: dates[dates.length - 1], days: eq.length - 1, switches: hist.length,
    curve: eq.filter((_, i) => i % step === 0 || i === eq.length - 1), bhCurve: bh.filter((_, i) => i % step === 0 || i === bh.length - 1),
    dates: dates.filter((_, i) => i % step === 0 || i === dates.length - 1), lastSwitches: hist.slice(-12).reverse(),
    dailyStats: { mean: daily.reduce((a, b) => a + b, 0) / (daily.length || 1), sd: Math.sqrt(daily.reduce((a, b) => a + b * b, 0) / (daily.length || 1) - (daily.reduce((a, b) => a + b, 0) / (daily.length || 1)) ** 2) },
    sources: [...new Set([...mkt.bars.values()].map(b => b.source))],
  };
}

export { keyOf };
