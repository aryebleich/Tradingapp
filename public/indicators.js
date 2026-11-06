// The indicator library for the Chart page and Brightolio Script: 100+ technical indicators built
// from a few shared calculations. bars: [{ o, h, l, c, v }]. Every result is a list of lines, each a
// series as long as the bars (null where it is not defined yet). Shared by the browser and the server.

// ---------- building blocks ----------
const N = x => (x == null || Number.isNaN(x) ? null : x);
export const sma = (s, n) => s.map((_, i) => { if (i < n - 1) return null; let t = 0; for (let k = i - n + 1; k <= i; k++) { if (s[k] == null) return null; t += s[k]; } return t / n; });
export const ema = (s, n, alpha = 2 / (n + 1)) => { const out = []; let e = null, c = 0; for (const v of s) { if (v == null) { out.push(e == null || c < n ? null : e); continue; } e = e == null ? v : v * alpha + e * (1 - alpha); c++; out.push(c < n ? null : e); } return out; };
export const rma = (s, n) => ema(s, n, 1 / n);
export const wma = (s, n) => s.map((_, i) => { if (i < n - 1) return null; let t = 0, w = 0; for (let k = 0; k < n; k++) { const v = s[i - k]; if (v == null) return null; t += v * (n - k); w += n - k; } return t / w; });
export const stdev = (s, n) => { const m = sma(s, n); return s.map((_, i) => (m[i] == null ? null : Math.sqrt(s.slice(i - n + 1, i + 1).reduce((a, x) => a + (x - m[i]) ** 2, 0) / n))); };
export const highest = (s, n) => s.map((_, i) => (i < n - 1 ? null : Math.max(...s.slice(i - n + 1, i + 1).map(x => x ?? -Infinity))));
export const lowest = (s, n) => s.map((_, i) => (i < n - 1 ? null : Math.min(...s.slice(i - n + 1, i + 1).map(x => x ?? Infinity))));
export const sum = (s, n) => s.map((_, i) => (i < n - 1 ? null : s.slice(i - n + 1, i + 1).reduce((a, x) => a + (x ?? 0), 0)));
export const change = (s, n = 1) => s.map((v, i) => (i < n || v == null || s[i - n] == null ? null : v - s[i - n]));
export const roc = (s, n) => s.map((v, i) => (i < n || v == null || !s[i - n] ? null : (v / s[i - n] - 1) * 100));
export const shift = (s, n) => s.map((_, i) => (i - n >= 0 && i - n < s.length ? s[i - n] : null));
const zip = (a, b, f) => a.map((x, i) => (x == null || b[i] == null ? null : N(f(x, b[i], i))));
const map = (a, f) => a.map((x, i) => (x == null ? null : N(f(x, i))));
export const tr = b => b.map((x, i) => (i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l));
export const atr = (b, n) => rma(tr(b), n);
export const rsi = (s, n) => { const up = change(s).map(d => (d == null ? null : Math.max(d, 0))), dn = change(s).map(d => (d == null ? null : Math.max(-d, 0))); const u = rma(up.map(x => x ?? 0), n), d = rma(dn.map(x => x ?? 0), n); return u.map((x, i) => (i < n || x == null ? null : d[i] === 0 ? 100 : 100 - 100 / (1 + x / d[i]))); };
const linreg = (s, n, off = 0) => s.map((_, i) => { if (i < n - 1) return null; let sx = 0, sy = 0, sxy = 0, sxx = 0; for (let k = 0; k < n; k++) { const y = s[i - n + 1 + k]; if (y == null) return null; sx += k; sy += y; sxy += k * y; sxx += k * k; } const m = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - m * sx) / n; return a + m * (n - 1 - off); });
const hma = (s, n) => wma(zip(wma(s, Math.round(n / 2)), wma(s, n), (a, b) => 2 * a - b), Math.round(Math.sqrt(n)));
const dema = (s, n) => { const e = ema(s, n), ee = ema(e, n); return zip(e, ee, (a, b) => 2 * a - b); };
const tema = (s, n) => { const e1 = ema(s, n), e2 = ema(e1, n), e3 = ema(e2, n); return e1.map((v, i) => (v == null || e2[i] == null || e3[i] == null ? null : 3 * v - 3 * e2[i] + e3[i])); };
const kama = (s, n = 10, f = 2, sl = 30) => { const out = []; let k = null; for (let i = 0; i < s.length; i++) { if (i < n) { out.push(null); k = s[i]; continue; } const ch = Math.abs(s[i] - s[i - n]); let vol = 0; for (let j = i - n + 1; j <= i; j++) vol += Math.abs(s[j] - s[j - 1]); const er = vol ? ch / vol : 0, sc = (er * (2 / (f + 1) - 2 / (sl + 1)) + 2 / (sl + 1)) ** 2; k = k + sc * (s[i] - k); out.push(k); } return out; };
const alma = (s, n = 9, off = 0.85, sig = 6) => { const m = off * (n - 1), sd = n / sig, w = [...Array(n)].map((_, k) => Math.exp(-((k - m) ** 2) / (2 * sd * sd))), ws = w.reduce((a, b) => a + b, 0); return s.map((_, i) => (i < n - 1 ? null : w.reduce((t, x, k) => t + x * s[i - n + 1 + k], 0) / ws)); };
const t3 = (s, n = 5, v = 0.7) => { const e1 = ema(s, n), e2 = ema(e1, n), e3 = ema(e2, n), e4 = ema(e3, n), e5 = ema(e4, n), e6 = ema(e5, n), c1 = -(v ** 3), c2 = 3 * v * v + 3 * v ** 3, c3 = -6 * v * v - 3 * v - 3 * v ** 3, c4 = 1 + 3 * v + v ** 3 + 3 * v * v; return e6.map((x, i) => (x == null ? null : c1 * x + c2 * e5[i] + c3 * e4[i] + c4 * e3[i])); };
const mcginley = (s, n) => { const out = []; let m = null; for (const v of s) { m = m == null ? v : m + (v - m) / (n * (v / m) ** 4); out.push(m); } return out; };
const zlema = (s, n) => ema(s.map((v, i) => (i < Math.floor((n - 1) / 2) ? v : 2 * v - s[i - Math.floor((n - 1) / 2)])), n);
const vwma = (b, n) => { const pv = sum(b.map(x => x.c * x.v), n), v = sum(b.map(x => x.v), n); return zip(pv, v, (a, c) => (c ? a / c : null)); };
const C = b => b.map(x => x.c), H = b => b.map(x => x.h), L = b => b.map(x => x.l), V = b => b.map(x => x.v || 0), O = b => b.map(x => x.o);
const HL2 = b => b.map(x => (x.h + x.l) / 2), HLC3 = b => b.map(x => (x.h + x.l + x.c) / 3), OHLC4 = b => b.map(x => (x.o + x.h + x.l + x.c) / 4);
const stochK = (b, n) => { const hh = highest(H(b), n), ll = lowest(L(b), n); return b.map((x, i) => (hh[i] == null ? null : hh[i] === ll[i] ? 50 : (x.c - ll[i]) / (hh[i] - ll[i]) * 100)); };
const dmi = (b, n) => {
  const up = b.map((x, i) => (i ? x.h - b[i - 1].h : 0)), dn = b.map((x, i) => (i ? b[i - 1].l - x.l : 0));
  const pdm = up.map((u, i) => (u > dn[i] && u > 0 ? u : 0)), mdm = dn.map((d, i) => (d > up[i] && d > 0 ? d : 0));
  const a = atr(b, n), pdi = zip(rma(pdm, n), a, (p, t) => (t ? 100 * p / t : 0)), mdi = zip(rma(mdm, n), a, (m, t) => (t ? 100 * m / t : 0));
  const dx = zip(pdi, mdi, (p, m) => (p + m ? 100 * Math.abs(p - m) / (p + m) : 0));
  return { pdi, mdi, adx: rma(dx.map(x => x ?? 0), n).map((v, i) => (i < 2 * n ? null : v)) };
};
const cumsum = s => { let t = 0; return s.map(v => (t += v ?? 0)); };
const one = (name, values) => [{ name, values }];

// ---------- the library: id, name, group, pane (price = drawn on the candles, sub = own pane), defaults ----------
// levels: guide lines for the sub pane. calc(bars, params) returns lines.
const I = [];
const def = (id, name, group, pane, params, calc, extra = {}) => I.push({ id, name, group, pane, params, calc, ...extra });
// Moving averages and trend overlays
def('sma', 'Simple moving average (SMA)', 'Moving averages', 'price', { length: 20 }, (b, p) => one(`SMA ${p.length}`, sma(C(b), p.length)));
def('ema', 'Exponential moving average (EMA)', 'Moving averages', 'price', { length: 20 }, (b, p) => one(`EMA ${p.length}`, ema(C(b), p.length)));
def('wma', 'Weighted moving average (WMA)', 'Moving averages', 'price', { length: 20 }, (b, p) => one(`WMA ${p.length}`, wma(C(b), p.length)));
def('hma', 'Hull moving average (HMA)', 'Moving averages', 'price', { length: 21 }, (b, p) => one(`HMA ${p.length}`, hma(C(b), p.length)));
def('dema', 'Double EMA (DEMA)', 'Moving averages', 'price', { length: 20 }, (b, p) => one(`DEMA ${p.length}`, dema(C(b), p.length)));
def('tema', 'Triple EMA (TEMA)', 'Moving averages', 'price', { length: 20 }, (b, p) => one(`TEMA ${p.length}`, tema(C(b), p.length)));
def('trima', 'Triangular moving average', 'Moving averages', 'price', { length: 20 }, (b, p) => one(`TRIMA ${p.length}`, sma(sma(C(b), Math.ceil(p.length / 2)), Math.floor(p.length / 2) + 1)));
def('kama', 'Kaufman adaptive moving average (KAMA)', 'Moving averages', 'price', { length: 10, fast: 2, slow: 30 }, (b, p) => one('KAMA', kama(C(b), p.length, p.fast, p.slow)));
def('vwma', 'Volume-weighted moving average', 'Moving averages', 'price', { length: 20 }, (b, p) => one(`VWMA ${p.length}`, vwma(b, p.length)));
def('alma', 'Arnaud Legoux moving average (ALMA)', 'Moving averages', 'price', { length: 9, offset: 0.85, sigma: 6 }, (b, p) => one('ALMA', alma(C(b), p.length, p.offset, p.sigma)));
def('smma', 'Smoothed moving average (SMMA / RMA)', 'Moving averages', 'price', { length: 14 }, (b, p) => one(`SMMA ${p.length}`, rma(C(b), p.length)));
def('zlema', 'Zero-lag EMA', 'Moving averages', 'price', { length: 20 }, (b, p) => one(`ZLEMA ${p.length}`, zlema(C(b), p.length)));
def('t3', 'Tillson T3', 'Moving averages', 'price', { length: 5, factor: 0.7 }, (b, p) => one('T3', t3(C(b), p.length, p.factor)));
def('mcginley', 'McGinley dynamic', 'Moving averages', 'price', { length: 14 }, (b, p) => one('McGinley', mcginley(C(b), p.length)));
def('lsma', 'Least squares moving average', 'Moving averages', 'price', { length: 25 }, (b, p) => one('LSMA', linreg(C(b), p.length)));
def('ribbon', 'Moving average ribbon (20/50/100/200)', 'Moving averages', 'price', {}, b => [20, 50, 100, 200].map(n => ({ name: `EMA ${n}`, values: ema(C(b), n) })));
def('golden', 'Golden / death cross (50/200 SMA)', 'Moving averages', 'price', {}, b => [{ name: 'SMA 50', values: sma(C(b), 50) }, { name: 'SMA 200', values: sma(C(b), 200) }]);
def('alligator', 'Williams Alligator', 'Trend', 'price', {}, b => [[13, 8, 'Jaw'], [8, 5, 'Teeth'], [5, 3, 'Lips']].map(([n, s, name]) => ({ name, values: shift(rma(HL2(b), n), s) })));
def('ichimoku', 'Ichimoku cloud', 'Trend', 'price', { conversion: 9, base: 26, spanB: 52 }, (b, p) => { const mid = n => zip(highest(H(b), n), lowest(L(b), n), (h, l) => (h + l) / 2), t = mid(p.conversion), k = mid(p.base); return [{ name: 'Conversion', values: t }, { name: 'Base', values: k }, { name: 'Span A', values: shift(zip(t, k, (a, c) => (a + c) / 2), p.base) }, { name: 'Span B', values: shift(mid(p.spanB), p.base) }]; });
def('psar', 'Parabolic SAR', 'Trend', 'price', { step: 0.02, max: 0.2 }, (b, p) => { const out = []; let up = true, sar = b[0]?.l, ep = b[0]?.h, af = p.step; b.forEach((x, i) => { if (!i) { out.push(null); return; } sar = sar + af * (ep - sar); if (up) { if (x.l < sar) { up = false; sar = ep; ep = x.l; af = p.step; } else if (x.h > ep) { ep = x.h; af = Math.min(p.max, af + p.step); } } else if (x.h > sar) { up = true; sar = ep; ep = x.h; af = p.step; } else if (x.l < ep) { ep = x.l; af = Math.min(p.max, af + p.step); } out.push(sar); }); return one('SAR', out); }, { dots: true });
def('supertrend', 'SuperTrend', 'Trend', 'price', { length: 10, factor: 3 }, (b, p) => { const a = atr(b, p.length), out = []; let up = null, dn = null, dir = 1; b.forEach((x, i) => { if (a[i] == null) { out.push(null); return; } const m = (x.h + x.l) / 2, u = m - p.factor * a[i], d = m + p.factor * a[i]; up = up == null || b[i - 1].c < up ? u : Math.max(u, up); dn = dn == null || b[i - 1].c > dn ? d : Math.min(d, dn); if (x.c > dn) dir = 1; else if (x.c < up) dir = -1; out.push(dir > 0 ? up : dn); }); return one('SuperTrend', out); });
def('vwap', 'VWAP (session)', 'Trend', 'price', {}, b => { const out = []; let pv = 0, vv = 0, day = null; for (const x of b) { const d = x.t ? new Date(x.t).toISOString().slice(0, 10) : null; if (d !== day) { pv = 0; vv = 0; day = d; } pv += (x.h + x.l + x.c) / 3 * (x.v || 0); vv += x.v || 0; out.push(vv ? pv / vv : null); } return one('VWAP', out); });
def('pivots', 'Pivot points (classic)', 'Support & resistance', 'price', {}, b => { const P = b.map((x, i) => (i ? (b[i - 1].h + b[i - 1].l + b[i - 1].c) / 3 : null)); return [{ name: 'Pivot', values: P }, { name: 'R1', values: P.map((p, i) => (p == null ? null : 2 * p - b[i - 1].l)) }, { name: 'S1', values: P.map((p, i) => (p == null ? null : 2 * p - b[i - 1].h)) }]; });
def('chandelier', 'Chandelier exit', 'Support & resistance', 'price', { length: 22, mult: 3 }, (b, p) => { const a = atr(b, p.length); return [{ name: 'Long exit', values: zip(highest(H(b), p.length), a, (h, x) => h - p.mult * x) }, { name: 'Short exit', values: zip(lowest(L(b), p.length), a, (l, x) => l + p.mult * x) }]; });
def('hh', 'Highest high', 'Support & resistance', 'price', { length: 20 }, (b, p) => one(`High ${p.length}`, highest(H(b), p.length)));
def('ll', 'Lowest low', 'Support & resistance', 'price', { length: 20 }, (b, p) => one(`Low ${p.length}`, lowest(L(b), p.length)));
def('median', 'Median price (HL/2)', 'Price', 'price', {}, b => one('Median', HL2(b)));
def('typical', 'Typical price (HLC/3)', 'Price', 'price', {}, b => one('Typical', HLC3(b)));
def('wclose', 'Weighted close (HLCC/4)', 'Price', 'price', {}, b => one('Weighted close', b.map(x => (x.h + x.l + 2 * x.c) / 4)));
def('ohlc4', 'Average price (OHLC/4)', 'Price', 'price', {}, b => one('OHLC/4', OHLC4(b)));
def('heikin', 'Heikin-Ashi close', 'Price', 'price', {}, b => one('HA close', OHLC4(b)));
// Bands and channels
const band = (mid, w, k) => [{ name: 'Upper', values: zip(mid, w, (m, x) => m + k * x) }, { name: 'Middle', values: mid }, { name: 'Lower', values: zip(mid, w, (m, x) => m - k * x) }];
def('bb', 'Bollinger Bands', 'Bands & channels', 'price', { length: 20, mult: 2 }, (b, p) => band(sma(C(b), p.length), stdev(C(b), p.length), p.mult), { fill: true });
def('keltner', 'Keltner Channels', 'Bands & channels', 'price', { length: 20, mult: 2 }, (b, p) => band(ema(C(b), p.length), atr(b, p.length), p.mult), { fill: true });
def('donchian', 'Donchian Channels', 'Bands & channels', 'price', { length: 20 }, (b, p) => { const h = highest(H(b), p.length), l = lowest(L(b), p.length); return [{ name: 'Upper', values: h }, { name: 'Middle', values: zip(h, l, (a, c) => (a + c) / 2) }, { name: 'Lower', values: l }]; }, { fill: true });
def('envelope', 'Moving average envelope', 'Bands & channels', 'price', { length: 20, percent: 2.5 }, (b, p) => { const m = sma(C(b), p.length); return [{ name: 'Upper', values: map(m, v => v * (1 + p.percent / 100)) }, { name: 'Middle', values: m }, { name: 'Lower', values: map(m, v => v * (1 - p.percent / 100)) }]; }, { fill: true });
def('atrbands', 'ATR bands', 'Bands & channels', 'price', { length: 14, mult: 2 }, (b, p) => band(C(b), atr(b, p.length), p.mult), { fill: true });
def('starc', 'STARC bands', 'Bands & channels', 'price', { length: 6, atr: 15, mult: 2 }, (b, p) => band(sma(C(b), p.length), atr(b, p.atr), p.mult), { fill: true });
def('accbands', 'Acceleration bands', 'Bands & channels', 'price', { length: 20, factor: 4 }, (b, p) => { const k = b.map(x => (x.h + x.l ? p.factor * (x.h - x.l) / (x.h + x.l) : 0)); return [{ name: 'Upper', values: sma(b.map((x, i) => x.h * (1 + k[i])), p.length) }, { name: 'Middle', values: sma(C(b), p.length) }, { name: 'Lower', values: sma(b.map((x, i) => x.l * (1 - k[i])), p.length) }]; }, { fill: true });
def('lrc', 'Linear regression channel', 'Bands & channels', 'price', { length: 50, mult: 2 }, (b, p) => band(linreg(C(b), p.length), stdev(C(b), p.length), p.mult));
def('stderr', 'Standard error bands', 'Bands & channels', 'price', { length: 21, mult: 2 }, (b, p) => band(linreg(C(b), p.length), map(stdev(C(b), p.length), s => s / Math.sqrt(p.length)), p.mult));
def('pricechannel', 'Price channel', 'Bands & channels', 'price', { length: 20 }, (b, p) => [{ name: 'Upper', values: shift(highest(H(b), p.length), 1) }, { name: 'Lower', values: shift(lowest(L(b), p.length), 1) }]);
// Momentum (own pane)
def('rsi', 'Relative strength index (RSI)', 'Momentum', 'sub', { length: 14 }, (b, p) => one(`RSI ${p.length}`, rsi(C(b), p.length)), { levels: [30, 70], range: [0, 100] });
def('stoch', 'Stochastic', 'Momentum', 'sub', { k: 14, smooth: 3, d: 3 }, (b, p) => { const k = sma(stochK(b, p.k), p.smooth); return [{ name: '%K', values: k }, { name: '%D', values: sma(k, p.d) }]; }, { levels: [20, 80], range: [0, 100] });
def('stochrsi', 'Stochastic RSI', 'Momentum', 'sub', { length: 14, k: 3, d: 3 }, (b, p) => { const r = rsi(C(b), p.length), hh = highest(r, p.length), ll = lowest(r, p.length), raw = r.map((v, i) => (v == null || hh[i] == null ? null : hh[i] === ll[i] ? 50 : (v - ll[i]) / (hh[i] - ll[i]) * 100)), k = sma(raw, p.k); return [{ name: '%K', values: k }, { name: '%D', values: sma(k, p.d) }]; }, { levels: [20, 80], range: [0, 100] });
def('macd', 'MACD', 'Momentum', 'sub', { fast: 12, slow: 26, signal: 9 }, (b, p) => { const m = zip(ema(C(b), p.fast), ema(C(b), p.slow), (a, c) => a - c), s = ema(m, p.signal); return [{ name: 'MACD', values: m }, { name: 'Signal', values: s }, { name: 'Histogram', values: zip(m, s, (a, c) => a - c), hist: true }]; }, { levels: [0] });
def('ppo', 'Percentage price oscillator (PPO)', 'Momentum', 'sub', { fast: 12, slow: 26, signal: 9 }, (b, p) => { const m = zip(ema(C(b), p.fast), ema(C(b), p.slow), (a, c) => (a / c - 1) * 100); return [{ name: 'PPO', values: m }, { name: 'Signal', values: ema(m, p.signal) }]; }, { levels: [0] });
def('apo', 'Absolute price oscillator', 'Momentum', 'sub', { fast: 10, slow: 21 }, (b, p) => one('APO', zip(ema(C(b), p.fast), ema(C(b), p.slow), (a, c) => a - c)), { levels: [0] });
def('roc', 'Rate of change (ROC)', 'Momentum', 'sub', { length: 12 }, (b, p) => one(`ROC ${p.length}`, roc(C(b), p.length)), { levels: [0] });
def('mom', 'Momentum', 'Momentum', 'sub', { length: 10 }, (b, p) => one(`MOM ${p.length}`, change(C(b), p.length)), { levels: [0] });
def('cci', 'Commodity channel index (CCI)', 'Momentum', 'sub', { length: 20 }, (b, p) => { const t = HLC3(b), m = sma(t, p.length); return one('CCI', t.map((v, i) => { if (m[i] == null) return null; const md = t.slice(i - p.length + 1, i + 1).reduce((a, x) => a + Math.abs(x - m[i]), 0) / p.length; return md ? (v - m[i]) / (0.015 * md) : 0; })); }, { levels: [-100, 100] });
def('willr', 'Williams %R', 'Momentum', 'sub', { length: 14 }, (b, p) => one('%R', stochK(b, p.length).map(v => (v == null ? null : v - 100))), { levels: [-80, -20], range: [-100, 0] });
def('uo', 'Ultimate oscillator', 'Momentum', 'sub', { short: 7, mid: 14, long: 28 }, (b, p) => { const bp = b.map((x, i) => x.c - Math.min(x.l, i ? b[i - 1].c : x.l)), t = tr(b), avg = n => zip(sum(bp, n), sum(t, n), (a, c) => (c ? a / c : 0)), a1 = avg(p.short), a2 = avg(p.mid), a3 = avg(p.long); return one('UO', a1.map((v, i) => (v == null || a2[i] == null || a3[i] == null ? null : 100 * (4 * v + 2 * a2[i] + a3[i]) / 7))); }, { levels: [30, 70], range: [0, 100] });
def('ao', 'Awesome oscillator', 'Momentum', 'sub', {}, b => [{ name: 'AO', values: zip(sma(HL2(b), 5), sma(HL2(b), 34), (a, c) => a - c), hist: true }], { levels: [0] });
def('ac', 'Accelerator oscillator', 'Momentum', 'sub', {}, b => { const ao = zip(sma(HL2(b), 5), sma(HL2(b), 34), (a, c) => a - c); return [{ name: 'AC', values: zip(ao, sma(ao, 5), (a, c) => a - c), hist: true }]; }, { levels: [0] });
def('cmo', 'Chande momentum oscillator', 'Momentum', 'sub', { length: 9 }, (b, p) => { const d = change(C(b)), u = sum(d.map(x => Math.max(x ?? 0, 0)), p.length), w = sum(d.map(x => Math.max(-(x ?? 0), 0)), p.length); return one('CMO', zip(u, w, (a, c) => (a + c ? 100 * (a - c) / (a + c) : 0))); }, { levels: [-50, 50], range: [-100, 100] });
def('trix', 'TRIX', 'Momentum', 'sub', { length: 15 }, (b, p) => one('TRIX', roc(ema(ema(ema(C(b), p.length), p.length), p.length), 1)), { levels: [0] });
def('tsi', 'True strength index (TSI)', 'Momentum', 'sub', { long: 25, short: 13, signal: 13 }, (b, p) => { const d = change(C(b)).map(x => x ?? 0), t = zip(ema(ema(d, p.long), p.short), ema(ema(d.map(Math.abs), p.long), p.short), (a, c) => (c ? 100 * a / c : 0)); return [{ name: 'TSI', values: t }, { name: 'Signal', values: ema(t, p.signal) }]; }, { levels: [0] });
def('kst', 'Know sure thing (KST)', 'Momentum', 'sub', {}, b => { const c = C(b), r = (a, s) => sma(roc(c, a), s), k = [r(10, 10), r(15, 10), r(20, 10), r(30, 15)]; const kst = k[0].map((v, i) => (k.some(x => x[i] == null) ? null : k[0][i] + 2 * k[1][i] + 3 * k[2][i] + 4 * k[3][i])); return [{ name: 'KST', values: kst }, { name: 'Signal', values: sma(kst, 9) }]; }, { levels: [0] });
def('dpo', 'Detrended price oscillator', 'Momentum', 'sub', { length: 20 }, (b, p) => one('DPO', zip(C(b), shift(sma(C(b), p.length), Math.floor(p.length / 2) + 1), (a, c) => a - c)), { levels: [0] });
def('coppock', 'Coppock curve', 'Momentum', 'sub', { long: 14, short: 11, length: 10 }, (b, p) => one('Coppock', wma(zip(roc(C(b), p.long), roc(C(b), p.short), (a, c) => a + c), p.length)), { levels: [0] });
def('fisher', 'Fisher transform', 'Momentum', 'sub', { length: 9 }, (b, p) => { const hh = highest(HL2(b), p.length), ll = lowest(HL2(b), p.length), out = []; let v = 0, f = 0; HL2(b).forEach((x, i) => { if (hh[i] == null) { out.push(null); return; } v = 0.66 * ((x - ll[i]) / ((hh[i] - ll[i]) || 1) - 0.5) + 0.67 * v; v = Math.max(-0.999, Math.min(0.999, v)); f = 0.5 * Math.log((1 + v) / (1 - v)) + 0.5 * f; out.push(f); }); return [{ name: 'Fisher', values: out }, { name: 'Trigger', values: shift(out, 1) }]; }, { levels: [0] });
def('rvi', 'Relative vigor index', 'Momentum', 'sub', { length: 10 }, (b, p) => { const r = zip(sum(b.map(x => x.c - x.o), p.length), sum(b.map(x => x.h - x.l), p.length), (a, c) => (c ? a / c : 0)); return [{ name: 'RVI', values: r }, { name: 'Signal', values: sma(r, 4) }]; }, { levels: [0] });
def('crsi', 'Connors RSI', 'Momentum', 'sub', { rsi: 3, streak: 2, rank: 100 }, (b, p) => { const c = C(b), st = []; let s = 0; c.forEach((v, i) => { s = !i ? 0 : v > c[i - 1] ? (s > 0 ? s + 1 : 1) : v < c[i - 1] ? (s < 0 ? s - 1 : -1) : 0; st.push(s); }); const r1 = rsi(c, p.rsi), r2 = rsi(st, p.streak), ch = roc(c, 1), pr = ch.map((v, i) => (i < p.rank || v == null ? null : ch.slice(i - p.rank, i).filter(x => x != null && x < v).length / p.rank * 100)); return one('CRSI', r1.map((v, i) => (v == null || r2[i] == null || pr[i] == null ? null : (v + r2[i] + pr[i]) / 3))); }, { levels: [10, 90], range: [0, 100] });
def('elder', 'Elder ray (bull and bear power)', 'Momentum', 'sub', { length: 13 }, (b, p) => { const e = ema(C(b), p.length); return [{ name: 'Bull power', values: zip(H(b), e, (a, c) => a - c), hist: true }, { name: 'Bear power', values: zip(L(b), e, (a, c) => a - c) }]; }, { levels: [0] });
def('smi', 'Stochastic momentum index', 'Momentum', 'sub', { length: 10, smooth: 3 }, (b, p) => { const hh = highest(H(b), p.length), ll = lowest(L(b), p.length), m = b.map((x, i) => (hh[i] == null ? null : x.c - (hh[i] + ll[i]) / 2)), r = zip(hh, ll, (a, c) => a - c), s = zip(ema(ema(m, p.smooth), p.smooth), ema(ema(r, p.smooth), p.smooth), (a, c) => (c ? 200 * a / c : 0)); return [{ name: 'SMI', values: s }, { name: 'Signal', values: ema(s, p.smooth) }]; }, { levels: [-40, 40] });
def('rmi', 'Relative momentum index', 'Momentum', 'sub', { length: 14, momentum: 5 }, (b, p) => { const d = change(C(b), p.momentum), u = rma(d.map(x => Math.max(x ?? 0, 0)), p.length), w = rma(d.map(x => Math.max(-(x ?? 0), 0)), p.length); return one('RMI', zip(u, w, (a, c) => (c ? 100 - 100 / (1 + a / c) : 100))); }, { levels: [30, 70], range: [0, 100] });
def('imi', 'Intraday momentum index', 'Momentum', 'sub', { length: 14 }, (b, p) => { const g = sum(b.map(x => Math.max(x.c - x.o, 0)), p.length), l = sum(b.map(x => Math.max(x.o - x.c, 0)), p.length); return one('IMI', zip(g, l, (a, c) => (a + c ? 100 * a / (a + c) : 50))); }, { levels: [30, 70], range: [0, 100] });
def('cfo', 'Chande forecast oscillator', 'Momentum', 'sub', { length: 14 }, (b, p) => one('CFO', zip(C(b), linreg(C(b), p.length), (a, c) => (a ? (a - c) / a * 100 : 0))), { levels: [0] });
def('disparity', 'Disparity index', 'Momentum', 'sub', { length: 14 }, (b, p) => one('Disparity', zip(C(b), sma(C(b), p.length), (a, c) => (a / c - 1) * 100)), { levels: [0] });
def('cog', 'Center of gravity', 'Momentum', 'sub', { length: 10 }, (b, p) => one('COG', C(b).map((_, i, c) => { if (i < p.length - 1) return null; let num = 0, den = 0; for (let k = 0; k < p.length; k++) { num += (k + 1) * c[i - k]; den += c[i - k]; } return den ? -num / den : null; })));
def('qstick', 'Qstick', 'Momentum', 'sub', { length: 8 }, (b, p) => one('Qstick', sma(b.map(x => x.c - x.o), p.length)), { levels: [0] });
def('bop', 'Balance of power', 'Momentum', 'sub', { length: 14 }, (b, p) => one('BOP', sma(b.map(x => (x.h - x.l ? (x.c - x.o) / (x.h - x.l) : 0)), p.length)), { levels: [0] });
def('stc', 'Schaff trend cycle', 'Momentum', 'sub', { fast: 23, slow: 50, cycle: 10 }, (b, p) => { const m = zip(ema(C(b), p.fast), ema(C(b), p.slow), (a, c) => a - c), st = s => { const hh = highest(s, p.cycle), ll = lowest(s, p.cycle); return s.map((v, i) => (v == null || hh[i] == null ? null : hh[i] === ll[i] ? 50 : (v - ll[i]) / (hh[i] - ll[i]) * 100)); }; return one('STC', ema(st(ema(st(m), 3)), 3)); }, { levels: [25, 75], range: [0, 100] });
def('rwi', 'Random walk index', 'Momentum', 'sub', { length: 14 }, (b, p) => { const a = atr(b, p.length); return [{ name: 'RWI high', values: b.map((x, i) => (i < p.length || !a[i] ? null : (x.h - b[i - p.length].l) / (a[i] * Math.sqrt(p.length)))) }, { name: 'RWI low', values: b.map((x, i) => (i < p.length || !a[i] ? null : (b[i - p.length].h - x.l) / (a[i] * Math.sqrt(p.length)))) }]; }, { levels: [1] });
def('tii', 'Trend intensity index', 'Momentum', 'sub', { length: 30 }, (b, p) => { const m = sma(C(b), p.length), d = zip(C(b), m, (a, c) => a - c), half = Math.floor(p.length / 2), u = sum(d.map(x => Math.max(x ?? 0, 0)), half), w = sum(d.map(x => Math.max(-(x ?? 0), 0)), half); return one('TII', zip(u, w, (a, c) => (a + c ? 100 * a / (a + c) : 50))); }, { levels: [20, 80], range: [0, 100] });
def('zscore', 'Z-score', 'Momentum', 'sub', { length: 20 }, (b, p) => one('Z', zip(zip(C(b), sma(C(b), p.length), (a, c) => a - c), stdev(C(b), p.length), (a, s) => (s ? a / s : 0))), { levels: [-2, 0, 2] });
def('obvmom', 'Price momentum percentile (1 year)', 'Momentum', 'sub', { length: 252 }, (b, p) => one('Percentile', C(b).map((v, i, c) => (i < p.length ? null : c.slice(i - p.length, i).filter(x => x < v).length / p.length * 100))), { levels: [20, 80], range: [0, 100] });
// Trend strength
def('adx', 'Average directional index (ADX)', 'Trend strength', 'sub', { length: 14 }, (b, p) => one('ADX', dmi(b, p.length).adx), { levels: [20, 40], range: [0, 100] });
def('dmi', 'Directional movement (+DI / -DI / ADX)', 'Trend strength', 'sub', { length: 14 }, (b, p) => { const d = dmi(b, p.length); return [{ name: '+DI', values: d.pdi }, { name: '-DI', values: d.mdi }, { name: 'ADX', values: d.adx }]; }, { levels: [20], range: [0, 100] });
def('aroon', 'Aroon (up and down)', 'Trend strength', 'sub', { length: 25 }, (b, p) => { const up = [], dn = []; b.forEach((_, i) => { if (i < p.length) { up.push(null); dn.push(null); return; } const win = b.slice(i - p.length, i + 1); let hi = 0, lo = 0; win.forEach((x, k) => { if (x.h >= win[hi].h) hi = k; if (x.l <= win[lo].l) lo = k; }); up.push(hi / p.length * 100); dn.push(lo / p.length * 100); }); return [{ name: 'Up', values: up }, { name: 'Down', values: dn }]; }, { levels: [30, 70], range: [0, 100] });
def('aroonosc', 'Aroon oscillator', 'Trend strength', 'sub', { length: 25 }, (b, p) => { const a = I.find(x => x.id === 'aroon').calc(b, p); return one('Aroon osc', zip(a[0].values, a[1].values, (u, d) => u - d)); }, { levels: [0], range: [-100, 100] });
def('vortex', 'Vortex indicator', 'Trend strength', 'sub', { length: 14 }, (b, p) => { const vp = b.map((x, i) => (i ? Math.abs(x.h - b[i - 1].l) : 0)), vm = b.map((x, i) => (i ? Math.abs(x.l - b[i - 1].h) : 0)), t = sum(tr(b), p.length); return [{ name: 'VI+', values: zip(sum(vp, p.length), t, (a, c) => (c ? a / c : 0)) }, { name: 'VI-', values: zip(sum(vm, p.length), t, (a, c) => (c ? a / c : 0)) }]; }, { levels: [1] });
def('chop', 'Choppiness index', 'Trend strength', 'sub', { length: 14 }, (b, p) => one('CHOP', zip(sum(tr(b), p.length), zip(highest(H(b), p.length), lowest(L(b), p.length), (h, l) => h - l), (s, r) => (r ? 100 * Math.log10(s / r) / Math.log10(p.length) : null))), { levels: [38.2, 61.8], range: [0, 100] });
def('vhf', 'Vertical horizontal filter', 'Trend strength', 'sub', { length: 28 }, (b, p) => one('VHF', zip(zip(highest(C(b), p.length), lowest(C(b), p.length), (h, l) => h - l), sum(change(C(b)).map(x => Math.abs(x ?? 0)), p.length), (r, s) => (s ? r / s : 0))));
def('mass', 'Mass index', 'Trend strength', 'sub', { length: 25 }, (b, p) => { const r = b.map(x => x.h - x.l), e1 = ema(r, 9), e2 = ema(e1, 9); return one('Mass', sum(zip(e1, e2, (a, c) => (c ? a / c : 1)), p.length)); }, { levels: [27] });
def('linslope', 'Linear regression slope', 'Trend strength', 'sub', { length: 20 }, (b, p) => one('Slope', zip(linreg(C(b), p.length), linreg(C(b), p.length, 1), (a, c) => a - c)), { levels: [0] });
def('r2', 'R-squared (trend fit)', 'Trend strength', 'sub', { length: 20 }, (b, p) => one('R²', C(b).map((_, i, c) => { if (i < p.length - 1) return null; const ys = c.slice(i - p.length + 1, i + 1), n = p.length, xs = ys.map((_, k) => k), mx = (n - 1) / 2, my = ys.reduce((a, x) => a + x, 0) / n; let sxy = 0, sxx = 0, syy = 0; ys.forEach((y, k) => { sxy += (xs[k] - mx) * (y - my); sxx += (xs[k] - mx) ** 2; syy += (y - my) ** 2; }); return syy ? sxy * sxy / (sxx * syy) : 0; })), { range: [0, 1] });
// Volatility
def('atr', 'Average true range (ATR)', 'Volatility', 'sub', { length: 14 }, (b, p) => one(`ATR ${p.length}`, atr(b, p.length)));
def('natr', 'Normalized ATR (% of price)', 'Volatility', 'sub', { length: 14 }, (b, p) => one('NATR', zip(atr(b, p.length), C(b), (a, c) => 100 * a / c)));
def('tr', 'True range', 'Volatility', 'sub', {}, b => one('TR', tr(b)));
def('stdev', 'Standard deviation', 'Volatility', 'sub', { length: 20 }, (b, p) => one('StdDev', stdev(C(b), p.length)));
def('hv', 'Historical volatility (yearly %)', 'Volatility', 'sub', { length: 20 }, (b, p) => one('HV', map(stdev(C(b).map((v, i, c) => (i ? Math.log(v / c[i - 1]) : null)).map(x => x ?? 0), p.length), s => s * Math.sqrt(252) * 100)));
def('bbp', 'Bollinger %B', 'Volatility', 'sub', { length: 20, mult: 2 }, (b, p) => { const m = sma(C(b), p.length), s = stdev(C(b), p.length); return one('%B', C(b).map((v, i) => (m[i] == null || !s[i] ? null : (v - (m[i] - p.mult * s[i])) / (2 * p.mult * s[i])))); }, { levels: [0, 1] });
def('bbw', 'Bollinger bandwidth', 'Volatility', 'sub', { length: 20, mult: 2 }, (b, p) => one('BBW', zip(stdev(C(b), p.length), sma(C(b), p.length), (s, m) => 2 * p.mult * s / m * 100)));
def('kcw', 'Keltner channel width', 'Volatility', 'sub', { length: 20, mult: 2 }, (b, p) => one('KCW', zip(atr(b, p.length), ema(C(b), p.length), (a, m) => 2 * p.mult * a / m * 100)));
def('chaikinvol', 'Chaikin volatility', 'Volatility', 'sub', { length: 10 }, (b, p) => one('Chaikin vol', roc(ema(b.map(x => x.h - x.l), p.length), p.length)), { levels: [0] });
def('ulcer', 'Ulcer index', 'Volatility', 'sub', { length: 14 }, (b, p) => { const hh = highest(C(b), p.length), dd = C(b).map((v, i) => (hh[i] == null ? null : ((v - hh[i]) / hh[i] * 100) ** 2)); return one('Ulcer', map(sma(dd, p.length), Math.sqrt)); });
def('rvol', 'Relative volatility index', 'Volatility', 'sub', { length: 10 }, (b, p) => { const s = stdev(C(b), p.length), d = change(C(b)), u = ema(s.map((x, i) => ((d[i] ?? 0) > 0 ? x ?? 0 : 0)), 14), w = ema(s.map((x, i) => ((d[i] ?? 0) < 0 ? x ?? 0 : 0)), 14); return one('RVI', zip(u, w, (a, c) => (a + c ? 100 * a / (a + c) : 50))); }, { levels: [30, 70], range: [0, 100] });
def('drawdown', 'Drawdown from high (%)', 'Volatility', 'sub', {}, b => { let hi = -Infinity; return one('Drawdown', C(b).map(v => { hi = Math.max(hi, v); return (v / hi - 1) * 100; })); }, { levels: [-20, -10] });
// Volume
def('vol', 'Volume', 'Volume', 'sub', {}, b => [{ name: 'Volume', values: V(b), hist: true }]);
def('volma', 'Volume moving average', 'Volume', 'sub', { length: 20 }, (b, p) => [{ name: 'Volume', values: V(b), hist: true }, { name: `MA ${p.length}`, values: sma(V(b), p.length) }]);
def('relvol', 'Relative volume', 'Volume', 'sub', { length: 20 }, (b, p) => one('RVOL', zip(V(b), sma(V(b), p.length), (v, m) => (m ? v / m : null))), { levels: [1, 2] });
def('obv', 'On-balance volume (OBV)', 'Volume', 'sub', {}, b => one('OBV', cumsum(b.map((x, i) => (!i ? 0 : x.c > b[i - 1].c ? x.v : x.c < b[i - 1].c ? -x.v : 0)))));
def('ad', 'Accumulation / distribution line', 'Volume', 'sub', {}, b => one('A/D', cumsum(b.map(x => (x.h - x.l ? ((x.c - x.l) - (x.h - x.c)) / (x.h - x.l) * x.v : 0)))));
def('cmf', 'Chaikin money flow', 'Volume', 'sub', { length: 20 }, (b, p) => one('CMF', zip(sum(b.map(x => (x.h - x.l ? ((x.c - x.l) - (x.h - x.c)) / (x.h - x.l) * x.v : 0)), p.length), sum(V(b), p.length), (a, v) => (v ? a / v : 0))), { levels: [0] });
def('chaikinosc', 'Chaikin oscillator', 'Volume', 'sub', { fast: 3, slow: 10 }, (b, p) => { const ad = I.find(x => x.id === 'ad').calc(b)[0].values; return one('Chaikin osc', zip(ema(ad, p.fast), ema(ad, p.slow), (a, c) => a - c)); }, { levels: [0] });
def('mfi', 'Money flow index (MFI)', 'Volume', 'sub', { length: 14 }, (b, p) => { const t = HLC3(b), f = t.map((x, i) => x * b[i].v), pos = sum(f.map((x, i) => (i && t[i] > t[i - 1] ? x : 0)), p.length), neg = sum(f.map((x, i) => (i && t[i] < t[i - 1] ? x : 0)), p.length); return one('MFI', zip(pos, neg, (a, c) => (c ? 100 - 100 / (1 + a / c) : 100))); }, { levels: [20, 80], range: [0, 100] });
def('pvt', 'Price volume trend', 'Volume', 'sub', {}, b => one('PVT', cumsum(b.map((x, i) => (i ? (x.c / b[i - 1].c - 1) * x.v : 0)))));
def('nvi', 'Negative volume index', 'Volume', 'sub', {}, b => { let n = 1000; return one('NVI', b.map((x, i) => { if (i && x.v < b[i - 1].v) n *= x.c / b[i - 1].c; return n; })); });
def('pvi', 'Positive volume index', 'Volume', 'sub', {}, b => { let n = 1000; return one('PVI', b.map((x, i) => { if (i && x.v > b[i - 1].v) n *= x.c / b[i - 1].c; return n; })); });
def('volosc', 'Volume oscillator', 'Volume', 'sub', { fast: 5, slow: 10 }, (b, p) => one('Vol osc', zip(ema(V(b), p.fast), ema(V(b), p.slow), (a, c) => (c ? (a / c - 1) * 100 : 0))), { levels: [0] });
def('vroc', 'Volume rate of change', 'Volume', 'sub', { length: 14 }, (b, p) => one('VROC', roc(V(b), p.length)), { levels: [0] });
def('eom', 'Ease of movement', 'Volume', 'sub', { length: 14 }, (b, p) => one('EOM', sma(b.map((x, i) => (!i || !x.v ? 0 : (((x.h + x.l) / 2 - (b[i - 1].h + b[i - 1].l) / 2) * (x.h - x.l)) / (x.v / 1e6))), p.length)), { levels: [0] });
def('force', 'Force index', 'Volume', 'sub', { length: 13 }, (b, p) => one('Force', ema(b.map((x, i) => (i ? (x.c - b[i - 1].c) * x.v : 0)), p.length)), { levels: [0] });
def('klinger', 'Klinger oscillator', 'Volume', 'sub', { fast: 34, slow: 55, signal: 13 }, (b, p) => { const t = HLC3(b), vf = b.map((x, i) => (i && t[i] > t[i - 1] ? x.v : -x.v)), k = zip(ema(vf, p.fast), ema(vf, p.slow), (a, c) => a - c); return [{ name: 'Klinger', values: k }, { name: 'Signal', values: ema(k, p.signal) }]; }, { levels: [0] });
def('twiggs', 'Twiggs money flow', 'Volume', 'sub', { length: 21 }, (b, p) => { const ad = b.map((x, i) => { const th = Math.max(x.h, i ? b[i - 1].c : x.h), tl = Math.min(x.l, i ? b[i - 1].c : x.l); return th - tl ? ((x.c - tl) - (th - x.c)) / (th - tl) * x.v : 0; }); return one('TMF', zip(ema(ad, p.length), ema(V(b), p.length), (a, v) => (v ? a / v : 0))); }, { levels: [0] });
def('wad', 'Williams accumulation / distribution', 'Volume', 'sub', {}, b => one('WAD', cumsum(b.map((x, i) => { if (!i) return 0; const pc = b[i - 1].c; return x.c > pc ? x.c - Math.min(x.l, pc) : x.c < pc ? x.c - Math.max(x.h, pc) : 0; }))));
def('mfindex', 'Market facilitation index', 'Volume', 'sub', {}, b => one('MFI (BW)', b.map(x => (x.v ? (x.h - x.l) / x.v * 1e6 : null))));
def('vwapdev', 'Distance from VWAP (%)', 'Volume', 'sub', {}, b => { const v = I.find(x => x.id === 'vwap').calc(b)[0].values; return one('vs VWAP', zip(C(b), v, (c, w) => (c / w - 1) * 100)); }, { levels: [0] });
def('cumdelta', 'Up/down volume (cumulative)', 'Volume', 'sub', {}, b => one('Up-down volume', cumsum(b.map(x => (x.c >= x.o ? x.v : -x.v)))));
def('volprofile', 'Volume by price (last 120 bars, as levels)', 'Volume', 'price', {}, b => { const win = b.slice(-120), lo = Math.min(...win.map(x => x.l)), hi = Math.max(...win.map(x => x.h)), bins = 12, w = (hi - lo) / bins || 1, vol = Array(bins).fill(0); win.forEach(x => { vol[Math.min(bins - 1, Math.floor((x.c - lo) / w))] += x.v; }); const top = vol.indexOf(Math.max(...vol)), poc = lo + (top + 0.5) * w; return [{ name: 'Most traded price', values: b.map((_, i) => (i >= b.length - 120 ? poc : null)) }]; });
// Statistics and relative measures
def('pctchange', 'Change since the first bar (%)', 'Statistics', 'sub', {}, b => one('Change %', C(b).map(v => (v / C(b)[0] - 1) * 100)), { levels: [0] });
def('logret', 'Daily log return', 'Statistics', 'sub', {}, b => [{ name: 'Log return', values: C(b).map((v, i, c) => (i ? Math.log(v / c[i - 1]) * 100 : null)), hist: true }], { levels: [0] });
def('sharpe', 'Rolling Sharpe ratio (yearly)', 'Statistics', 'sub', { length: 63 }, (b, p) => { const r = C(b).map((v, i, c) => (i ? v / c[i - 1] - 1 : 0)); return one('Sharpe', zip(sma(r, p.length), stdev(r, p.length), (m, s) => (s ? m / s * Math.sqrt(252) : null))); }, { levels: [0, 1] });
def('autocorr', 'Autocorrelation (lag 1)', 'Statistics', 'sub', { length: 50 }, (b, p) => { const r = C(b).map((v, i, c) => (i ? v / c[i - 1] - 1 : 0)); return one('Autocorr', r.map((_, i) => { if (i < p.length) return null; const a = r.slice(i - p.length + 1, i + 1), x = a.slice(1), y = a.slice(0, -1), mx = x.reduce((s, v) => s + v, 0) / x.length, my = y.reduce((s, v) => s + v, 0) / y.length; let c = 0, vx = 0, vy = 0; x.forEach((v, k) => { c += (v - mx) * (y[k] - my); vx += (v - mx) ** 2; vy += (y[k] - my) ** 2; }); return vx && vy ? c / Math.sqrt(vx * vy) : 0; })); }, { levels: [0], range: [-1, 1] });
def('streak', 'Up / down streak', 'Statistics', 'sub', {}, b => { let s = 0; return [{ name: 'Streak', values: C(b).map((v, i, c) => (s = !i ? 0 : v > c[i - 1] ? (s > 0 ? s + 1 : 1) : v < c[i - 1] ? (s < 0 ? s - 1 : -1) : 0)), hist: true }]; }, { levels: [0] });
def('gap', 'Opening gap (%)', 'Statistics', 'sub', {}, b => [{ name: 'Gap', values: b.map((x, i) => (i ? (x.o / b[i - 1].c - 1) * 100 : null)), hist: true }], { levels: [0] });
def('range', 'Daily range (% of price)', 'Statistics', 'sub', {}, b => one('Range %', b.map(x => (x.h - x.l) / x.c * 100)));
def('closepos', 'Close position in the bar (0 = low, 1 = high)', 'Statistics', 'sub', {}, b => one('Close position', b.map(x => (x.h - x.l ? (x.c - x.l) / (x.h - x.l) : 0.5))), { levels: [0.5], range: [0, 1] });

export const INDICATORS = I;
export const byId = id => I.find(x => x.id === id);
export const GROUPS = [...new Set(I.map(x => x.group))];
// One indicator on the bars, with its settings merged over the defaults.
export function compute(id, bars, params = {}) {
  const d = byId(id); if (!d) throw new Error(`Unknown indicator ${id}`);
  const p = { ...d.params }; for (const [k, v] of Object.entries(params || {})) if (k in p && isFinite(+v)) p[k] = +v;
  return { def: d, params: p, lines: d.calc(bars, p) };
}
