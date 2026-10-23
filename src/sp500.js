// S&P 500: the index's record (through SPY, dividends included), a projection for a monthly
// investing plan resampled from real history, and automatic monthly buys of an index fund.
import express from 'express';
import { all, run, now } from './db.js';
import { getBars, ACCOUNT_IDS } from './brokers.js';
import { metrics, rng } from './engine.js';
import { requireUser } from './auth.js';
import { isPaid } from './fees.js';
import { nextRunAfter } from './scheduler.js';

// Funds that track the S&P 500, with their yearly costs (expense ratios).
export const FUNDS = [
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', fee: 0.03 },
  { symbol: 'SPLG', name: 'SPDR Portfolio S&P 500 ETF', fee: 0.02 },
  { symbol: 'IVV', name: 'iShares Core S&P 500 ETF', fee: 0.03 },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', fee: 0.0945 },
];
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const upgrade = feature => Object.assign(new Error(`${feature} is part of the Pro plan`), { status: 402, upgrade: true, feature });

let cache = null;
async function history(userId) {
  if (cache && now() - cache.at < 6 * 3600e3) return cache.v;
  const b = await getBars('SPY', '1994-01-01', userId);
  // Month-end closes → monthly returns (adjusted closes include dividends).
  const months = [];
  b.dates.forEach((d, i) => { const m = d.slice(0, 7); if (!months.length || months[months.length - 1].m !== m) months.push({ m, c: b.closes[i] }); else months[months.length - 1].c = b.closes[i]; });
  const monthly = months.slice(1).map((x, i) => x.c / months[i].c - 1);
  cache = { at: now(), v: { closes: b.closes, dates: b.dates, monthly, source: b.source } };
  return cache.v;
}

export function stats(h) {
  const n = h.closes.length, last = h.closes[n - 1];
  const back = days => (n > days ? (last / h.closes[n - 1 - days] - 1) * 100 : null);
  const cagr = years => (n > years * 252 ? ((last / h.closes[n - 1 - years * 252]) ** (1 / years) - 1) * 100 : null);
  const ytdBase = h.closes[h.dates.findIndex(d => d.slice(0, 4) === h.dates[n - 1].slice(0, 4)) - 1];
  const yearly = {};
  h.dates.forEach((d, i) => { const y = d.slice(0, 4); yearly[y] ||= { first: i ? h.closes[i - 1] : h.closes[0] }; yearly[y].last = h.closes[i]; });
  const years = Object.entries(yearly).map(([y, v]) => ({ year: +y, ret: (v.last / v.first - 1) * 100 }));
  const m = metrics(h.closes.slice(-Math.min(n, 252 * 30)));
  return { price: last, day: h.dates[n - 1], ytd: ytdBase ? (last / ytdBase - 1) * 100 : null, y1: back(252), cagr3: cagr(3), cagr5: cagr(5), cagr10: cagr(10), cagrAll: m.cagr, maxDrawdown: m.dd, since: h.dates[Math.max(0, n - 252 * 30)], years: years.slice(-30), worstYear: years.reduce((a, y) => (y.ret < a.ret ? y : a), years[0]), bestYear: years.reduce((a, y) => (y.ret > a.ret ? y : a), years[0]), source: h.source };
}

// Resamples 12-month blocks of real monthly returns: the projection keeps real crashes and
// recoveries instead of assuming a smooth average.
export function project(monthly, { initial = 0, perMonth = 0, years = 20, sims = 2000, fee = 0.03, seed = 11 } = {}) {
  const rand = rng(seed), months = years * 12, feeM = fee / 100 / 12, paths = [];
  for (let s = 0; s < sims; s++) {
    let v = initial, m = 0;
    const path = [v];
    while (m < months) {
      const start = Math.floor(rand() * Math.max(1, monthly.length - 12));
      for (let k = 0; k < 12 && m < months; k++, m++) { v = (v + perMonth) * (1 + monthly[start + k] - feeM); if (m % 12 === 11) path.push(v); }
    }
    paths.push(path);
  }
  const pick = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const bands = Array.from({ length: years + 1 }, (_, y) => { const col = paths.map(p => p[y]); return { year: y, p10: pick(col, 0.1), p50: pick(col, 0.5), p90: pick(col, 0.9) }; });
  const finals = paths.map(p => p[p.length - 1]), contributed = initial + perMonth * months;
  return { bands, contributed, p10: pick(finals, 0.1), p50: pick(finals, 0.5), p90: pick(finals, 0.9), lossChance: finals.filter(v => v < contributed).length / sims * 100 };
}

// Monthly amount that reaches `goal` in `years` at a yearly return `r` (%), after `initial`.
export function monthlyFor(goal, years, r, initial = 0) {
  const i = (1 + r / 100) ** (1 / 12) - 1, n = years * 12, fv0 = initial * (1 + i) ** n;
  return Math.max(0, (goal - fv0) * i / ((1 + i) ** n - 1));
}

export const router = express.Router();
router.use(requireUser);
router.get('/', async (req, res) => {
  const h = await history(req.user.id);
  const plans = await all("SELECT * FROM scheduled_orders WHERE user_id = ? AND active = 1 AND side = 'buy' AND symbol IN ('VOO','SPLG','IVV','SPY') ORDER BY id", req.user.id);
  const step = Math.max(1, Math.floor(h.closes.length / 400));
  res.json({ ...stats(h), funds: FUNDS, plans, chart: h.closes.filter((_, i) => i % step === 0 || i === h.closes.length - 1) });
});
router.post('/projection', async (req, res) => {
  const initial = Math.max(0, +req.body.initial || 0), perMonth = Math.max(0, +req.body.perMonth || 0), years = Math.round(Math.min(50, Math.max(1, +req.body.years || 20)));
  const fund = FUNDS.find(f => f.symbol === req.body.fund) || FUNDS[0];
  const h = await history(req.user.id);
  const p = project(h.monthly, { initial, perMonth, years, fee: fund.fee });
  const goal = +req.body.goal > 0 ? { goal: +req.body.goal, perMonthTypical: monthlyFor(+req.body.goal, years, Math.min(10, stats(h).cagrAll), initial) } : null;
  res.json({ ...p, years, fund, goal, months: h.monthly.length });
});
// Automatic buys of an S&P 500 fund. Free on the paper account; real accounts are part of Pro.
router.post('/plan', async (req, res) => {
  const fund = FUNDS.find(f => f.symbol === req.body.fund);
  if (!fund) throw bad('Pick a fund');
  const amount = +req.body.amount;
  if (!(amount >= 1 && amount <= 1e6)) throw bad('Amount must be between $1 and $1,000,000');
  const account = ACCOUNT_IDS.includes(req.body.account) ? req.body.account : 'paper';
  if (account !== 'paper' && !isPaid(req.user)) throw upgrade('Automatic investing in your brokerage account');
  const repeat = ['weekly', 'monthly'].includes(req.body.repeat) ? req.body.repeat : 'monthly';
  const day = Math.min(28, Math.max(1, Math.round(+req.body.day || 1)));
  // First run: the chosen day of this month (or next month if passed), 10:00 New York (≈ 14:00 UTC).
  const d = new Date(); d.setUTCDate(day); d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() < now()) {
    if (repeat === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1, day);
    else { const t = new Date(now() + 86400e3); d.setUTCFullYear(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()); }
  }
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  const r = await run('INSERT INTO scheduled_orders (user_id, account, symbol, side, qty, notional, repeat, next_run, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    req.user.id, account, fund.symbol, 'buy', null, amount, repeat, d.getTime(), now());
  res.json({ id: r.lastInsertRowid, nextRun: d.getTime(), nextAfter: nextRunAfter(d.getTime(), repeat) });
});
