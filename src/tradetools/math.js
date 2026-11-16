// The arithmetic behind the planning tools (docs/TRADING_TOOLS.md explains each in plain language).
// Pure functions: no market data, no orders, no account changes. Every result is a calculation the
// user can check by hand; the tests check them against worked examples.
const bad = (message, field) => Object.assign(new Error(message), { status: 400, field });
const num = (v, field, { min = -Infinity, max = Infinity, gt } = {}) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw bad(`${field} must be a number`, field);
  if (gt !== undefined && !(n > gt)) throw bad(`${field} must be greater than ${gt}`, field);
  if (n < min || n > max) throw bad(`${field} must be between ${min} and ${max}`, field);
  return n;
};
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

// ---------- position size ----------
// shares = (account size x risk %) / (distance from entry to stop), rounded DOWN to whole lots,
// and never more than the largest position the user allows (max position % of the account).
export function positionSize(input = {}) {
  const side = input.side === 'short' ? 'short' : 'long';
  const equity = num(input.equity, 'Account size', { gt: 0, max: 1e12 });
  const riskPct = num(input.riskPct, 'Risk per trade %', { gt: 0, max: 100 });
  const entry = num(input.entry, 'Entry price', { gt: 0 });
  const stop = num(input.stop, 'Stop price', { gt: 0 });
  const maxPositionPct = input.maxPositionPct == null || input.maxPositionPct === '' ? 100 : num(input.maxPositionPct, 'Largest position %', { gt: 0, max: 100 });
  const lot = input.lot == null || input.lot === '' ? 1 : num(input.lot, 'Lot size', { gt: 0 });
  if (side === 'long' && !(stop < entry)) throw bad('For a long trade the stop must be below the entry', 'stop');
  if (side === 'short' && !(stop > entry)) throw bad('For a short trade the stop must be above the entry', 'stop');
  const riskPerShare = Math.abs(entry - stop), riskBudget = equity * riskPct / 100;
  const byRisk = riskBudget / riskPerShare, byCap = equity * maxPositionPct / 100 / entry;
  const floorLots = x => Math.floor(x / lot + 1e-9) * lot; // 1e-9: 49.999999 from floating point counts as 50
  const shares = floorLots(Math.min(byRisk, byCap));
  return {
    side, shares, riskPerShare: round(riskPerShare, 4), riskBudget: round(riskBudget),
    positionValue: round(shares * entry), positionPct: round(shares * entry / equity * 100),
    risk: round(shares * riskPerShare), riskPctActual: round(shares * riskPerShare / equity * 100, 3),
    limitedBy: byCap < byRisk ? 'largest position' : 'risk per trade',
    sharesByRisk: floorLots(byRisk), sharesByCap: floorLots(byCap),
  };
}

// ---------- risk / reward ----------
// R = reward / risk for each target. The win rate needed to break even at R (ignoring costs) is
// 1 / (1 + R). With a win rate p, the expectancy per trade in R is p x R - (1 - p).
export function riskReward(input = {}) {
  const side = input.side === 'short' ? 'short' : 'long';
  const entry = num(input.entry, 'Entry price', { gt: 0 }), stop = num(input.stop, 'Stop price', { gt: 0 });
  if (side === 'long' && !(stop < entry)) throw bad('For a long trade the stop must be below the entry', 'stop');
  if (side === 'short' && !(stop > entry)) throw bad('For a short trade the stop must be above the entry', 'stop');
  const targets = (Array.isArray(input.targets) ? input.targets : [input.targets]).filter(t => t !== undefined && t !== null && t !== '').slice(0, 5).map((t, i) => num(t, `Target ${i + 1}`, { gt: 0 }));
  if (!targets.length) throw bad('Add at least one target price', 'targets');
  const cost = input.costPerShare == null || input.costPerShare === '' ? 0 : num(input.costPerShare, 'Costs per share', { min: 0 });
  const winRate = input.winRate == null || input.winRate === '' ? null : num(input.winRate, 'Win rate %', { min: 0, max: 100 }) / 100;
  const risk = Math.abs(entry - stop) + cost;
  const rows = targets.map((t, i) => {
    const gross = side === 'long' ? t - entry : entry - t;
    if (!(gross > 0)) throw bad(`Target ${i + 1} must be ${side === 'long' ? 'above' : 'below'} the entry`, `targets.${i}`);
    const reward = gross - cost, r = reward / risk;
    return { target: t, reward: round(reward, 4), r: round(r, 2), breakevenWinRate: round(100 / (1 + r), 1), expectancyR: winRate == null ? null : round(winRate * r - (1 - winRate), 3) };
  });
  return { side, risk: round(risk, 4), targets: rows, winRate: winRate == null ? null : round(winRate * 100, 2) };
}

// ---------- average true range (Wilder) ----------
// True range = the largest of: high - low, |high - previous close|, |low - previous close|.
// The first ATR is the plain average of the first n true ranges; after that
// ATR = (previous ATR x (n - 1) + today's true range) / n.
export function atr(bars, n = 14) {
  if (!Array.isArray(bars) || bars.length < n + 1) return null;
  const tr = [];
  for (let i = 1; i < bars.length; i++) { const { h, l } = bars[i], pc = bars[i - 1].c; tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))); }
  let a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}
// A stop a chosen number of ATRs away from the entry (below for a long, above for a short).
export function atrStop({ entry, atrValue, multiple = 2, side = 'long' }) {
  const e = num(entry, 'Entry price', { gt: 0 }), a = num(atrValue, 'ATR', { gt: 0 }), m = num(multiple, 'ATR multiple', { gt: 0, max: 20 });
  const stop = side === 'short' ? e + a * m : e - a * m;
  return { stop: round(stop, 4), distance: round(a * m, 4), distancePct: round(a * m / e * 100, 2), valid: stop > 0 };
}

// ---------- concentration ----------
// Weights of each holding; the share held by the largest 1, 3 and 5; the Herfindahl-Hirschman
// index (sum of squared weights, 0 to 1) and the "effective number of holdings" 1 / HHI.
export function concentration(holdings) {
  const list = (Array.isArray(holdings) ? holdings : []).slice(0, 500)
    .map(h => ({ symbol: String(h.symbol || '').toUpperCase().slice(0, 12), value: Math.abs(Number(h.value)), sector: h.sector ? String(h.sector).slice(0, 40) : null }))
    .filter(h => h.symbol && Number.isFinite(h.value) && h.value > 0);
  const total = list.reduce((a, h) => a + h.value, 0);
  if (!list.length || !(total > 0)) throw bad('Add at least one holding with a value', 'holdings');
  const w = list.map(h => ({ ...h, weight: h.value / total })).sort((a, b) => b.weight - a.weight);
  const top = k => round(w.slice(0, k).reduce((a, h) => a + h.weight, 0) * 100, 1);
  const hhi = w.reduce((a, h) => a + h.weight ** 2, 0), sectors = {};
  for (const h of w) if (h.sector) sectors[h.sector] = (sectors[h.sector] || 0) + h.weight;
  return {
    count: w.length, top1: top(1), top3: top(3), top5: top(5), hhi: round(hhi, 4), effectiveN: round(1 / hhi, 2),
    largest: { symbol: w[0].symbol, weight: round(w[0].weight * 100, 1) },
    weights: w.map(h => ({ symbol: h.symbol, weight: round(h.weight * 100, 2), sector: h.sector })),
    sectors: Object.entries(sectors).map(([s, x]) => ({ sector: s, weight: round(x * 100, 1) })).sort((a, b) => b.weight - a.weight),
  };
}

// ---------- sector heatmap ----------
// The eleven Select Sector SPDR funds stand for the S&P 500 sectors. This is a fixed list of tickers,
// not market data: the prices come from the data feed when the page is opened.
export const SECTOR_ETFS = [['XLK', 'Technology'], ['XLF', 'Financials'], ['XLV', 'Health care'], ['XLE', 'Energy'], ['XLI', 'Industrials'], ['XLY', 'Consumer discretionary'], ['XLP', 'Consumer staples'], ['XLU', 'Utilities'], ['XLB', 'Materials'], ['XLRE', 'Real estate'], ['XLC', 'Communication services']];
export function heatmap(snaps, now = Date.now()) {
  return SECTOR_ETFS.map(([symbol, sector]) => {
    const s = snaps?.[symbol];
    const price = s?.latestTrade?.p ?? s?.dailyBar?.c ?? null, prev = s?.prevDailyBar?.c ?? null, at = Date.parse(s?.latestTrade?.t || s?.dailyBar?.t || '') || null;
    return { symbol, sector, price, changePct: price != null && prev ? round((price / prev - 1) * 100, 2) : null, asOf: at, ageMin: at ? Math.max(0, Math.round((now - at) / 60e3)) : null };
  }).sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
}
