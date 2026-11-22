// Order-flow imbalance (OFI) lab: the math of research/hf-ofi/R/ofi.R in plain JavaScript, used by
// the app page (in the browser) and the server (src/hfofi.js re-exports this file). It must match R
// to 6 decimal places on the sample data (test/hfofi.test.js checks it against R's own output).
// Simulation only: nothing here places orders.
//
// A tick: { t (ms), last, bid, ask, bidVol, askVol, volume, turnover }. Missing values are null,
// the way R's NA flows through lag() and comparisons.

export const COLUMNS = ['datetime', 'last', 'bid', 'ask', 'bid_vol', 'ask_vol', 'volume', 'turnover'];
const ALIASES = { UpdateTime: 'datetime', time: 'datetime', LastPrice: 'last', BidPrice1: 'bid', AskPrice1: 'ask', BidVolume1: 'bid_vol', AskVolume1: 'ask_vol', Volume: 'volume', Turnover: 'turnover' };
export const MAX_BYTES = 20 * 1024 * 1024, MAX_ROWS = 400000;
const fin = x => x != null && Number.isFinite(x);

// ---------- input ----------
// CSV text (for example write.csv of the RDS file) → ticks. Throws a plain message on bad input.
export function parseTicks(text, { bytes = text?.length ?? 0 } = {}) {
  if (bytes > MAX_BYTES) throw new Error(`The file is too big: at most 20 MB (this one is ${(bytes / 1048576).toFixed(1)} MB).`);
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 3) throw new Error('The file has no rows of data.');
  if (lines.length - 1 > MAX_ROWS) throw new Error(`Too many rows: at most ${MAX_ROWS.toLocaleString('en-US')}.`);
  const split = l => l.split(',').map(x => x.trim().replace(/^"(.*)"$/, '$1'));
  const head = split(lines[0]).map(h => ALIASES[h] || h);
  const miss = COLUMNS.filter(c => !head.includes(c));
  if (miss.length) throw new Error(`The file is missing columns: ${miss.join(', ')}. Needed: ${COLUMNS.join(', ')}.`);
  const at = Object.fromEntries(COLUMNS.map(c => [c, head.indexOf(c)]));
  const num = v => (v === '' || v === 'NA' ? null : +v);
  return lines.slice(1).map((l, i) => {
    const r = split(l), dt = r[at.datetime] || '';
    const t = Date.parse(dt.replace(' ', 'T').replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
    const tick = { t: Number.isFinite(t) ? t : i, last: num(r[at.last]), bid: num(r[at.bid]), ask: num(r[at.ask]), bidVol: num(r[at.bid_vol]), askVol: num(r[at.ask_vol]), volume: num(r[at.volume]), turnover: num(r[at.turnover]) };
    for (const k of ['bid', 'ask', 'bidVol', 'askVol']) if (tick[k] != null && !Number.isFinite(tick[k])) throw new Error(`Row ${i + 2}: "${r[at[{ bidVol: 'bid_vol', askVol: 'ask_vol' }[k] || k]]}" is not a number.`);
    return tick;
  });
}

// ---------- factors ----------
export const spread = q => q.ask - q.bid;
export const mid = q => (q.bid + q.ask) / 2;
export const microprice = q => (q.bid * q.askVol + q.ask * q.bidVol) / (q.bidVol + q.askVol);
export const imbalance = q => (q.bidVol - q.askVol) / (q.bidVol + q.askVol);
// VOI (Shen 2015): ΔVbid − ΔVask. null for the first update (no previous quote).
export function voi(p, q) {
  if (!p) return null;
  const dvb = q.bid > p.bid ? q.bidVol : q.bid === p.bid ? q.bidVol - p.bidVol : 0;
  const dva = q.ask < p.ask ? q.askVol : q.ask === p.ask ? q.askVol - p.askVol : 0;
  return dvb - dva;
}
// OFI (Cont, Kukanov and Stoikov 2014): the contribution e of one update.
export function ofi(p, q) {
  if (!p) return null;
  return (q.bid >= p.bid ? q.bidVol : 0) - (q.bid <= p.bid ? p.bidVol : 0) - (q.ask <= p.ask ? q.askVol : 0) + (q.ask >= p.ask ? p.askVol : 0);
}
// Right-aligned rolling sum over n values (null until n values exist, or when one is missing).
export function rollSum(xs, n) {
  const out = new Array(xs.length).fill(null);
  for (let i = n - 1; i < xs.length; i++) { let s = 0, ok = true; for (let k = i - n + 1; k <= i; k++) { if (!fin(xs[k])) { ok = false; break; } s += xs[k]; } out[i] = ok ? s : null; }
  return out;
}
const lagDiff = (xs, n) => xs.map((x, i) => (i >= n && fin(x) && fin(xs[i - n]) ? x - xs[i - n] : null));
// Every factor as columns, like R's factors().
export function factors(ticks, n = 10) {
  const f = { t: ticks.map(q => q.t), spread: ticks.map(spread), mid: ticks.map(mid), micro: ticks.map(microprice), imbalance: ticks.map(imbalance), bid: ticks.map(q => q.bid), ask: ticks.map(q => q.ask) };
  f.micro_dev = f.micro.map((m, i) => m - f.mid[i]);
  f.voi = ticks.map((q, i) => voi(ticks[i - 1], q));
  f.ofi = ticks.map((q, i) => ofi(ticks[i - 1], q));
  f.ofi_n = rollSum(f.ofi, n);
  f.d_imbalance = lagDiff(f.imbalance, n);
  f.d_micro_dev = lagDiff(f.micro_dev, n);
  return f;
}
export const FACTOR_NAMES = ['spread', 'imbalance', 'micro_dev', 'voi', 'ofi', 'ofi_n', 'd_imbalance', 'd_micro_dev'];

// ---------- regression ----------
// Future mid change over h updates on one factor: OLS slope, its t-statistic and R² (as R's lm).
export function regress(f, factor, h) {
  const xs = [], ys = [];
  for (let i = 0; i + h < f.mid.length; i++) { const x = f[factor][i], y = f.mid[i + h] - f.mid[i]; if (fin(x) && fin(y)) { xs.push(x); ys.push(y); } }
  const n = xs.length; if (n < 3) return { factor, horizon: h, n, beta: null, t: null, r2: null };
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0; for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  if (sxx === 0) return { factor, horizon: h, n, beta: null, t: null, r2: null };
  const beta = sxy / sxx, sse = Math.max(0, syy - beta * sxy), se = Math.sqrt(sse / (n - 2) / sxx);
  return { factor, horizon: h, n, beta, t: se > 0 ? beta / se : null, r2: syy > 0 ? 1 - sse / syy : null };
}
export const regressions = (f, horizons = [1, 5, 10, 20], names = FACTOR_NAMES) => names.flatMap(k => horizons.map(h => regress(f, k, h)));

// ---------- percentiles ----------
// R's default quantile (type 7) of the finite values.
export function quantile7(xs, p) {
  const v = xs.filter(fin).sort((a, b) => a - b); if (!v.length) return null;
  const h = (v.length - 1) * p, lo = Math.floor(h);
  return v[lo] + (h - lo) * ((v[Math.min(lo + 1, v.length - 1)] ?? v[lo]) - v[lo]);
}

// ---------- backtest ----------
// Long (1) when the signal is above hi, cash (0) below lo, otherwise hold. The position chosen at an
// update earns the mid return to the next update. Each change of position pays fee + slip × tick.
export function backtest(mids, sig, hi, lo, { fee = 0.0001, tick = 1, slip = 1 } = {}) {
  const n = mids.length, pos = new Array(n), gross = new Array(n), net = new Array(n), cost = new Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) { const s = sig[i]; if (fin(s)) { if (s > hi) p = 1; else if (s < lo) p = 0; } pos[i] = p; }
  for (let i = 0; i < n; i++) {
    const ret = i < n - 1 ? mids[i + 1] / mids[i] - 1 : 0;
    gross[i] = pos[i] * ret;
    const change = Math.abs(pos[i] - (i ? pos[i - 1] : 0));
    cost[i] = change * (fee + slip * tick / mids[i]);
    net[i] = gross[i] - cost[i];
  }
  return { pos, gross, net, cost };
}
// Round trips: from each entry to the next exit (or the end).
export function tradesOf(pos, r) {
  const out = []; let acc = null;
  for (let i = 0; i < pos.length; i++) {
    if (pos[i] === 1 && (i === 0 || pos[i - 1] === 0)) acc = 0;
    if (acc != null) acc = (1 + acc) * (1 + r[i]) - 1;
    if (acc != null && (i === pos.length - 1 || pos[i + 1] === 0)) { out.push(acc); acc = null; }
  }
  return out;
}
export function maxDrawdown(r) { let eq = 1, hi = 1, dd = 0; for (const x of r) { eq *= 1 + x; hi = Math.max(hi, eq); dd = Math.min(dd, eq / hi - 1); } return dd; }
export function sharpe(r, perDay) {
  const n = r.length, m = r.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  return sd > 0 ? m / sd * Math.sqrt(perDay * 252) : null;
}
export function summarize(bt, perDay) {
  const one = r => { const tr = tradesOf(bt.pos, r); return { trades: tr.length, hit_rate: tr.length ? tr.filter(x => x > 0).length / tr.length : null, avg_trade: tr.length ? tr.reduce((a, b) => a + b, 0) / tr.length : null, total: r.reduce((a, b) => a * (1 + b), 1) - 1, max_dd: maxDrawdown(r), sharpe: sharpe(r, perDay) }; };
  return { gross: one(bt.gross), net: one(bt.net) };
}
const slice = (f, a, b) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.slice(a, b)]));
const cum = r => { let e = 1; return r.map(x => (e *= 1 + x) - 1); };

// The whole exercise: factors, regressions, thresholds from the in-sample part only, the strategy
// on both parts (gross and net) and the cumulative-return curves against buy and hold.
export function analyze(ticks, { n = 10, hi = 0.8, lo = 0.2, inSample = 0.5, fee = 0.0001, tick = 1, slip = 1, horizons = [1, 5, 10, 20] } = {}) {
  if (!ticks?.length || ticks.length < Math.max(50, n * 4)) throw new Error('Not enough ticks: at least ' + Math.max(50, n * 4) + '.');
  const f = factors(ticks, n), split = Math.floor(ticks.length * inSample);
  const ins = slice(f, 0, split), oos = slice(f, split, ticks.length);
  const thi = quantile7(ins.ofi_n, hi), tlo = quantile7(ins.ofi_n, lo), costs = { fee, tick, slip }, perDay = ticks.length;
  const run = seg => { const bt = backtest(seg.mid, seg.ofi_n, thi, tlo, costs); return { bt, stats: summarize(bt, perDay), curve: { t: seg.t, gross: cum(bt.gross), net: cum(bt.net), hold: seg.mid.map(m => m / seg.mid[0] - 1) } }; };
  return { n, ticks: ticks.length, f, regressions: regressions(f, horizons), thresholds: { hi: thi, lo: tlo, split, pHi: hi, pLo: lo }, inSample: run(ins), outOfSample: run(oos), costs };
}
export const NOTE = 'Academic exercise. Simulated results; not investment advice. Real high-frequency trading needs exchange co-location and direct market data, which this app doesn\'t provide.';
