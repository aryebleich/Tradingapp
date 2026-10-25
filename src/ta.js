// Small technical-analysis toolkit on arrays of closes (oldest first). Each series function
// returns an array the same length as its input, with null until enough data exists.
export const sma = (c, n) => c.map((_, i) => (i + 1 < n ? null : c.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n));
export function ema(c, n) {
  const k = 2 / (n + 1), out = []; let e = null;
  c.forEach((x, i) => { e = i === 0 ? x : x * k + e * (1 - k); out.push(i + 1 < n ? null : e); });
  return out;
}
export function rsi(c, n = 14) {
  const out = Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    if (i <= n) { g += Math.max(d, 0); l += Math.max(-d, 0); if (i === n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); continue; }
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
export const roc = (c, n) => c.map((x, i) => (i < n ? null : (x / c[i - n] - 1) * 100));
export function stdev(a) { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); }
// Annualized volatility of daily returns over the last n bars, in %.
export function vol(c, n = 20) {
  const r = []; for (let i = Math.max(1, c.length - n); i < c.length; i++) r.push(c[i] / c[i - 1] - 1);
  return r.length > 2 ? stdev(r) * Math.sqrt(252) * 100 : null;
}
export function bollinger(c, n = 20, k = 2) {
  const m = sma(c, n);
  return c.map((_, i) => { if (m[i] == null) return null; const s = stdev(c.slice(i + 1 - n, i + 1)); return { mid: m[i], up: m[i] + k * s, lo: m[i] - k * s }; });
}
export function macd(c, f = 12, s = 26, sig = 9) {
  const a = ema(c, f), b = ema(c, s), line = c.map((_, i) => (a[i] == null || b[i] == null ? null : a[i] - b[i]));
  const start = line.findIndex(x => x != null), sl = start < 0 ? [] : ema(line.slice(start), sig);
  return line.map((x, i) => ({ macd: x, signal: i >= start && start >= 0 ? sl[i - start] : null }));
}
const last = a => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };
const r2 = x => (x == null ? null : +x.toFixed(2));
// One-glance technical summary used by the AI assistant, scanner and portfolio builder.
export function snapshot(closes) {
  const c = closes, px = c.at(-1), hi = Math.max(...c.slice(-252)), lo = Math.min(...c.slice(-252));
  const s50 = last(sma(c, 50)), s200 = last(sma(c, 200)), m = macd(c).at(-1);
  return {
    price: r2(px), rsi14: r2(last(rsi(c, 14))), sma20: r2(last(sma(c, 20))), sma50: r2(s50), sma200: r2(s200),
    aboveSma200: s200 != null ? px > s200 : null, goldenCross: s50 != null && s200 != null ? s50 > s200 : null,
    roc1m: r2(last(roc(c, 21))), roc3m: r2(last(roc(c, 63))), roc6m: r2(last(roc(c, 126))), roc1y: r2(last(roc(c, 252))),
    vol20: r2(vol(c, 20)), high52w: r2(hi), low52w: r2(lo), fromHighPct: r2((px / hi - 1) * 100),
    macd: r2(m?.macd), macdSignal: r2(m?.signal),
  };
}
