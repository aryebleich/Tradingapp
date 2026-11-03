// Company fundamentals without a paid feed: the SEC's XBRL "frames" API gives one figure (revenue,
// net income, earnings per share, equity, shares) for every US filer in one call, refreshed weekly.
// With a price that gives market cap, P/E, P/B, margins and growth for:
//  - the profile of a stock (what it is, how big, how it has done, risk) or an ETF (cost, index);
//  - market-cap classes (mega, large, mid, small, micro) and blue chips;
//  - the growth and value screen.
import express from 'express';
import { requireUser } from './auth.js';
import { get, secData, secWww, secCached } from './institutions.js';
import { getBars, lastPrice } from './brokers.js';

const DAY = 864e5, r2 = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(d));
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ---------- SEC data ----------
export async function tickerCiks() {
  return secCached('sec:tickercik', 7 * DAY, async () => {
    const d = await get(`${secWww()}/files/company_tickers.json`), m = {};
    for (const r of Object.values(d)) if (!m[r.ticker]) m[r.ticker] = { cik: r.cik_str, name: r.title };
    return m;
  });
}
// One concept for every filer: { cik: value }.
async function frame(tag, unit, period, taxonomy = 'us-gaap') {
  return secCached(`sec:frame:${tag}:${period}`, 7 * DAY, async () => {
    const d = await get(`${secData()}/api/xbrl/frames/${taxonomy}/${tag}/${unit}/${period}.json`).catch(e => (e.status === 404 ? { data: [] } : Promise.reject(e)));
    const m = {}; for (const x of d.data || []) m[x.cik] = x.val; return m;
  });
}
// The last complete calendar year (annual reports are in by April).
export const fiscalYear = (t = Date.now()) => { const d = new Date(t); return d.getUTCFullYear() - (d.getUTCMonth() >= 3 ? 1 : 2); };
export async function frames(year = fiscalYear()) {
  const [rev1, rev2, revP1, revP2, ni, eps, epsP, eq, sh] = await Promise.all([
    frame('Revenues', 'USD', `CY${year}`), frame('RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', `CY${year}`),
    frame('Revenues', 'USD', `CY${year - 1}`), frame('RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', `CY${year - 1}`),
    frame('NetIncomeLoss', 'USD', `CY${year}`), frame('EarningsPerShareDiluted', 'USD-per-shares', `CY${year}`), frame('EarningsPerShareDiluted', 'USD-per-shares', `CY${year - 1}`),
    frame('StockholdersEquity', 'USD', `CY${year}Q4I`), frame('WeightedAverageNumberOfDilutedSharesOutstanding', 'shares', `CY${year}`),
  ]);
  return { year, rev1, rev2, revP1, revP2, ni, eps, epsP, eq, sh };
}
export function fundamentalsFromFrames(f, cik) {
  const pick = (a, b) => { const x = a[cik], y = b[cik]; return x == null ? y ?? null : y == null ? x : Math.max(x, y); };
  const revenue = pick(f.rev1, f.rev2), revenuePrev = pick(f.revP1, f.revP2);
  return { year: f.year, revenue, revenuePrev, revenueGrowth: revenue && revenuePrev > 0 ? r2((revenue / revenuePrev - 1) * 100, 1) : null,
    netIncome: f.ni[cik] ?? null, eps: f.eps[cik] ?? null, epsPrev: f.epsP[cik] ?? null, epsGrowth: f.eps[cik] != null && f.epsP[cik] > 0 ? r2((f.eps[cik] / f.epsP[cik] - 1) * 100, 1) : null,
    equity: f.eq[cik] ?? null, shares: f.sh[cik] ?? null };
}
// Ratios at a price.
export function ratios(fd, price) {
  const marketCap = fd.shares && price ? fd.shares * price : null;
  return { marketCap, pe: fd.eps > 0 && price ? r2(price / fd.eps, 1) : null, pb: marketCap && fd.equity > 0 ? r2(marketCap / fd.equity, 2) : null,
    ps: marketCap && fd.revenue > 0 ? r2(marketCap / fd.revenue, 2) : null, netMargin: fd.netIncome != null && fd.revenue > 0 ? r2(fd.netIncome / fd.revenue * 100, 1) : null, capClass: capClass(marketCap) };
}

// ---------- size classes and blue chips ----------
export const CAP_CLASSES = [['mega', 200e9, 'Mega cap', 'Over $200 billion: the giants'], ['large', 10e9, 'Large cap', '$10 to $200 billion: established leaders'], ['mid', 2e9, 'Mid cap', '$2 to $10 billion: growing companies'], ['small', 300e6, 'Small cap', '$300 million to $2 billion: younger, more volatile'], ['micro', 50e6, 'Micro cap', '$50 to $300 million: small and risky'], ['nano', 0, 'Nano cap', 'Under $50 million: very risky, often thinly traded']];
export function capClass(mc) {
  if (!(mc > 0)) return null;
  const [id, , name, about] = CAP_CLASSES.find(([, min]) => mc >= min);
  return { id, name, about };
}
// The Dow Jones Industrial Average members and other long-established leaders.
export const BLUE_CHIPS = new Set(['AAPL', 'AMGN', 'AMZN', 'AXP', 'BA', 'CAT', 'CRM', 'CSCO', 'CVX', 'DIS', 'GS', 'HD', 'HON', 'IBM', 'JNJ', 'JPM', 'KO', 'MCD', 'MMM', 'MRK', 'MSFT', 'NKE', 'NVDA', 'PG', 'SHW', 'TRV', 'UNH', 'V', 'VZ', 'WMT',
  'BRK.B', 'GOOGL', 'GOOG', 'META', 'PEP', 'XOM', 'COST', 'ABBV', 'LLY', 'MA', 'ORCL', 'AVGO', 'TMO', 'ABT', 'LIN', 'ACN', 'TXN', 'NEE', 'UPS', 'LOW', 'BLK', 'ADP', 'PFE', 'T', 'CMCSA', 'BAC', 'WFC', 'MS', 'C', 'INTC', 'QCOM', 'UNP', 'DE', 'LMT', 'RTX', 'GE', 'MDT', 'SBUX', 'MO', 'PM', 'CL', 'KMB', 'GIS', 'SPGI', 'CB']);
export const isBlueChip = (sym, cc) => BLUE_CHIPS.has(sym) && (!cc || ['mega', 'large'].includes(cc.id));

// ---------- ETFs ----------
export const ETFS = {
  SPY: ['SPDR S&P 500 ETF', 'S&P 500', 0.0945, 'US large companies', 'State Street'], VOO: ['Vanguard S&P 500 ETF', 'S&P 500', 0.03, 'US large companies', 'Vanguard'], IVV: ['iShares Core S&P 500', 'S&P 500', 0.03, 'US large companies', 'BlackRock'],
  VTI: ['Vanguard Total Stock Market', 'CRSP US Total Market', 0.03, 'The whole US market', 'Vanguard'], ITOT: ['iShares Core S&P Total US', 'S&P Total Market', 0.03, 'The whole US market', 'BlackRock'], SCHB: ['Schwab US Broad Market', 'Dow Jones US Broad', 0.03, 'The whole US market', 'Schwab'],
  QQQ: ['Invesco QQQ', 'Nasdaq-100', 0.20, 'Large tech-heavy companies', 'Invesco'], QQQM: ['Invesco Nasdaq 100', 'Nasdaq-100', 0.15, 'Large tech-heavy companies', 'Invesco'], DIA: ['SPDR Dow Jones Industrial', 'Dow Jones Industrial Average', 0.16, '30 blue chips', 'State Street'],
  IWM: ['iShares Russell 2000', 'Russell 2000', 0.19, 'US small companies', 'BlackRock'], VB: ['Vanguard Small-Cap', 'CRSP US Small Cap', 0.05, 'US small companies', 'Vanguard'], VO: ['Vanguard Mid-Cap', 'CRSP US Mid Cap', 0.04, 'US mid-size companies', 'Vanguard'],
  VUG: ['Vanguard Growth', 'CRSP US Large Cap Growth', 0.04, 'Large growth companies', 'Vanguard'], VTV: ['Vanguard Value', 'CRSP US Large Cap Value', 0.04, 'Large value companies', 'Vanguard'], SCHD: ['Schwab US Dividend Equity', 'Dow Jones US Dividend 100', 0.06, 'Dividend payers', 'Schwab'], VYM: ['Vanguard High Dividend Yield', 'FTSE High Dividend Yield', 0.06, 'Dividend payers', 'Vanguard'],
  VXUS: ['Vanguard Total International', 'FTSE Global All Cap ex US', 0.05, 'Stocks outside the US', 'Vanguard'], VEA: ['Vanguard Developed Markets', 'FTSE Developed All Cap ex US', 0.03, 'Developed markets outside the US', 'Vanguard'], VWO: ['Vanguard Emerging Markets', 'FTSE Emerging Markets', 0.07, 'Emerging markets', 'Vanguard'],
  BND: ['Vanguard Total Bond Market', 'Bloomberg US Aggregate Float Adjusted', 0.03, 'US investment-grade bonds', 'Vanguard'], AGG: ['iShares Core US Aggregate Bond', 'Bloomberg US Aggregate', 0.03, 'US investment-grade bonds', 'BlackRock'], TLT: ['iShares 20+ Year Treasury', 'ICE US Treasury 20+ Year', 0.15, 'Long-term US government bonds', 'BlackRock'],
  SGOV: ['iShares 0-3 Month Treasury', 'ICE 0-3 Month US Treasury', 0.09, 'Treasury bills (cash-like)', 'BlackRock'], BIL: ['SPDR 1-3 Month T-Bill', 'Bloomberg 1-3 Month T-Bill', 0.1356, 'Treasury bills (cash-like)', 'State Street'], GLD: ['SPDR Gold Shares', 'Gold price', 0.40, 'Gold', 'State Street'], IAU: ['iShares Gold Trust', 'Gold price', 0.25, 'Gold', 'BlackRock'],
  VNQ: ['Vanguard Real Estate', 'MSCI US IMI Real Estate 25/50', 0.13, 'Real estate companies (REITs)', 'Vanguard'], XLK: ['Technology Select Sector SPDR', 'Technology Select Sector', 0.08, 'US technology', 'State Street'], XLF: ['Financial Select Sector SPDR', 'Financial Select Sector', 0.08, 'US financials', 'State Street'], XLE: ['Energy Select Sector SPDR', 'Energy Select Sector', 0.08, 'US energy', 'State Street'], XLV: ['Health Care Select Sector SPDR', 'Health Care Select Sector', 0.08, 'US health care', 'State Street'],
  SH: ['ProShares Short S&P 500', 'S&P 500 (inverse, -1x daily)', 0.89, 'Bets on a fall of the S&P 500', 'ProShares'], PSQ: ['ProShares Short QQQ', 'Nasdaq-100 (inverse, -1x daily)', 0.95, 'Bets on a fall of the Nasdaq-100', 'ProShares'], ARKK: ['ARK Innovation', 'Actively managed', 0.75, 'Disruptive innovation (active)', 'ARK'],
};

// ---------- price behaviour from history ----------
export function priceStats(closes, dates, bench) {
  const n = closes.length, last = closes[n - 1], yr = closes.slice(-252);
  const rets = []; for (let i = Math.max(1, n - 252); i < n; i++) rets.push(closes[i] / closes[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length, sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  let peak = -Infinity, dd = 0; for (const c of yr) { peak = Math.max(peak, c); dd = Math.min(dd, c / peak - 1); }
  let beta = null;
  if (bench?.closes?.length > 260) {
    const bm = new Map(bench.dates.map((d, i) => [d, bench.closes[i]])), a = [], b = [];
    for (let i = Math.max(1, n - 252); i < n; i++) { const x = bm.get(dates[i]), y = bm.get(dates[i - 1]); if (x && y) { a.push(closes[i] / closes[i - 1] - 1); b.push(x / y - 1); } }
    const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
    let cov = 0, vb = 0; for (let i = 0; i < a.length; i++) { cov += (a[i] - ma) * (b[i] - mb); vb += (b[i] - mb) ** 2; }
    beta = vb ? r2(cov / vb) : null;
  }
  const back = k => (n > k ? r2((last / closes[n - 1 - k] - 1) * 100, 1) : null);
  return { price: last, change1m: back(21), change6m: back(126), change1y: back(252), high52: Math.max(...yr), low52: Math.min(...yr), fromHigh: r2((last / Math.max(...yr) - 1) * 100, 1), volatility: r2(sd * Math.sqrt(252) * 100, 1), maxDrawdown1y: r2(dd * 100, 1), beta };
}

const yearsAgo = n => new Date(Date.now() - n * 365 * DAY).toISOString().slice(0, 10);
// Everything shown about one symbol.
export async function profile(symbol, userId) {
  symbol = String(symbol || '').toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) throw bad('Check the symbol');
  const [bars, bench] = await Promise.all([getBars(symbol, yearsAgo(2), userId).catch(e => (e.status === 404 ? Promise.reject(e) : null)), symbol === 'SPY' ? null : getBars('SPY', yearsAgo(2), userId).catch(() => null)]);
  const px = await lastPrice(symbol, userId).catch(() => bars?.closes.at(-1));
  const perf = bars ? priceStats([...bars.closes.slice(0, -1), px || bars.closes.at(-1)], bars.dates, bench) : null;
  if (ETFS[symbol]) {
    const [name, index, er, about, issuer] = ETFS[symbol];
    return { symbol, kind: 'etf', name, etf: { index, expenseRatio: er, about, issuer, costPer10k: r2(er * 100, 2) }, price: px, perf, blueChip: false };
  }
  const map = await tickerCiks().catch(() => ({})), hit = map[symbol];
  let company = null, fd = null, rt = null;
  if (hit) {
    const cik = String(hit.cik).padStart(10, '0');
    company = await secCached(`sec:sub:${cik}`, 30 * DAY, async () => { const s = await get(`${secData()}/submissions/CIK${cik}.json`); return { name: s.name, industry: s.sicDescription, exchanges: s.exchanges, fiscalYearEnd: s.fiscalYearEnd, state: s.stateOfIncorporation, category: s.category, website: s.website || null }; }).catch(() => ({ name: hit.name }));
    fd = fundamentalsFromFrames(await frames().catch(() => ({ year: fiscalYear(), rev1: {}, rev2: {}, revP1: {}, revP2: {}, ni: {}, eps: {}, epsP: {}, eq: {}, sh: {} })), hit.cik);
    rt = ratios(fd, px);
  }
  return { symbol, kind: hit ? 'stock' : 'unknown', name: company?.name || hit?.name || symbol, company, fundamentals: fd, ratios: rt, price: px, perf, blueChip: isBlueChip(symbol, rt?.capClass), style: style(fd, rt) };
}
// Growth or value, by the usual yardsticks.
export function style(fd, rt) {
  if (!fd || !rt) return null;
  const growth = (fd.revenueGrowth ?? -99) >= 15 || (fd.epsGrowth ?? -99) >= 20, value = rt.pe != null && rt.pe <= 16 && (rt.pb == null || rt.pb <= 3);
  return growth && !value ? 'growth' : value && !growth ? 'value' : growth && value ? 'growth at a fair price' : 'blend';
}

// ---------- growth and value screen ----------
export const UNIVERSE = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'AVGO', 'TSLA', 'BRK.B', 'JPM', 'LLY', 'V', 'UNH', 'XOM', 'MA', 'COST', 'HD', 'PG', 'JNJ', 'ABBV', 'WMT', 'NFLX', 'BAC', 'CRM', 'ORCL', 'CVX', 'KO', 'MRK', 'AMD', 'PEP', 'ADBE', 'TMO', 'LIN', 'ACN', 'CSCO', 'MCD', 'ABT', 'WFC', 'DIS', 'INTU', 'QCOM', 'TXN', 'IBM', 'GE', 'CAT', 'AMGN', 'VZ', 'PFE', 'NOW', 'ISRG', 'UBER', 'CMCSA', 'GS', 'MS', 'T', 'NEE', 'SPGI', 'UNP', 'LOW', 'HON', 'RTX', 'BKNG', 'BLK', 'PLD', 'SYK', 'AXP', 'C', 'LMT', 'DE', 'ELV', 'SBUX', 'MDT', 'GILD', 'ADP', 'MMC', 'PANW', 'ANET', 'MU', 'LRCX', 'INTC', 'CB', 'BMY', 'MO', 'SO', 'DUK', 'CI', 'PYPL', 'SHOP', 'ABNB', 'CRWD', 'SNOW', 'PLTR', 'COIN', 'F', 'GM', 'KHC', 'KR', 'TGT', 'DG', 'CVS', 'MPC', 'COP', 'OXY', 'DVN', 'HPQ', 'DELL', 'WBA', 'PARA', 'USB', 'PNC', 'TFC', 'MET', 'PRU', 'AIG', 'ALL', 'TRV', 'NUE', 'FCX', 'DOW', 'LYB', 'CF', 'ADM', 'BG', 'TSN', 'MOS'];
let screenCache = null;
export async function screen(userId, { refresh = false } = {}) {
  if (screenCache && !refresh && Date.now() - screenCache.at < 3600e3) return screenCache.v;
  const [map, f] = await Promise.all([tickerCiks(), frames()]);
  const rows = [];
  for (let i = 0; i < UNIVERSE.length; i += 8) {
    await Promise.all(UNIVERSE.slice(i, i + 8).map(async sym => {
      const hit = map[sym]; if (!hit) return;
      const px = await lastPrice(sym, userId).catch(() => null); if (!px) return;
      const fd = fundamentalsFromFrames(f, hit.cik), rt = ratios(fd, px);
      rows.push({ symbol: sym, name: hit.name, price: px, ...rt, revenueGrowth: fd.revenueGrowth, epsGrowth: fd.epsGrowth, style: style(fd, rt), blueChip: isBlueChip(sym, rt.capClass) });
    }));
  }
  const rank = (list, key, asc) => { const s = list.filter(r => r[key] != null).sort((a, b) => (asc ? a[key] - b[key] : b[key] - a[key])); s.forEach((r, i) => (r[`_${key}`] = i / Math.max(1, s.length - 1))); };
  rank(rows, 'revenueGrowth', false); rank(rows, 'epsGrowth', false); rank(rows, 'pe', true); rank(rows, 'pb', true);
  const growth = rows.filter(r => r.revenueGrowth != null && r.revenueGrowth > 8).map(r => ({ ...r, score: r2(100 * (1 - ((r._revenueGrowth ?? 1) + (r._epsGrowth ?? 1)) / 2), 0) })).sort((a, b) => b.score - a.score).slice(0, 25);
  const value = rows.filter(r => r.pe != null && r.pe > 0 && r.pe < 25).map(r => ({ ...r, score: r2(100 * (1 - ((r._pe ?? 1) + (r._pb ?? 1)) / 2), 0) })).sort((a, b) => b.score - a.score).slice(0, 25);
  const clean = r => { const o = { ...r }; for (const k of Object.keys(o)) if (k.startsWith('_')) delete o[k]; return o; };
  const v = { year: f.year, scanned: rows.length, growth: growth.map(clean), value: value.map(clean), all: rows.map(clean).sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)), at: Date.now() };
  screenCache = { at: Date.now(), v };
  return v;
}

export const fundamentalsRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/profile/:symbol', async (req, res) => res.json(await profile(req.params.symbol, req.user.id)));
  // When the SEC cannot be reached the page says so instead of failing.
  r.get('/screen', async (req, res) => res.json(await screen(req.user.id, { refresh: req.query.refresh === '1' }).catch(e => ({ unavailable: true, message: 'Company financials from the SEC are not available right now; try again in a few minutes.', detail: String(e.message).slice(0, 120), growth: [], value: [], scanned: 0, year: fiscalYear() }))));
  r.get('/caps', (req, res) => res.json({ classes: CAP_CLASSES.map(([id, min, name, about]) => ({ id, min, name, about })) }));
  return r;
})();
