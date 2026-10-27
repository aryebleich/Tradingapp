// Statistical arbitrage on a basket of related stocks (the multi-stock big brother of pairs trading).
//
//   matrix    every pair in the basket: correlation of daily returns, Engle-Granger cointegration
//             t-statistic, half-life and today's z-score of the gap, for a live heat map
//   s-scores  each stock's daily return is split into the basket's common move (beta x the
//             equal-weight basket return) and its own residual; the summed residual is fitted as a
//             mean-reverting (Ornstein-Uhlenbeck) process, and the s-score says how far it is from
//             its own normal level in standard deviations (Avellaneda and Lee, 2010)
//   signals   s < -entry: buy (cheap against the basket), s > entry: sell short (rich), close inside exit
//   backtest  re-fitted daily on the past `window` days only, equal money per position, costs included
//
// Plans limit how many stocks a basket holds and how often the live view refreshes.
import express from 'express';
import { getBars, lastPrice, validSymbol } from './brokers.js';
import { requireUser, rateLimit } from './auth.js';
import { metrics } from './engine.js';
import { PAID } from './fees.js';

export const BASKETS = {
  'Banks': ['JPM', 'BAC', 'WFC', 'C', 'GS', 'MS'],
  'Energy': ['XOM', 'CVX', 'COP', 'EOG', 'SLB', 'OXY'],
  'Semiconductors': ['NVDA', 'AMD', 'AVGO', 'QCOM', 'TXN', 'MU'],
  'Consumer staples': ['KO', 'PEP', 'PG', 'CL', 'KMB', 'MDLZ'],
  'Big tech': ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA'],
  'Payments': ['V', 'MA', 'AXP', 'PYPL', 'FI', 'GPN'],
  'Utilities': ['DUK', 'SO', 'NEE', 'D', 'AEP', 'XEL'],
  'Bond ETFs': ['TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'JNK'],
};
// Stocks per basket and live refresh (seconds, 0 = refresh by hand) by plan.
export const LIMITS = { free: { symbols: 6, refresh: 0 }, pro: { symbols: 15, refresh: 60 }, elite: { symbols: 30, refresh: 30 }, ultimate: { symbols: 50, refresh: 15 } };
export const limitsFor = u => LIMITS[u?.role === 'admin' && !u.previewPlan ? 'ultimate' : PAID.includes(u?.plan) && ['active', 'trialing', null, undefined].includes(u?.plan_status) ? u.plan : 'free'];
export const DEFAULTS = { window: 60, entry: 1.25, exit: 0.5, costBps: 5 };
// Engle-Granger 5% critical value (2 variables, constant).
const CRIT5 = -3.34;

const mean = x => x.reduce((a, b) => a + b, 0) / x.length;
function ols(y, x) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const beta = sxx ? sxy / sxx : 0, alpha = my - beta * mx;
  return { alpha, beta, res: y.map((v, i) => v - alpha - beta * x[i]) };
}
function corr(a, b) {
  const ma = mean(a), mb = mean(b); let s = 0, va = 0, vb = 0;
  for (let i = 0; i < a.length; i++) { s += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
  return va && vb ? s / Math.sqrt(va * vb) : 0;
}
// Dickey-Fuller t-statistic of a spread and its half-life in days.
function adf(s) {
  const y = s.slice(1).map((v, i) => v - s[i]), x = s.slice(0, -1);
  const { beta: g, res } = ols(y, x);
  const mx = mean(x), sxx = x.reduce((a, v) => a + (v - mx) ** 2, 0);
  const se = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / Math.max(1, res.length - 2) / (sxx || 1));
  return { t: se ? g / se : 0, halfLife: g < 0 ? -Math.log(2) / Math.log(1 + g) : Infinity };
}

// Aligns closes on the dates every symbol traded.
export function align(series) {
  const syms = Object.keys(series), common = syms.reduce((set, s, i) => {
    const d = new Set(series[s].dates);
    return i === 0 ? d : new Set([...set].filter(x => d.has(x)));
  }, null);
  const dates = series[syms[0]].dates.filter(d => common.has(d));
  const px = Object.fromEntries(syms.map(s => { const m = new Map(series[s].dates.map((d, i) => [d, series[s].closes[i]])); return [s, dates.map(d => m.get(d))]; }));
  return { dates, px, syms };
}

// Pair matrix over the last `lookback` days.
export function pairMatrix({ px, syms }, { lookback = 252, zWindow = 60 } = {}) {
  const n = px[syms[0]].length, L = Math.min(lookback, n - 1);
  const logs = Object.fromEntries(syms.map(s => [s, px[s].slice(n - L).map(Math.log)]));
  const rets = Object.fromEntries(syms.map(s => [s, logs[s].slice(1).map((v, i) => v - logs[s][i])]));
  const cells = [];
  for (let i = 0; i < syms.length; i++) for (let j = i + 1; j < syms.length; j++) {
    const a = syms[i], b = syms[j], { res } = ols(logs[a], logs[b]), df = adf(res);
    const w = res.slice(-zWindow), m = mean(w), sd = Math.sqrt(mean(w.map(v => (v - m) ** 2)));
    cells.push({ a, b, correlation: +corr(rets[a], rets[b]).toFixed(3), adf: +df.t.toFixed(2), cointegrated: df.t < CRIT5, halfLife: Number.isFinite(df.halfLife) ? +df.halfLife.toFixed(1) : null, z: sd ? +((res[res.length - 1] - m) / sd).toFixed(2) : 0 });
  }
  return cells;
}

// s-score of every stock on the last `window` days of returns against the equal-weight basket.
export function sScores(px, syms, end, o = DEFAULTS) {
  const W = o.window, ret = s => { const p = px[s], out = []; for (let t = end - W + 1; t <= end; t++) out.push(p[t] / p[t - 1] - 1); return out; };
  const R = Object.fromEntries(syms.map(s => [s, ret(s)])), mkt = R[syms[0]].map((_, t) => mean(syms.map(s => R[s][t])));
  return syms.map(s => {
    const { beta, res } = ols(R[s], mkt);
    const X = []; res.reduce((acc, e) => (X.push(acc + e), acc + e), 0);
    // AR(1) on the summed residual: X[t+1] = a + b X[t] + e  →  mean a/(1-b), spread sd(e)/sqrt(1-b²)
    const fit = ols(X.slice(1), X.slice(0, -1)), b = fit.beta, a = fit.alpha;
    if (!(b > 0 && b < 1)) return { symbol: s, beta: +beta.toFixed(2), s: 0, halfLife: null, meanReverting: false };
    const sdE = Math.sqrt(mean(fit.res.map(v => v * v))), sdEq = sdE / Math.sqrt(1 - b * b), m = a / (1 - b);
    const score = sdEq ? (X[X.length - 1] - m) / sdEq : 0, kappa = -Math.log(b) * 252;
    return { symbol: s, beta: +beta.toFixed(2), s: +score.toFixed(2), halfLife: +(Math.log(2) / -Math.log(b)).toFixed(1), meanReverting: kappa > 252 / (W / 2), };
  });
}
export const signalOf = (s, o = DEFAULTS) => (s < -o.entry ? 'buy' : s > o.entry ? 'sell' : Math.abs(s) < o.exit ? 'flat' : 'hold');

// Walk-forward backtest: positions from yesterday's s-scores earn today's return.
export function backtest({ px, syms, dates }, o = DEFAULTS) {
  const n = dates.length, start = Math.max(o.window + 1, n - 3 * 252);
  const pos = Object.fromEntries(syms.map(s => [s, 0]));
  const eq = [1]; let trades = 0;
  for (let t = start; t < n - 1; t++) {
    for (const x of sScores(px, syms, t, o)) {
      const p = pos[x.symbol], want = !x.meanReverting ? 0 : p === 0 ? (x.s < -o.entry ? 1 : x.s > o.entry ? -1 : 0) : (Math.abs(x.s) < o.exit || Math.sign(x.s) === p ? 0 : p);
      if (want !== p) { trades++; pos[x.symbol] = want; eq[eq.length - 1] *= 1 - o.costBps / 1e4 / syms.length; }
    }
    const open = syms.filter(s => pos[s]);
    const r = open.length ? mean(open.map(s => pos[s] * (px[s][t + 1] / px[s][t] - 1))) : 0;
    eq.push(eq[eq.length - 1] * (1 + r));
  }
  const step = Math.max(1, Math.floor(eq.length / 250));
  return { from: dates[start], to: dates[n - 1], trades, m: metrics(eq), curve: eq.filter((_, i) => i % step === 0).map(v => v * 10000) };
}

async function loadBasket(syms, userId, live) {
  const start = `${new Date().getUTCFullYear() - 4}-01-01`;
  const series = {};
  await Promise.all(syms.map(async s => { series[s] = await getBars(s, start, userId); }));
  const data = align(series);
  if (data.dates.length < 200) throw Object.assign(new Error(`These stocks share only ${data.dates.length} trading days of history`), { status: 400 });
  // Live view: today's latest price stands in for today's close.
  if (live) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const quotes = await Promise.all(syms.map(s => lastPrice(s, userId).catch(() => null)));
    if (quotes.every(q => q > 0)) {
      if (data.dates[data.dates.length - 1] === today) syms.forEach((s, i) => { data.px[s][data.px[s].length - 1] = quotes[i]; });
      else { data.dates.push(today); syms.forEach((s, i) => data.px[s].push(quotes[i])); }
    }
  }
  return { ...data, source: [...new Set(Object.values(series).map(b => b.source))] };
}

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
function parse(b, user) {
  const lim = limitsFor(user);
  const syms = [...new Set((Array.isArray(b.symbols) ? b.symbols : String(b.symbols || '').split(/[\s,]+/)).map(s => String(s).trim().toUpperCase()).filter(Boolean))];
  if (syms.length < 3) throw bad('Add at least 3 stocks');
  for (const s of syms) if (!validSymbol(s)) throw bad(`"${s}" is not a valid ticker`);
  if (syms.length > lim.symbols) throw Object.assign(bad(`Your plan analyzes up to ${lim.symbols} stocks at once`), { status: 402, upgrade: true, feature: 'Bigger stat-arb baskets' });
  const o = { ...DEFAULTS };
  for (const [k, lo, hi] of [['window', 20, 250], ['entry', 0.5, 4], ['exit', 0, 3]]) if (b[k] !== undefined && b[k] !== '') { const v = +b[k]; if (!(v >= lo && v <= hi)) throw bad(`${k} must be between ${lo} and ${hi}`); o[k] = v; }
  if (o.exit >= o.entry) throw bad('The exit level must be below the entry level');
  return { syms, o, lim };
}

export const statArbRouter = express.Router();
statArbRouter.use(requireUser);
statArbRouter.get('/baskets', (req, res) => res.json({ baskets: BASKETS, limits: limitsFor(req.user), plans: LIMITS, defaults: DEFAULTS }));
// The whole analysis: pair matrix, s-scores with signals and the walk-forward backtest.
statArbRouter.post('/analyze', async (req, res) => {
  const { syms, o, lim } = parse(req.body, req.user);
  if (!rateLimit('statarb:' + req.user.id, lim.refresh ? Math.ceil(3600 / lim.refresh) + 60 : 60, 3600e3)) throw bad('Too many refreshes this hour', 429);
  const d = await loadBasket(syms, req.user.id, true);
  const scores = sScores(d.px, syms, d.dates.length - 1, o).map(x => ({ ...x, signal: x.meanReverting ? signalOf(x.s, o) : 'flat' }));
  res.json({ symbols: syms, params: o, asOf: d.dates[d.dates.length - 1], matrix: pairMatrix(d), scores, backtest: req.body.live ? null : backtest(d, o), refresh: lim.refresh, source: d.source });
});
