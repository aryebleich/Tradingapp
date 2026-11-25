// The basket math (src/baskets.js) as pure functions, so the backtest runs in the CPU pool
// (src/cpu.js) and never on the request thread: data in, data out; no database, no network.
import { compile } from './engine.js';
import { roc, rsi, vol } from './ta.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const yearsAgo = n => new Date(Date.now() - n * 365 * 864e5).toISOString().slice(0, 10);

const score = (rankBy, c) => {
  const last = a => a.at(-1);
  if (rankBy === 'momentum12m') return last(roc(c, 252));
  if (rankBy === 'momentum6m') return last(roc(c, 126));
  if (rankBy === 'momentum3m') return last(roc(c, 63));
  if (rankBy === 'lowvol') { const v = vol(c, 60); return v == null ? null : -v; }
  if (rankBy === 'rsi_low') { const r = last(rsi(c, 14)); return r == null ? null : -r; }
  return 0;
};
// Target weights (summing to 1 - cash) from closes up to the decision day.
export function select(spec, closesBySymbol) {
  const pass = [];
  for (const [sym, c] of Object.entries(closesBySymbol)) {
    if (!c || c.length < 30) continue;
    if (spec.filters.trim()) { const fns = compile(spec.filters, c); if (!fns.every(f => f(c.length - 1))) continue; }
    const sc = score(spec.rankBy, c); if (sc == null || !Number.isFinite(sc)) continue;
    pass.push({ sym, score: sc, vol: vol(c, 60) || 20 });
  }
  if (spec.weighting === 'manual') {
    const keep = pass.filter(p => spec.weights[p.sym]);
    const tot = keep.reduce((a, p) => a + spec.weights[p.sym], 0);
    return Object.fromEntries(keep.map(p => [p.sym, spec.weights[p.sym] / tot * (1 - spec.cashPct / 100)]));
  }
  const top = (spec.rankBy === 'none' ? pass : pass.sort((a, b) => b.score - a.score)).slice(0, spec.topN);
  const raw = top.map((p, i) => (spec.weighting === 'invvol' ? 1 / p.vol : spec.weighting === 'rank' ? top.length - i : 1));
  const tot = raw.reduce((a, b) => a + b, 0);
  return Object.fromEntries(top.map((p, i) => [p.sym, raw[i] / tot * (1 - spec.cashPct / 100)]));
}

export const isRebalanceDay = (rebalance, prev, day) => {
  if (!prev) return true;
  if (rebalance === 'weekly') return new Date(day).getUTCDay() < new Date(prev).getUTCDay() || Date.parse(day) - Date.parse(prev) > 6 * 864e5;
  if (rebalance === 'quarterly') return Math.floor((+day.slice(5, 7) - 1) / 3) !== Math.floor((+prev.slice(5, 7) - 1) / 3) || day.slice(0, 4) !== prev.slice(0, 4);
  return day.slice(0, 7) !== prev.slice(0, 7);
};

// Backtest on loaded closes: rebalances on schedule using only data known on that day, holds between
// rebalances, charges 0.05% of each trade, compares with SPY. data: { SYMBOL: { closes, dates, source } }.
export function basketRun(spec, syms, data, years) {
  const avail = syms.filter(s => data[s]?.closes?.length > 260);
  if (!avail.length) throw bad('No price history for these symbols');
  // Common trading days across all symbols.
  const sets = avail.map(s => new Map(data[s].dates.map((d, i) => [d, data[s].closes[i]])));
  const days = data[avail[0]].dates.filter(d => sets.every(m => m.has(d)));
  const start = days.findIndex(d => d >= yearsAgo(years)), w0 = Math.max(260, start);
  if (days.length - w0 < 120) throw bad('Not enough overlapping history');
  const px = (s, i) => sets[avail.indexOf(s)].get(days[i]);
  let eq = 1, hold = {}, prev = null, turnover = 0, rebalances = 0, peak = 1, dd = 0;
  const curve = [], spy = data.SPY ? new Map(data.SPY.dates.map((d, i) => [d, data.SPY.closes[i]])) : null, spy0 = spy?.get(days[w0]);
  const rets = [], picks = [];
  for (let i = w0; i < days.length; i++) {
    if (i > w0) { // drift with prices
      let r = 0; for (const [s, w] of Object.entries(hold)) r += w * (px(s, i) / px(s, i - 1) - 1);
      eq *= 1 + r; rets.push(r);
      const tot = Object.entries(hold).reduce((a, [s, w]) => a + w * px(s, i) / px(s, i - 1), 0) + (1 - Object.values(hold).reduce((a, b) => a + b, 0));
      hold = Object.fromEntries(Object.entries(hold).map(([s, w]) => [s, w * px(s, i) / px(s, i - 1) / tot]));
    }
    if (isRebalanceDay(spec.rebalance, prev, days[i])) {
      const closes = Object.fromEntries(avail.map(s => [s, data[s].closes.slice(0, data[s].dates.indexOf(days[i]) + 1)]));
      const target = select(spec, closes);
      const t = [...new Set([...Object.keys(hold), ...Object.keys(target)])].reduce((a, s) => a + Math.abs((target[s] || 0) - (hold[s] || 0)), 0);
      eq *= 1 - t * 0.0005; turnover += t; rebalances++; hold = target; prev = days[i];
      if (picks.length < 400) picks.push({ day: days[i], holdings: Object.keys(target) });
    }
    peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
    if ((i - w0) % 5 === 0 || i === days.length - 1) curve.push({ d: days[i], eq: +eq.toFixed(4), spy: spy && spy0 ? +(spy.get(days[i]) / spy0).toFixed(4) : null });
  }
  const yrs = (days.length - w0) / 252, m = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, rets.length - 1));
  const spyEnd = curve.at(-1)?.spy;
  return {
    curve, picks: picks.slice(-24), from: days[w0], to: days.at(-1), symbolsUsed: avail.length, dataSource: data[avail[0]].source,
    stats: {
      totalReturn: +((eq - 1) * 100).toFixed(1), cagr: +((eq ** (1 / yrs) - 1) * 100).toFixed(1), maxDrawdown: +(dd * 100).toFixed(1),
      sharpe: sd ? +(m / sd * Math.sqrt(252)).toFixed(2) : null, volatility: +(sd * Math.sqrt(252) * 100).toFixed(1),
      spyCagr: spyEnd ? +((spyEnd ** (1 / yrs) - 1) * 100).toFixed(1) : null, rebalances, avgTurnover: +(turnover / rebalances * 100).toFixed(0),
    },
  };
}

