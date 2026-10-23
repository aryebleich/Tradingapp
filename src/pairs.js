// Pairs trading: two related stocks whose prices move together. When the gap between them
// (the "spread") stretches far from normal, sell the rich one and buy the cheap one; close when
// the gap returns to normal.
//
//   hedge ratio   OLS of log(A) on log(B):  log A = α + β log B + spread
//   z-score       (spread - rolling mean) / rolling standard deviation
//   cointegration Engle-Granger: Dickey-Fuller t-statistic of the spread (more negative = stronger)
//   half-life     how many days the spread takes to close half its gap (Ornstein-Uhlenbeck)
// The backtest re-fits the hedge ratio every 21 days on past data only (no look-ahead).
import express from 'express';
import { one, all, run, now } from './db.js';
import { getBars, placeOrder, lastPrice, validSymbol, ACCOUNT_IDS } from './brokers.js';
import { metrics } from './engine.js';
import { requireUser } from './auth.js';
import { isPaid } from './fees.js';

export const POPULAR = [
  ['KO', 'PEP'], ['V', 'MA'], ['XOM', 'CVX'], ['HD', 'LOW'], ['GDX', 'GLD'], ['EWA', 'EWC'], ['JPM', 'BAC'], ['GS', 'MS'], ['COST', 'WMT'],
  ['T', 'VZ'], ['DUK', 'SO'], ['LMT', 'NOC'], ['UPS', 'FDX'], ['CAT', 'DE'], ['MCD', 'YUM'], ['QQQ', 'XLK'], ['TLT', 'IEF'], ['HYG', 'JNK'], ['AMD', 'NVDA'], ['GOOGL', 'META'],
];
// MacKinnon (2010) critical values, Engle-Granger test with 2 variables and a constant.
const CRIT = { 1: -3.9, 5: -3.34, 10: -3.04 };
export const DEFAULTS = { lookback: 252, zWindow: 60, entryZ: 2, exitZ: 0.5, stopZ: 3.5, maxDays: 30, costBps: 5 };

const mean = x => x.reduce((a, b) => a + b, 0) / x.length;
function ols(y, x) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const beta = sxx ? sxy / sxx : 0, alpha = my - beta * mx;
  const res = y.map((v, i) => v - alpha - beta * x[i]);
  return { alpha, beta, res };
}
// Dickey-Fuller regression Δs_t = γ s_{t-1} + c + e; returns γ's t-statistic and the half-life.
function dickeyFuller(s) {
  const y = s.slice(1).map((v, i) => v - s[i]), x = s.slice(0, -1);
  const { beta: g, res } = ols(y, x);
  const mx = mean(x), sxx = x.reduce((a, v) => a + (v - mx) ** 2, 0);
  const se = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / (res.length - 2) / sxx);
  return { t: g / se, halfLife: g < 0 ? -Math.log(2) / Math.log(1 + g) : Infinity };
}
const corr = (a, b) => { const ma = mean(a), mb = mean(b); let s = 0, va = 0, vb = 0; for (let i = 0; i < a.length; i++) { s += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return s / Math.sqrt(va * vb); };

export async function loadPair(a, b, userId) {
  const start = `${new Date().getUTCFullYear() - 6}-01-01`;
  const [A, B] = await Promise.all([getBars(a, start, userId), getBars(b, start, userId)]);
  const ib = new Map(B.dates.map((d, i) => [d, B.closes[i]]));
  const dates = [], pa = [], pb = [];
  A.dates.forEach((d, i) => { if (ib.has(d)) { dates.push(d); pa.push(A.closes[i]); pb.push(ib.get(d)); } });
  if (dates.length < 300) throw Object.assign(new Error(`${a} and ${b} share only ${dates.length} trading days of history`), { status: 400 });
  return { dates, pa, pb, source: [...new Set([A.source, B.source])] };
}

// Statistics on the last `lookback` days, today's z-score and the signal.
export function analyze(d, o = {}) {
  o = { ...DEFAULTS, ...o };
  const n = d.dates.length, L = Math.min(o.lookback, n - 1);
  const la = d.pa.slice(n - L).map(Math.log), lb = d.pb.slice(n - L).map(Math.log);
  const { alpha, beta, res } = ols(la, lb);
  const df = dickeyFuller(res);
  const win = res.slice(-o.zWindow), m = mean(win), sd = Math.sqrt(mean(win.map(v => (v - m) ** 2)));
  const z = (res[res.length - 1] - m) / sd;
  const ra = la.slice(1).map((v, i) => v - la[i]), rb = lb.slice(1).map((v, i) => v - lb[i]);
  const level = df.t < CRIT[1] ? 1 : df.t < CRIT[5] ? 5 : df.t < CRIT[10] ? 10 : null;
  const signal = z > o.entryZ ? 'short_spread' : z < -o.entryZ ? 'long_spread' : Math.abs(z) < o.exitZ ? 'flat' : 'hold';
  // z-score history for the chart (fixed fit, rolling mean and sd)
  const zs = res.map((v, i) => { if (i < o.zWindow) return null; const w = res.slice(i - o.zWindow + 1, i + 1), mm = mean(w), s = Math.sqrt(mean(w.map(x => (x - mm) ** 2))); return (v - mm) / s; });
  return {
    alpha, beta, z, correlation: corr(ra, rb), adf: df.t, halfLife: df.halfLife, cointegrated: level, signal,
    verdict: level ? `Cointegrated at the ${level}% level` : 'Not cointegrated: the gap may never close',
    zHistory: zs.map((v, i) => ({ day: d.dates[n - L + i], z: v })).filter(x => x.z != null),
    priceA: d.pa[n - 1], priceB: d.pb[n - 1],
  };
}

// Walk-forward backtest. Market-neutral: half the money long one leg, half short the other.
// Long-only: holds only the leg that is cheap (no short selling), cash otherwise.
export function backtestPair(d, o = {}) {
  o = { ...DEFAULTS, ...o };
  const n = d.dates.length, start = Math.max(o.lookback, n - 5 * 252);
  const run1 = longOnly => {
    let fit = null, pos = 0, days = 0, trades = 0, wins = 0, entryEq = 1;
    const eq = [1];
    for (let i = start; i < n - 1; i++) {
      if (!fit || (i - start) % 21 === 0) {
        const la = d.pa.slice(i - o.lookback, i + 1).map(Math.log), lb = d.pb.slice(i - o.lookback, i + 1).map(Math.log);
        fit = ols(la, lb);
      }
      const s = j => Math.log(d.pa[j]) - fit.alpha - fit.beta * Math.log(d.pb[j]);
      const w = []; for (let j = i - o.zWindow + 1; j <= i; j++) w.push(s(j));
      const m = mean(w), sd = Math.sqrt(mean(w.map(x => (x - m) ** 2))), z = (s(i) - m) / sd;
      let next = pos;
      if (pos === 0) { if (z > o.entryZ) next = -1; else if (z < -o.entryZ) next = 1; }
      else if (Math.abs(z) < o.exitZ || Math.abs(z) > o.stopZ || days >= o.maxDays || Math.sign(z) === pos) next = 0;
      if (next !== pos) {
        if (pos !== 0) { trades++; if (eq[eq.length - 1] > entryEq) wins++; }
        eq[eq.length - 1] *= 1 - 2 * o.costBps / 1e4;
        if (next !== 0) { entryEq = eq[eq.length - 1]; days = 0; }
        pos = next;
      }
      if (pos) days++;
      const ra = d.pa[i + 1] / d.pa[i] - 1, rb = d.pb[i + 1] / d.pb[i] - 1;
      // pos 1 = spread cheap: long A, short B. pos -1 = spread rich: short A, long B.
      const r = !pos ? 0 : longOnly ? (pos === 1 ? ra : rb) : 0.5 * pos * ra - 0.5 * pos * rb;
      eq.push(eq[eq.length - 1] * (1 + r));
    }
    const step = Math.max(1, Math.floor(eq.length / 250));
    return { m: metrics(eq), trades, winRate: trades ? wins / trades * 100 : null, curve: eq.filter((_, i) => i % step === 0).map(v => v * 10000) };
  };
  return { from: d.dates[start], to: d.dates[n - 1], neutral: run1(false), longOnly: run1(true) };
}

// ---------- pair bots: trade a pair automatically every day ----------

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

export async function runPairBot(bot) {
  const o = JSON.parse(bot.params), st = JSON.parse(bot.state || '{}');
  const d = await loadPair(bot.a, bot.b, bot.user_id);
  const an = analyze(d, o);
  const want = st.pos === 1 || st.pos === -1
    ? (Math.abs(an.z) < o.exitZ || Math.abs(an.z) > o.stopZ || (st.days || 0) >= o.maxDays || Math.sign(an.z) === st.pos ? 0 : st.pos)
    : an.z > o.entryZ ? -1 : an.z < -o.entryZ ? 1 : 0;
  const log = [];
  const order = async (symbol, side, qty) => {
    if (!(qty > 0)) return;
    try { await placeOrder(bot.user_id, bot.account, { symbol, side, qty }, `pair:${bot.id}`); log.push(`${side.toUpperCase()} ${qty} ${symbol}`); }
    catch (e) { log.push(`✗ ${side} ${qty} ${symbol}: ${e.message}`); }
  };
  if (want !== (st.pos || 0)) {
    // Close what is open: long legs are sold, short legs bought back.
    if (st.qa) await order(bot.a, st.qa > 0 ? 'sell' : 'buy', Math.abs(st.qa));
    if (st.qb) await order(bot.b, st.qb > 0 ? 'sell' : 'buy', Math.abs(st.qb));
    let qa = 0, qb = 0;
    if (want) {
      const [px, py] = [await lastPrice(bot.a, bot.user_id), await lastPrice(bot.b, bot.user_id)];
      const half = bot.capital / 2;
      if (bot.mode === 'long_only') { if (want === 1) qa = Math.floor(bot.capital / px); else qb = Math.floor(bot.capital / py); }
      else { qa = want * Math.floor(half / px); qb = -want * Math.floor(half / py); }
      if (qa) await order(bot.a, qa > 0 ? 'buy' : 'sell', Math.abs(qa));
      if (qb) await order(bot.b, qb > 0 ? 'buy' : 'sell', Math.abs(qb));
    }
    Object.assign(st, { pos: want, qa, qb, days: 0, since: today() });
  } else if (st.pos) st.days = (st.days || 0) + 1;
  st.lastZ = an.z;
  const summary = log.length ? log.join(', ') : `No trade (z = ${an.z.toFixed(2)})`;
  await run('UPDATE pair_bots SET state = ?, last_run = ?, last_summary = ? WHERE id = ?', JSON.stringify(st), today(), summary, bot.id);
  return summary;
}

export async function runPairBots(t, claim) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  const mins = (+p.hour % 24) * 60 + +p.minute;
  if (['Sat', 'Sun'].includes(p.weekday) || mins < 945 || mins > 960) return 0;
  let n = 0;
  for (const bot of await all("SELECT * FROM pair_bots WHERE active = 1")) {
    if (!await claim(`pair:${bot.id}:${today()}`)) continue;
    await runPairBot(bot).catch(e => run('UPDATE pair_bots SET last_summary = ? WHERE id = ?', 'Error: ' + e.message.slice(0, 200), bot.id));
    n++;
  }
  return n;
}

// ---------- API ----------

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const upgrade = feature => Object.assign(new Error(`${feature} is part of the Pro plan`), { status: 402, upgrade: true, feature });
function params(b) {
  const o = { ...DEFAULTS };
  for (const [k, lo, hi] of [['lookback', 60, 1000], ['zWindow', 10, 250], ['entryZ', 0.5, 5], ['exitZ', 0, 3], ['stopZ', 1, 10], ['maxDays', 1, 250]])
    if (b[k] !== undefined && b[k] !== '') { const v = +b[k]; if (!Number.isFinite(v) || v < lo || v > hi) throw bad(`${k} must be between ${lo} and ${hi}`); o[k] = v; }
  if (o.exitZ >= o.entryZ) throw bad('The exit level must be below the entry level');
  if (o.stopZ <= o.entryZ) throw bad('The stop level must be above the entry level');
  return o;
}
const sym = v => { const s = String(v || '').trim().toUpperCase(); if (!validSymbol(s)) throw bad(`"${v}" is not a valid ticker`); return s; };

export const router = express.Router();
router.use(requireUser);
router.post('/analyze', async (req, res) => {
  const a = sym(req.body.a), b = sym(req.body.b);
  if (a === b) throw bad('Pick two different tickers');
  const o = params(req.body), d = await loadPair(a, b, req.user.id);
  res.json({ a, b, params: o, ...analyze(d, o), backtest: backtestPair(d, o), source: d.source });
});
router.post('/scan', async (req, res) => {
  const list = (Array.isArray(req.body.pairs) && req.body.pairs.length ? req.body.pairs : POPULAR).slice(0, 30);
  const o = params(req.body), out = [];
  for (const [x, y] of list) {
    try {
      const a = sym(x), b = sym(y), d = await loadPair(a, b, req.user.id), an = analyze(d, o);
      out.push({ a, b, adf: an.adf, cointegrated: an.cointegrated, halfLife: an.halfLife, z: an.z, correlation: an.correlation, signal: an.signal, beta: an.beta });
    } catch (e) { out.push({ a: x, b: y, error: e.message }); }
  }
  out.sort((p, q) => (p.error ? 1 : 0) - (q.error ? 1 : 0) || p.adf - q.adf);
  res.json(out);
});
router.get('/bots', async (req, res) => {
  res.json((await all('SELECT * FROM pair_bots WHERE user_id = ? ORDER BY id', req.user.id)).map(b => ({ ...b, params: JSON.parse(b.params), state: JSON.parse(b.state || '{}') })));
});
router.post('/bots', async (req, res) => {
  if (!isPaid(req.user)) throw upgrade('Automatic pairs trading');
  const a = sym(req.body.a), b = sym(req.body.b), o = params(req.body);
  const account = ACCOUNT_IDS.includes(req.body.account) ? req.body.account : 'paper';
  if (account !== 'paper' && !isPaid(req.user)) throw upgrade('Pair bots on your brokerage account');
  const mode = req.body.mode === 'neutral' ? 'neutral' : 'long_only';
  if (mode === 'neutral' && account === 'paper') throw bad('The paper account cannot sell short. Use "long only", or run market-neutral on a margin brokerage account.');
  const capital = +req.body.capital;
  if (!(capital >= 100 && capital <= 10e6)) throw bad('Money per pair must be between $100 and $10,000,000');
  if ((await one('SELECT COUNT(*) n FROM pair_bots WHERE user_id = ?', req.user.id)).n >= 20) throw bad('Up to 20 pair bots');
  const r = await run('INSERT INTO pair_bots (user_id, a, b, params, account, mode, capital, active, created_at) VALUES (?,?,?,?,?,?,?,1,?)', req.user.id, a, b, JSON.stringify(o), account, mode, capital, now());
  res.json({ id: r.lastInsertRowid });
});
router.post('/bots/:id/run', async (req, res) => {
  const bot = await one('SELECT * FROM pair_bots WHERE id = ? AND user_id = ?', +req.params.id, req.user.id);
  if (!bot) throw bad('Not found', 404);
  res.json({ summary: await runPairBot(bot) });
});
router.post('/bots/:id/active', async (req, res) => {
  await run('UPDATE pair_bots SET active = ? WHERE id = ? AND user_id = ?', req.body.active ? 1 : 0, +req.params.id, req.user.id);
  res.json({ ok: true });
});
router.delete('/bots/:id', async (req, res) => {
  await run('DELETE FROM pair_bots WHERE id = ? AND user_id = ?', +req.params.id, req.user.id);
  res.json({ ok: true });
});
