// Live ratio pairs model: the pure math (no I/O), used by the engine (src/pairslive.js), its intraday
// backtest and the tests. Adapted from a Python "pairs model" design:
//   - beta: the ratio of the two mean prices over the history window (A's fair value = beta × B)
//   - volatility ratio: the standard deviation of A's percentage changes over B's
//   - divergence: how far A is from beta × B, in percent; past the entry threshold open opposing
//     positions (buy the cheap one, sell the rich one), close when it comes back inside the exit
//     threshold (converged), or at the stop (diverged further)
//   - the legs are sized by the volatility ratio, so each carries about the same risk
import { nyAt } from './time.js';
import { marketStatus } from './market-calendar.js';

// ---------- time helpers ----------
// A UTC moment → New York wall time: { day 'YYYY-MM-DD', minutes after midnight, hhmm 'HH:MM' }.
export function utcToNy(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  const minutes = (+p.hour % 24) * 60 + +p.minute;
  return { day: `${p.year}-${p.month}-${p.day}`, minutes, hhmm: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${p.minute}` };
}
// New York wall time → the UTC moment (daylight saving handled).
export const nyToUtc = (day, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return nyAt(day, h * 60 + m); };
// A signed quantity → the order side: positive buys, negative sells, zero is no order.
export const sideOf = qty => (qty > 0 ? 'BUY' : qty < 0 ? 'SELL' : null);
export const orderOf = (symbol, qty) => (qty ? { symbol, side: qty > 0 ? 'buy' : 'sell', qty: Math.abs(qty) } : null);

// ---------- bars ----------
// Points [{ t, price }] → fixed-length bars (the last price in each bucket), oldest first.
export function resample(points, barMs) {
  const out = new Map();
  for (const p of points) { if (!(p.price > 0)) continue; const k = Math.floor(p.t / barMs) * barMs; out.set(k, p.price); }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([t, close]) => ({ t, close }));
}
// The two legs' bars on the buckets both have.
export function align(a, b) {
  const mb = new Map(b.map(x => [x.t, x.close])), t = [], ca = [], cb = [];
  for (const x of a) if (mb.has(x.t)) { t.push(x.t); ca.push(x.close); cb.push(mb.get(x.t)); }
  return { t, ca, cb };
}

// ---------- the model ----------
const mean = x => x.reduce((s, v) => s + v, 0) / x.length;
const sd = x => { const m = mean(x); return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1)); };
const pctChanges = x => x.slice(1).map((v, i) => v / x[i] - 1);
export const betaOf = (ca, cb) => mean(ca) / mean(cb);
export function volRatio(ca, cb) { const sa = sd(pctChanges(ca)), sb = sd(pctChanges(cb)); return sb > 0 ? sa / sb : null; }
// How far A is from its fair value beta × B, in percent (+ means A is rich).
export const divergencePct = (pa, pb, beta) => (pa / (beta * pb) - 1) * 100;
export function model(ca, cb) {
  if (ca.length < 20 || cb.length !== ca.length) return null;
  const beta = betaOf(ca, cb), vr = volRatio(ca, cb);
  return { beta, volRatio: vr, divergence: divergencePct(ca.at(-1), cb.at(-1), beta) };
}
// Position: +1 = long A / short B (A cheap), −1 = short A / long B (A rich), 0 = flat.
export function signal(div, pos, { entryPct, exitPct, stopPct }) {
  if (!Number.isFinite(div)) return { want: pos, why: 'no data' };
  if (pos === 0) {
    if (div >= entryPct) return { want: -1, why: `A is ${div.toFixed(2)}% above its fair value: sell A, buy B` };
    if (div <= -entryPct) return { want: 1, why: `A is ${(-div).toFixed(2)}% below its fair value: buy A, sell B` };
    return { want: 0, why: 'inside the thresholds' };
  }
  if (stopPct && Math.abs(div) >= stopPct) return { want: 0, why: `diverged to ${div.toFixed(2)}%: stop` };
  if (Math.abs(div) <= exitPct || Math.sign(div) === pos) return { want: 0, why: `converged (${div.toFixed(2)}%)` };
  return { want: pos, why: `holding (${div.toFixed(2)}%)` };
}
// Weights of the two legs from the volatility ratio: the more volatile leg gets less money.
export const weights = vr => { const r = vr > 0 && Number.isFinite(vr) ? vr : 1; return { wa: 1 / (1 + r), wb: r / (1 + r) }; };
// Whole shares for a position of `dollars` in total, in direction `dir` (+1 / −1).
export function legQty(dollars, pa, pb, vr, dir) {
  const { wa, wb } = weights(vr);
  return { qa: dir * Math.floor(dollars * wa / pa), qb: -dir * Math.floor(dollars * wb / pb) };
}

// ---------- when it may trade ----------
// Regular hours only (the shared market calendar: no weekends or holidays), no new positions in the
// last `closeBeforeMin` minutes before the close (1 PM on early-close days), and everything is
// closed then unless the member chose to hold overnight.
export function tradingWindow(t, { closeBeforeMin = 10, holdOvernight = false } = {}) {
  const m = marketStatus(t);
  if (!m.open) return { open: false, enter: false, flatten: false, why: m.label };
  const left = m.closeMin - m.minutes;
  if (left <= closeBeforeMin) return { open: true, enter: false, flatten: !holdOvernight, why: holdOvernight ? 'close is near: no new positions (holding overnight)' : `${left} minutes to the close: closing the pair` };
  return { open: true, enter: true, flatten: false, why: m.label };
}

// ---------- intraday backtest ----------
// Aligned bar closes of A and B; the model refit on the last `window` bars at each bar (past data
// only). Costs: costBps + slipBps per unit of weight traded; borrow fee (yearly %) on the short leg.
export function backtest(ca, cb, { window = 60, entryPct = 0.5, exitPct = 0.1, stopPct = 2, costBps = 1, slipBps = 2, borrowPct = 3, barsPerDay = 78 } = {}) {
  const n = Math.min(ca.length, cb.length); let pos = 0, wa = 0, wb = 0;
  const rets = [], trades = []; let open = null;
  for (let i = window; i < n - 1; i++) {
    const m = model(ca.slice(i - window, i + 1), cb.slice(i - window, i + 1)); if (!m) { rets.push(0); continue; }
    const { want } = signal(m.divergence, pos, { entryPct, exitPct, stopPct });
    let cost = 0;
    if (want !== pos) {
      const w = want ? weights(m.volRatio) : { wa: 0, wb: 0 };
      cost = (Math.abs(w.wa - wa) + Math.abs(w.wb - wb)) * (costBps + slipBps) / 1e4;
      if (pos && open) { trades.push((1 + open.r) * (1 - cost) - 1); open = null; } // the exit cost ends the round trip
      pos = want; wa = w.wa; wb = w.wb; if (pos) open = { r: 0 };
    }
    const ra = ca[i + 1] / ca[i] - 1, rb = cb[i + 1] / cb[i] - 1;
    const borrow = pos ? (pos === 1 ? wb : wa) * borrowPct / 100 / (252 * barsPerDay) : 0;
    const r = pos * (wa * ra - wb * rb) - cost - borrow;
    if (open) open.r = (1 + open.r) * (1 + r) - 1; // includes the entry cost on its first bar
    rets.push(r);
  }
  if (open) trades.push(open.r);
  let eq = 1, hi = 1, dd = 0; const curve = rets.map(r => { eq *= 1 + r; hi = Math.max(hi, eq); dd = Math.min(dd, eq / hi - 1); return eq - 1; });
  const m = rets.length ? mean(rets) : 0, s = rets.length > 1 ? sd(rets) : 0;
  return { bars: rets.length, total: eq - 1, trades: trades.length, hitRate: trades.length ? trades.filter(x => x > 0).length / trades.length : null, maxDrawdown: dd, sharpe: s > 0 ? m / s * Math.sqrt(252 * barsPerDay) : null, curve };
}
