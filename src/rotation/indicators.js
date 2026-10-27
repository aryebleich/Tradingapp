// Indicators on daily closes, defined exactly like the original strategies:
//   rsi    Wilder RSI (RMA smoothing, seeded with a simple average), 0-100
//   sma    simple moving average of closes
//   close  closing price
//   ret    cumulative return over n sessions, in %   (close / close n sessions ago - 1)
//   avgret average 1-day return over the last n sessions, in %
//   stdev  standard deviation of 1-day returns over the last n sessions, in %
//   high   highest close of the n sessions before today
//   pstdev standard deviation of closes over n sessions (Bollinger)
// Every series function returns an array aligned with `closes` (NaN where there is not enough data).

export const LABEL = { rsi: n => `RSI(${n})`, sma: n => `SMA(${n})`, close: () => 'Close', ret: n => `ROC(${n})`, avgret: n => `AvgRet(${n}d)`, stdev: n => `StdDev(${n}d)`, high: n => `${n}d high`, pstdev: n => `StDev(${n})` };
export const FNS = Object.keys(LABEL);

export function rsiSeries(c, n) {
  const out = new Array(c.length).fill(NaN);
  if (c.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export function smaSeries(c, n) {
  const out = new Array(c.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < c.length; i++) { s += c[i]; if (i >= n) s -= c[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}

const returns = c => c.map((v, i) => (i ? (v / c[i - 1] - 1) * 100 : NaN));

function rolling(x, n, f) {
  const out = new Array(x.length).fill(NaN);
  for (let i = n - 1; i < x.length; i++) {
    const w = x.slice(i - n + 1, i + 1);
    if (w.some(v => !Number.isFinite(v))) continue;
    out[i] = f(w);
  }
  return out;
}
const mean = w => w.reduce((a, b) => a + b, 0) / w.length;
const sd = w => { const m = mean(w); return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (w.length - 1)); };

export function series(fn, c, n) {
  switch (fn) {
    case 'rsi': return rsiSeries(c, n);
    case 'sma': return smaSeries(c, n);
    case 'close': return c.slice();
    case 'ret': return c.map((v, i) => (i >= n ? (v / c[i - n] - 1) * 100 : NaN));
    case 'avgret': return rolling(returns(c), n, mean);
    case 'stdev': return rolling(returns(c), n, sd);
    case 'pstdev': return rolling(c, n, sd);
    case 'high': return c.map((_, i) => (i >= n ? Math.max(...c.slice(i - n, i)) : NaN));
    default: throw new Error(`Unknown indicator "${fn}"`);
  }
}

// How many bars an indicator needs before its first valid value.
export const warmup = (fn, n) => (fn === 'close' ? 1 : fn === 'rsi' ? n * 4 : n + 1);

// Typical daily volatility (%) over the last `n` sessions, for the stop-loss suggestion.
export function dailyVol(c, n = 60) {
  const r = returns(c).slice(-n).filter(Number.isFinite);
  return r.length > 5 ? sd(r) : NaN;
}
// Rule: trailing stop ≈ 3.5 × typical daily volatility, rounded, kept between 6% and 35%.
export const suggestedStop = vol => (Number.isFinite(vol) ? Math.min(35, Math.max(6, Math.round(3.5 * vol))) : 10);
