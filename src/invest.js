// Long-term investing and analysis:
//   - Stock & fund analyzer: fundamentals (P/E, P/B, P/S, margins, growth, debt), technical analysis
//     (trend, moving averages, RSI, MACD, 52-week range, momentum) and earnings vs expectations
//   - Low-cost index funds and mutual funds side by side (yearly cost, minimum, what they hold)
//   - New leaders: stocks that just became market leaders (relative strength jumped into the top
//     fifth, near or at a 52-week high, moving averages lined up)
//   - Short the market: every way to bet on a fall, matched to the account (practice shorts with no
//     minimum, inverse ETFs for small accounts, short futures on practice, puts)
//   - Margin center: the account's margin numbers and the rules behind them (Reg T initial, FINRA and
//     house maintenance, pattern day trading), margin-call prices, and bid/ask with how market makers
//     handle an order
// Everything here describes; it does not tell anyone what to buy (Brightolio is software, not an
// investment adviser).
import express from 'express';
import { getBars, lastPrice, accountSummary } from './brokers.js';
import { requireUser } from './auth.js';
import { profile, UNIVERSE } from './fundamentals.js';
import { earnings, eventsEnabled } from './events.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const r2 = (x, d = 2) => (x == null || !Number.isFinite(+x) ? null : +(+x).toFixed(d));
const ago = days => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
const SYM = /^[A-Z][A-Z0-9.\-]{0,9}$/;

// ---------- technical analysis ----------
const sma = (a, n) => (a.length >= n ? a.slice(-n).reduce((s, x) => s + x, 0) / n : null);
const emaSeries = (a, n) => { const k = 2 / (n + 1), out = []; let e = a[0]; for (const x of a) { e = x * k + e * (1 - k); out.push(e); } return out; };
export function rsi(a, n = 14) {
  if (a.length <= n) return null;
  let up = 0, dn = 0;
  for (let i = 1; i <= n; i++) { const d = a[i] - a[i - 1]; d > 0 ? (up += d) : (dn -= d); }
  up /= n; dn /= n;
  for (let i = n + 1; i < a.length; i++) { const d = a[i] - a[i - 1]; up = (up * (n - 1) + Math.max(d, 0)) / n; dn = (dn * (n - 1) + Math.max(-d, 0)) / n; }
  return dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
}
export function technicals(closes) {
  const c = closes.filter(Number.isFinite), n = c.length, last = c.at(-1);
  if (n < 30) return null;
  const s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200);
  const e26 = emaSeries(c, 26), macdLine = emaSeries(c, 12).map((x, i) => x - e26[i]), signal = emaSeries(macdLine, 9);
  const yr = c.slice(-252), hi = Math.max(...yr), lo = Math.min(...yr);
  const back = k => (n > k ? r2((last / c[n - 1 - k] - 1) * 100, 1) : null);
  const rets = c.slice(-64).map((x, i, a) => (i ? Math.log(x / a[i - 1]) : 0)).slice(1), m = rets.reduce((s, x) => s + x, 0) / (rets.length || 1);
  const vol = rets.length > 5 ? Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252) * 100 : null;
  const trend = s50 && s200 ? (last > s50 && s50 > s200 ? 'Uptrend' : last < s50 && s50 < s200 ? 'Downtrend' : 'Sideways') : last > s50 ? 'Above its 50-day average' : 'Below its 50-day average';
  const R = rsi(c), M = macdLine.at(-1), S = signal.at(-1);
  const notes = [];
  if (s50 && s200) notes.push(s50 > s200 ? 'The 50-day average is above the 200-day (often called a "golden cross" setup).' : 'The 50-day average is below the 200-day (often called a "death cross" setup).');
  if (R != null) notes.push(R >= 70 ? `RSI ${r2(R, 0)}: overbought by the usual reading (70+).` : R <= 30 ? `RSI ${r2(R, 0)}: oversold by the usual reading (30 or less).` : `RSI ${r2(R, 0)}: neither overbought nor oversold.`);
  notes.push(M > S ? 'MACD is above its signal line (momentum improving).' : 'MACD is below its signal line (momentum fading).');
  notes.push(`${r2((last / hi - 1) * 100, 1)}% from the 52-week high, ${r2((last / lo - 1) * 100, 1)}% above the low.`);
  return { price: r2(last), sma20: r2(s20), sma50: r2(s50), sma200: r2(s200), rsi14: r2(R, 1), macd: r2(M, 3), macdSignal: r2(S, 3), high52: r2(hi), low52: r2(lo), rangePos: hi > lo ? r2((last - lo) / (hi - lo) * 100, 0) : null, change1m: back(21), change3m: back(63), change6m: back(126), change1y: back(252), volatility: r2(vol, 1), trend, notes };
}

// ---------- earnings vs expectations ----------
export function earningsScore(h) {
  const rows = (h || []).filter(x => x.eps != null && x.estimate != null);
  const beats = rows.filter(x => x.eps > x.estimate).length, misses = rows.filter(x => x.eps < x.estimate).length;
  const avg = rows.length ? rows.reduce((s, x) => s + (x.surprisePct ?? (x.estimate ? (x.eps / x.estimate - 1) * 100 : 0)), 0) / rows.length : null;
  return { quarters: rows.length, beats, misses, inLine: rows.length - beats - misses, avgSurprisePct: r2(avg, 1), summary: rows.length ? `Beat estimates ${beats} of the last ${rows.length} quarters${avg != null ? `, by ${r2(avg, 1)}% on average` : ''}.` : null };
}
async function earningsFor(symbol) {
  if (!eventsEnabled()) return { available: false, note: 'Analyst estimates need the free Finnhub key (FINNHUB_API_KEY) in Admin → Keys.' };
  try { const e = await earnings(symbol); return { available: true, ...e, score: earningsScore(e.history) }; } catch (e) { return { available: false, note: e.message }; }
}

// ---------- low-cost index funds and mutual funds ----------
// [name, kind, what it holds, yearly cost %, minimum $, managed, family]. Costs and minimums as
// published by the fund companies (2025); always check the fund's own page before investing.
export const FUNDS = {
  VOO: ['Vanguard S&P 500 ETF', 'ETF', 'S&P 500: 500 large US companies', 0.03, 0, 'Index', 'Vanguard'],
  IVV: ['iShares Core S&P 500 ETF', 'ETF', 'S&P 500', 0.03, 0, 'Index', 'BlackRock'],
  SPLG: ['SPDR Portfolio S&P 500 ETF', 'ETF', 'S&P 500', 0.02, 0, 'Index', 'State Street'],
  VTI: ['Vanguard Total Stock Market ETF', 'ETF', 'The whole US stock market', 0.03, 0, 'Index', 'Vanguard'],
  SCHB: ['Schwab US Broad Market ETF', 'ETF', 'The whole US stock market', 0.03, 0, 'Index', 'Schwab'],
  VXUS: ['Vanguard Total International Stock ETF', 'ETF', 'Stocks outside the US', 0.05, 0, 'Index', 'Vanguard'],
  VT: ['Vanguard Total World Stock ETF', 'ETF', 'The whole world stock market', 0.06, 0, 'Index', 'Vanguard'],
  QQQM: ['Invesco Nasdaq 100 ETF', 'ETF', 'Nasdaq-100: large, tech-heavy', 0.15, 0, 'Index', 'Invesco'],
  SCHD: ['Schwab US Dividend Equity ETF', 'ETF', 'Dividend-paying US companies', 0.06, 0, 'Index', 'Schwab'],
  VIG: ['Vanguard Dividend Appreciation ETF', 'ETF', 'Companies that raise dividends', 0.05, 0, 'Index', 'Vanguard'],
  BND: ['Vanguard Total Bond Market ETF', 'ETF', 'US investment-grade bonds', 0.03, 0, 'Index', 'Vanguard'],
  AGG: ['iShares Core US Aggregate Bond ETF', 'ETF', 'US investment-grade bonds', 0.03, 0, 'Index', 'BlackRock'],
  SGOV: ['iShares 0-3 Month Treasury Bond ETF', 'ETF', 'Treasury bills (cash-like)', 0.09, 0, 'Index', 'BlackRock'],
  VNQ: ['Vanguard Real Estate ETF', 'ETF', 'US real estate companies (REITs)', 0.13, 0, 'Index', 'Vanguard'],
  FXAIX: ['Fidelity 500 Index Fund', 'Mutual fund', 'S&P 500', 0.015, 0, 'Index', 'Fidelity'],
  SWPPX: ['Schwab S&P 500 Index Fund', 'Mutual fund', 'S&P 500', 0.02, 0, 'Index', 'Schwab'],
  VFIAX: ['Vanguard 500 Index Admiral', 'Mutual fund', 'S&P 500', 0.04, 3000, 'Index', 'Vanguard'],
  FSKAX: ['Fidelity Total Market Index Fund', 'Mutual fund', 'The whole US stock market', 0.015, 0, 'Index', 'Fidelity'],
  VTSAX: ['Vanguard Total Stock Market Index Admiral', 'Mutual fund', 'The whole US stock market', 0.04, 3000, 'Index', 'Vanguard'],
  FTIHX: ['Fidelity Total International Index Fund', 'Mutual fund', 'Stocks outside the US', 0.06, 0, 'Index', 'Fidelity'],
  VTIAX: ['Vanguard Total International Stock Index Admiral', 'Mutual fund', 'Stocks outside the US', 0.09, 3000, 'Index', 'Vanguard'],
  FXNAX: ['Fidelity US Bond Index Fund', 'Mutual fund', 'US investment-grade bonds', 0.025, 0, 'Index', 'Fidelity'],
  VBTLX: ['Vanguard Total Bond Market Index Admiral', 'Mutual fund', 'US investment-grade bonds', 0.04, 3000, 'Index', 'Vanguard'],
  VFIFX: ['Vanguard Target Retirement 2050', 'Mutual fund', 'Stocks and bonds, safer as 2050 nears', 0.08, 1000, 'Index (target date)', 'Vanguard'],
  VWELX: ['Vanguard Wellington Fund', 'Mutual fund', 'About 65% stocks, 35% bonds', 0.25, 3000, 'Actively managed', 'Vanguard'],
  PRWCX: ['T. Rowe Price Capital Appreciation', 'Mutual fund', 'Stocks and bonds, actively balanced', 0.70, 2500, 'Actively managed', 'T. Rowe Price'],
  FCNTX: ['Fidelity Contrafund', 'Mutual fund', 'Large US growth companies', 0.39, 0, 'Actively managed', 'Fidelity'],
  DODGX: ['Dodge & Cox Stock Fund', 'Mutual fund', 'Large US value companies', 0.51, 2500, 'Actively managed', 'Dodge & Cox'],
};
export const fundRows = () => Object.entries(FUNDS).map(([symbol, [name, kind, holds, cost, min, managed, family]]) => ({ symbol, name, kind, holds, cost, min, managed, family, per10k: r2(cost * 100, 2), cost30y: r2(100000 * (1.07 ** 30 - (1.07 - cost / 100) ** 30), 0) }));

// ---------- new leaders ----------
// A relative-strength score like the ones used by growth investors: the weighted 3/6/9/12-month
// return (the last quarter counts double), ranked against the scanned stocks (1 to 99).
export const rsRaw = (c, end = c.length) => { const at = k => c[end - 1 - k], last = c[end - 1]; if (end < 253) return null; return 2 * (last / at(63) - 1) + (last / at(126) - 1) + (last / at(189) - 1) + (last / at(252) - 1); };
export function leaders(series) {
  // series: { SYMBOL: closes[] } with at least ~1.3 years of daily closes.
  const rows = Object.entries(series).map(([symbol, c]) => ({ symbol, c, now: rsRaw(c), before: rsRaw(c, c.length - 63) })).filter(r => r.now != null);
  const rank = (k, v) => { const xs = rows.map(r => r[k]).filter(x => x != null).sort((a, b) => a - b); return v == null || !xs.length ? null : Math.max(1, Math.min(99, Math.round(xs.filter(x => x <= v).length / xs.length * 99))); };
  return rows.map(r => {
    const c = r.c, last = c.at(-1), hi = Math.max(...c.slice(-252)), s50 = sma(c, 50), s200 = sma(c, 200);
    const newHigh = c.slice(-10).some((x, i, a) => x >= Math.max(...c.slice(-262 + i, c.length - 10 + i)));
    const rs = rank('now', r.now), rsBefore = rank('before', r.before);
    const leader = rs >= 80 && last >= hi * 0.95 && s50 > s200 && last > s50;
    return { symbol: r.symbol, price: r2(last), rs, rsBefore, rsChange: rs != null && rsBefore != null ? rs - rsBefore : null, fromHigh: r2((last / hi - 1) * 100, 1), newHigh, aboveAverages: last > s50 && s50 > s200, leader, isNew: leader && (rsBefore == null || rsBefore < 70), change3m: r2((last / c[c.length - 64] - 1) * 100, 1) };
  }).sort((a, b) => (b.isNew - a.isNew) || (b.leader - a.leader) || b.rs - a.rs);
}
let leaderCache = { at: 0, v: null };
async function scanLeaders(userId) {
  if (leaderCache.v && Date.now() - leaderCache.at < 6 * 3600e3) return leaderCache.v;
  const series = {};
  const list = UNIVERSE.slice(0, 120);
  for (let i = 0; i < list.length; i += 12) await Promise.all(list.slice(i, i + 12).map(async s => { const b = await getBars(s, ago(560), userId).catch(() => null); if (b?.closes?.length > 260) series[s] = b.closes; }));
  const rows = leaders(series);
  leaderCache = { at: Date.now(), v: { scanned: rows.length, at: Date.now(), rows } };
  return leaderCache.v;
}

// ---------- short the market ----------
export const INVERSE = [
  ['SH', 'S&P 500', -1], ['PSQ', 'Nasdaq-100', -1], ['DOG', 'Dow Jones', -1], ['RWM', 'Russell 2000 (small companies)', -1],
  ['SDS', 'S&P 500', -2], ['QID', 'Nasdaq-100', -2], ['SPXU', 'S&P 500', -3], ['SQQQ', 'Nasdaq-100', -3], ['TBF', '20+ year Treasury bonds', -1],
];
export function shortPaths(acct) {
  const eq = acct?.equity ?? 0, paper = acct?.account === 'paper', canMargin = paper || eq >= 2000;
  return [
    { id: 'short', title: 'Sell short', available: canMargin, how: paper ? 'Practice account: short any stock with no minimum balance. Sell it on the Trade page and tick "Sell short"; buy it back to close.' : eq >= 2000 ? 'Your account has $2,000 or more: a margin account can short stocks the broker can borrow. Tick "Sell short" on the Trade page.' : `Real accounts need a margin account with at least $2,000 to sell short (this one has $${Math.round(eq).toLocaleString('en-US')}). Use an inverse ETF instead, or practice on paper.`, risk: 'Losses have no limit if the price keeps rising; borrowing fees and margin calls apply.' },
    { id: 'inverse', title: 'Buy an inverse ETF', available: true, how: 'Works in any account, even a small cash account: the fund rises when the index falls. You can lose only what you put in.', risk: 'They reset every day, so over weeks the result drifts from the index (more for 2x and 3x funds). Meant for short holding periods.' },
    { id: 'futures', title: 'Short index futures', available: true, how: 'Practice: sell Micro E-mini contracts (MES, MNQ) under Futures, funds & savings → Futures. Real futures need a futures brokerage (Alpaca does not offer them).', risk: 'Leveraged: a small move is a large gain or loss; margin calls are daily.' },
    { id: 'puts', title: 'Buy put options', available: true, how: 'A put gains when the price falls below its strike; the most you lose is what you paid. Options chain → puts (options approval needed on a real account).', risk: 'Time works against you: a put loses value every day the drop does not come.' },
  ];
}

// ---------- margin ----------
// The rules every US margin account works under, and the broker's own (house) rules on top.
export const MARGIN_RULES = {
  minimum: 2000, pdt: 25000, initial: 0.5, finraMaintenance: 0.25, houseMaintenance: 0.3, shortInitial: 1.5,
  explain: [
    ['Minimum to open margin', '$2,000 (FINRA rule 4210). Below that the account is a cash account: no borrowing and no short selling.'],
    ['Initial margin (Reg T)', 'You can borrow up to 50% of a stock purchase: $10,000 of stock needs $5,000 of your own money. Overnight buying power is therefore 2x equity.'],
    ['Pattern day trader', '4 or more day trades in 5 business days in a margin account needs $25,000 equity; with it, intraday buying power is up to 4x.'],
    ['Maintenance margin', 'Your equity must stay at least 25% of the stocks held (FINRA minimum). Brokers set a higher "house" requirement, commonly 30%, and more for volatile, low-priced or leveraged holdings.'],
    ['Short sales', 'Selling short needs 150% of the short value at the start: the sale proceeds plus 50% of your own. Maintenance on shorts is commonly 30% or more.'],
    ['Margin call', 'If equity falls below maintenance, the broker asks for more money or sells positions, sometimes without waiting.'],
    ['Interest', 'Borrowed money is charged interest daily, at the broker\'s margin rate.'],
  ],
};
// The price at which a long position on margin hits the maintenance requirement: loan / (shares x (1 - m)).
export const callPrice = (loan, shares, m = MARGIN_RULES.houseMaintenance) => (shares > 0 && loan > 0 ? r2(loan / (shares * (1 - m))) : null);
async function marginCenter(userId, account) {
  const s = await accountSummary(userId, account);
  let a = null;
  if (/^alpaca/.test(account)) {
    try { const { requireTradingFor } = await import('./alpaca/connections.js'); a = await (await requireTradingFor(userId, account)).account(); } catch { a = null; }
  }
  const equity = s.equity, long = s.positions.filter(p => p.qty > 0).reduce((t, p) => t + p.value, 0), short = -s.positions.filter(p => p.qty < 0).reduce((t, p) => t + p.value, 0);
  const loan = Math.max(0, -s.cash), m = a ? +a.maintenance_margin : (long + short) * MARGIN_RULES.houseMaintenance;
  const qualifies = account === 'paper' ? { margin: true, shorting: true, pdt: equity >= MARGIN_RULES.pdt, note: 'Practice account: margin rules are simulated, shorting has no minimum.' } : { margin: equity >= MARGIN_RULES.minimum && (a ? +a.multiplier > 1 : true), shorting: a ? !!a.shorting_enabled && equity >= MARGIN_RULES.minimum : equity >= MARGIN_RULES.minimum, pdt: equity >= MARGIN_RULES.pdt, note: equity < MARGIN_RULES.minimum ? `Under $2,000 of equity: a cash account (no margin, no shorting). $${Math.round(MARGIN_RULES.minimum - equity).toLocaleString('en-US')} more would qualify.` : equity < MARGIN_RULES.pdt ? 'Margin up to 2x overnight. Day trading is limited to 3 day trades in 5 days until equity reaches $25,000.' : 'Margin up to 2x overnight and up to 4x during the day (pattern day trader level).' };
  return {
    account, live: !!s.live, equity: r2(equity), cash: r2(s.cash), long: r2(long), short: r2(short), loan: r2(loan),
    broker: a ? { multiplier: +a.multiplier, buyingPower: +a.buying_power, regtBuyingPower: +a.regt_buying_power, daytradingBuyingPower: +a.daytrading_buying_power, initialMargin: +a.initial_margin, maintenanceMargin: +a.maintenance_margin, lastMaintenance: +a.last_maintenance_margin, dayTrades: +a.daytrade_count, patternDayTrader: !!a.pattern_day_trader, shortingEnabled: !!a.shorting_enabled } : null,
    maintenance: r2(m), cushion: r2(equity - m), cushionPct: equity > 0 ? r2((equity - m) / equity * 100, 1) : null, qualifies,
    positions: s.positions.map(p => ({ symbol: p.symbol, qty: p.qty, price: r2(p.price), value: r2(p.value), callPrice: p.qty > 0 && loan > 0 && long > 0 ? callPrice(loan * (p.value / long), p.qty) : null })),
    rules: MARGIN_RULES,
  };
}

export const investRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/analyze/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase(); if (!SYM.test(symbol)) throw bad('Check the symbol');
    const [p, bars, e] = await Promise.all([profile(symbol, req.user.id).catch(err => ({ error: err.message })), getBars(symbol, ago(560), req.user.id).catch(() => null), earningsFor(symbol)]);
    if (p.error && !bars) throw bad(p.error, 404);
    res.json({ symbol, profile: p.error ? null : p, technical: bars ? technicals(bars.closes) : null, earnings: e, fund: FUNDS[symbol] ? fundRows().find(f => f.symbol === symbol) : null, source: bars?.source || null });
  });
  r.get('/funds', (req, res) => res.json({ funds: fundRows() }));
  r.get('/earnings', async (req, res) => {
    const list = String(req.query.symbols || '').toUpperCase().split(/[\s,]+/).filter(s => SYM.test(s)).slice(0, 20);
    let syms = list;
    if (!syms.length) syms = (await accountSummary(req.user.id, req.query.account || 'paper').catch(() => ({ positions: [] }))).positions.map(p => p.symbol).filter(s => !s.includes('/')).slice(0, 20);
    if (!eventsEnabled()) return res.json({ available: false, note: 'Analyst estimates need the free Finnhub key (FINNHUB_API_KEY) in Admin → Keys.', symbols: syms, rows: [] });
    const rows = [];
    for (const s of syms) { const x = await earningsFor(s); rows.push({ symbol: s, ...x }); }
    res.json({ available: true, symbols: syms, rows });
  });
  r.get('/leaders', async (req, res) => res.json(await scanLeaders(req.user.id)));
  r.get('/short', async (req, res) => {
    const account = req.query.account || 'paper', s = await accountSummary(req.user.id, account).catch(() => null);
    const prices = {}; await Promise.all(INVERSE.map(async ([sym]) => { prices[sym] = await lastPrice(sym, req.user.id).catch(() => null); }));
    res.json({ account, equity: s?.equity ?? null, paths: shortPaths(s ? { ...s, account } : { account }), inverse: INVERSE.map(([symbol, index, x]) => ({ symbol, index, leverage: x, price: r2(prices[symbol]) })), shorts: (s?.positions || []).filter(p => p.qty < 0) });
  });
  r.get('/margin', async (req, res) => res.json(await marginCenter(req.user.id, req.query.account || 'paper')));
  return r;
})();
