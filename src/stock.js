// One stock page (docs/archive/PLAN_GROWTH.md): valuation, 5-year fundamentals, earnings, dividends, technicals,
// supply and demand, the company card shown before every buy, and the growth-at-a-price scanner.
// Data, all cached, with clean fallbacks that say what is missing:
//  - SEC EDGAR (free): company facts (every reported annual and quarterly figure) and submissions
//    (industry, and 8-K "Results of operations" reports = earnings report dates);
//  - prices: Alpaca bars (open, high, low, close, volume) when market data is set up, else daily
//    closes from the other providers; the top of book from Alpaca's latest quote;
//  - Finnhub (with FINNHUB_API_KEY): expected vs actual EPS, upcoming dates;
//  - the AI provider, when set up, for the plain-language summary (rules otherwise).
// Everything here is information, not investment advice; labels compare a stock with its own
// history and its sector and never predict a price.
import express from 'express';
import { requireUser } from './auth.js';
import { get, secData, secCached, companyFacts as secCompanyFacts, companySubmissions as secSubmissions } from './institutions.js';
import { tickerCiks, UNIVERSE } from './fundamentals.js';
import { getBars, lastPrice } from './brokers.js';
import * as D from './alpaca/data.js';
import { eventsEnabled, earnings as fhEarnings } from './events.js';
import { getSetting, setSetting } from './settings.js';
import { isPaid } from './fees.js';

const DAY = 864e5;
const r2 = (x, d = 2) => (x == null || !Number.isFinite(+x) ? null : +(+x).toFixed(d));
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const SYM = /^[A-Z][A-Z0-9.\-]{0,9}$/;
export const NOT_ADVICE = 'Information and education only, not investment advice. Labels compare the stock with its own history and its sector; they do not predict the price.';
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const cagr = (first, last, years) => (first > 0 && last > 0 && years > 0 ? ((last / first) ** (1 / years) - 1) * 100 : null);

// ---------- SEC company facts → yearly and quarterly series ----------
// A duration figure (revenue, income, cash flow) of about a year, or a point-in-time figure (balance
// sheet), from annual reports: one value per fiscal-year end, the latest filing winning.
export function annualSeries(facts, names, unit = 'USD', n = 6) {
  for (const name of names) {
    const rows = facts?.['us-gaap']?.[name]?.units?.[unit];
    if (!rows?.length) continue;
    const byEnd = {};
    for (const r of rows) {
      if (!/^10-K/.test(r.form || '')) continue;
      if (r.start) { const days = (Date.parse(r.end) - Date.parse(r.start)) / DAY; if (days < 340 || days > 380) continue; }
      const prev = byEnd[r.end];
      if (!prev || (r.filed || '') > (prev.filed || '')) byEnd[r.end] = r;
    }
    const out = Object.values(byEnd).sort((a, b) => a.end.localeCompare(b.end)).map(r => ({ year: +r.end.slice(0, 4), end: r.end, value: r.val }));
    // One row per year (a fiscal year that ends twice in a calendar year keeps the later end).
    const byYear = {}; for (const x of out) byYear[x.year] = x;
    const list = Object.values(byYear).sort((a, b) => a.year - b.year).slice(-n);
    if (list.length) return list;
  }
  return [];
}
// Quarterly diluted EPS (about 90-day periods) from 10-Q and 10-K filings, newest last.
export function quarterlySeries(facts, names = ['EarningsPerShareDiluted', 'EarningsPerShareBasic'], unit = 'USD/shares', n = 12) {
  for (const name of names) {
    const rows = facts?.['us-gaap']?.[name]?.units?.[unit];
    if (!rows?.length) continue;
    const byEnd = {};
    for (const r of rows) {
      if (!r.start) continue;
      const days = (Date.parse(r.end) - Date.parse(r.start)) / DAY; if (days < 80 || days > 100) continue;
      const prev = byEnd[r.end]; if (!prev || (r.filed || '') > (prev.filed || '')) byEnd[r.end] = r;
    }
    const list = Object.values(byEnd).sort((a, b) => a.end.localeCompare(b.end)).map(r => ({ end: r.end, value: r.val, filed: r.filed })).slice(-n);
    if (list.length) return list;
  }
  return [];
}
const C = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  grossProfit: ['GrossProfit'], operatingIncome: ['OperatingIncomeLoss'], netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  da: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities'], capex: ['PaymentsToAcquirePropertyPlantAndEquipment'], dividendsPaid: ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends'],
  assets: ['Assets'], liabilities: ['Liabilities'], equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  currentAssets: ['AssetsCurrent'], currentLiabilities: ['LiabilitiesCurrent'], cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  debt: ['LongTermDebtNoncurrent', 'LongTermDebt', 'LongTermDebtAndCapitalLeaseObligations'],
};
// Income statement, balance sheet and cash flow by fiscal year (up to 6 years, oldest first).
export function statements(facts) {
  const s = Object.fromEntries(Object.entries(C).map(([k, names]) => [k, annualSeries(facts, names)]));
  s.eps = annualSeries(facts, ['EarningsPerShareDiluted', 'EarningsPerShareBasic'], 'USD/shares');
  s.dps = annualSeries(facts, ['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid'], 'USD/shares');
  s.shares = annualSeries(facts, ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingBasic'], 'shares');
  const years = [...new Set([...s.revenue, ...s.netIncome, ...s.eps].map(x => x.year))].sort((a, b) => a - b).slice(-6);
  const at = (k, y) => s[k].find(x => x.year === y)?.value ?? null;
  const rows = years.map(y => {
    const ocf = at('ocf', y), capex = at('capex', y), oi = at('operatingIncome', y), da = at('da', y);
    return { year: y, revenue: at('revenue', y), grossProfit: at('grossProfit', y), operatingIncome: oi, netIncome: at('netIncome', y), eps: at('eps', y), dps: at('dps', y), shares: at('shares', y),
      ebitda: oi != null && da != null ? oi + da : null, ocf, capex, fcf: ocf != null ? ocf - (capex || 0) : null, dividendsPaid: at('dividendsPaid', y),
      assets: at('assets', y), liabilities: at('liabilities', y), equity: at('equity', y), currentAssets: at('currentAssets', y), currentLiabilities: at('currentLiabilities', y), cash: at('cash', y), debt: at('debt', y), end: s.revenue.find(x => x.year === y)?.end || s.eps.find(x => x.year === y)?.end || `${y}-12-31` };
  });
  return { years, rows };
}
// Key ratios for the latest year (and the trend of each over the years shown).
export function keyRatios(rows) {
  const ratio = (a, b) => (a != null && b ? r2(a / b * 100, 1) : null);
  const byYear = rows.map((x, i) => {
    const prevEq = rows[i - 1]?.equity, avgEq = x.equity != null && prevEq != null ? (x.equity + prevEq) / 2 : x.equity;
    return { year: x.year, grossMargin: ratio(x.grossProfit, x.revenue), operatingMargin: ratio(x.operatingIncome, x.revenue), netMargin: ratio(x.netIncome, x.revenue), fcfMargin: ratio(x.fcf, x.revenue),
      roe: avgEq > 0 && x.netIncome != null ? r2(x.netIncome / avgEq * 100, 1) : null, debtToEquity: x.equity > 0 && x.debt != null ? r2(x.debt / x.equity, 2) : null,
      currentRatio: x.currentLiabilities > 0 && x.currentAssets != null ? r2(x.currentAssets / x.currentLiabilities, 2) : null };
  });
  const last = rows.at(-1), first = rows.find(x => x.revenue > 0);
  const span = last && first ? last.year - first.year : 0;
  const epsRows = rows.filter(x => x.eps > 0);
  return { latest: byYear.at(-1) || {}, byYear,
    revenueGrowth: first && span ? r2(cagr(first.revenue, last.revenue, span), 1) : null, revenueYears: span,
    epsGrowth: epsRows.length >= 2 ? r2(cagr(epsRows[0].eps, epsRows.at(-1).eps, epsRows.at(-1).year - epsRows[0].year), 1) : null,
    revenueTrend: rows.length >= 3 ? (() => { const g = rows.slice(1).map((x, i) => (rows[i].revenue > 0 && x.revenue != null ? x.revenue / rows[i].revenue - 1 : null)).filter(v => v != null); return g.length >= 2 ? (g.at(-1) > g.at(-2) ? 'speeding up' : g.at(-1) < g.at(-2) ? 'slowing' : 'steady') : null; })() : null };
}

// ---------- valuation ----------
// price: today's price. rows: statements().rows. ttmEps: last four quarters (falls back to the last
// fiscal year). fyPrices: { 'YYYY-MM-DD': close } at or before each fiscal-year end. forwardEps and
// sectorPE are optional. The label compares today's P/E with the stock's own average of up to five
// years: below 85% of it "cheap", above 115% "expensive", else "fair".
export function valuation({ price, rows = [], ttmEps = null, ttmRevenue = null, fyPrices = {}, forwardEps = null, sectorPE = null, shares = null }) {
  const last = rows.at(-1) || {};
  const eps = ttmEps ?? last.eps ?? null, rev = ttmRevenue ?? last.revenue ?? null, sh = shares ?? last.shares ?? null;
  const marketCap = sh && price ? sh * price : null;
  const pe = eps > 0 && price ? r2(price / eps, 1) : null;
  const history = rows.filter(x => x.eps > 0 && fyPrices[x.end] > 0).map(x => ({ year: x.year, end: x.end, price: r2(fyPrices[x.end]), eps: x.eps, pe: r2(fyPrices[x.end] / x.eps, 1) })).slice(-5);
  const avg5 = history.length >= 2 ? r2(mean(history.map(h => h.pe)), 1) : null;
  const epsPos = rows.filter(x => x.eps > 0).slice(-4);
  const growth = epsPos.length >= 2 ? cagr(epsPos[0].eps, epsPos.at(-1).eps, epsPos.at(-1).year - epsPos[0].year) : null;
  const ev = marketCap != null ? marketCap + (last.debt || 0) - (last.cash || 0) : null;
  const vsOwn = pe && avg5 ? r2(pe / avg5, 2) : null;
  const label = pe == null ? { id: 'na', text: eps != null && eps <= 0 ? 'No P/E: the company lost money over the last year' : 'Not enough data for a P/E' }
    : vsOwn == null ? { id: 'na', text: 'Not enough years of P/E history to compare' }
    : vsOwn < 0.85 ? { id: 'cheap', text: `Cheap compared with its history: P/E ${pe} vs its ${history.length}-year average of ${avg5}` }
    : vsOwn > 1.15 ? { id: 'expensive', text: `Expensive compared with its history: P/E ${pe} vs its ${history.length}-year average of ${avg5}` }
    : { id: 'fair', text: `Fair compared with its history: P/E ${pe} vs its ${history.length}-year average of ${avg5}` };
  return {
    price: r2(price), marketCap: r2(marketCap, 0), pe, forwardPe: forwardEps > 0 && price ? r2(price / forwardEps, 1) : null,
    peg: pe && growth > 0 ? r2(pe / growth, 2) : null, epsGrowth: r2(growth, 1), ps: marketCap && rev > 0 ? r2(marketCap / rev, 2) : null,
    evEbitda: ev != null && last.ebitda > 0 ? r2(ev / last.ebitda, 1) : null, ev: r2(ev, 0), avg5, vsOwn, sectorPE: r2(sectorPE, 1), vsSector: pe && sectorPE ? r2(pe / sectorPE, 2) : null,
    history, label, method: 'Trailing P/E = price ÷ earnings per share of the last four reported quarters (or the last fiscal year). The history uses each fiscal year\'s closing price ÷ that year\'s EPS. "Cheap" is below 85% of its own average P/E, "expensive" above 115%. PEG = P/E ÷ yearly EPS growth over up to 3 years. EV/EBITDA uses market value + long-term debt − cash, ÷ operating income + depreciation.',
  };
}

// ---------- dividends ----------
// Safety score 0–100 from five parts; each part is shown so the score can be checked.
export function dividendView(rows, price, { exDate = null, payDate = null, cash = null } = {}) {
  const paying = rows.filter(x => x.dps > 0);
  const last = paying.at(-1);
  if (!last) return { pays: false, note: 'No dividend reported in the last annual reports.' };
  let streak = 0; for (let i = paying.length - 1; i > 0; i--) { if (paying[i].dps > paying[i - 1].dps && paying[i].year === paying[i - 1].year + 1) streak++; else break; }
  const latest = rows.at(-1), yieldPct = price ? r2(last.dps / price * 100, 2) : null;
  const payout = latest?.eps > 0 && last.year === latest.year ? r2(last.dps / latest.eps * 100, 0) : null;
  const fcfCover = latest?.fcf > 0 && latest?.dividendsPaid > 0 ? r2(Math.abs(latest.dividendsPaid) / latest.fcf * 100, 0) : null;
  const de = latest?.equity > 0 && latest?.debt != null ? latest.debt / latest.equity : null;
  const growth = paying.length >= 2 ? r2(cagr(paying[0].dps, last.dps, last.year - paying[0].year), 1) : null;
  const parts = [
    ['Payout ratio', payout == null ? 10 : payout <= 60 ? 25 : payout <= 80 ? 15 : payout <= 100 ? 5 : 0, payout == null ? 'Not reported' : `${payout}% of earnings`],
    ['Free cash flow cover', fcfCover == null ? 10 : fcfCover <= 70 ? 25 : fcfCover <= 100 ? 12 : 0, fcfCover == null ? 'Not reported' : `dividends use ${fcfCover}% of free cash flow`],
    ['Growth streak', Math.min(20, streak * 4), `${streak} year${streak === 1 ? '' : 's'} of increases in a row`],
    ['Debt', de == null ? 8 : de < 1 ? 15 : de < 2 ? 8 : 0, de == null ? 'Not reported' : `long-term debt ${de.toFixed(2)}× equity`],
    ['Profitable', latest?.netIncome > 0 ? 15 : 0, latest?.netIncome > 0 ? 'Made money last year' : 'Lost money last year'],
  ];
  const score = parts.reduce((s, p) => s + p[1], 0);
  return { pays: true, dps: last.dps, year: last.year, yieldPct, payout, fcfCover, growth, streak, history: paying.map(x => ({ year: x.year, dps: x.dps })), exDate, payDate, cash,
    safety: { score, label: score >= 70 ? 'Looks well covered' : score >= 45 ? 'Watch it' : 'At risk of a cut', parts: parts.map(([name, points, detail]) => ({ name, points, detail })) } };
}
// 12-month income forecast for holdings: shares × the latest yearly dividend per share.
export function incomeForecast(positions, dpsBySymbol) {
  const rows = positions.filter(p => p.qty > 0).map(p => { const dps = dpsBySymbol[p.symbol] ?? null; return { symbol: p.symbol, qty: p.qty, dps, income: dps ? r2(p.qty * dps) : 0, yieldPct: dps && p.price ? r2(dps / p.price * 100, 2) : null }; });
  return { rows: rows.sort((a, b) => b.income - a.income), total: r2(rows.reduce((s, r) => s + r.income, 0)), note: 'Forecast from the last reported yearly dividend per share. Companies can raise, cut or stop dividends.' };
}

// ---------- technicals ----------
const sma = (c, n) => (c.length >= n ? mean(c.slice(-n)) : null);
function emaArr(c, n) { const k = 2 / (n + 1); const out = []; let e = null; for (const x of c) { e = e == null ? x : x * k + e * (1 - k); out.push(e); } return out; }
export function rsiLast(c, n = 14) {
  if (c.length <= n) return null; let g = 0, l = 0;
  for (let i = c.length - n; i < c.length; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  return l === 0 ? 100 : r2(100 - 100 / (1 + g / l), 1);
}
// Support and resistance: turning points of the last 120 bars, grouped when within 2% of each other.
export function levels(bars) {
  const b = bars.slice(-120), pts = [];
  for (let i = 2; i < b.length - 2; i++) {
    if (b[i].l <= Math.min(b[i - 1].l, b[i - 2].l, b[i + 1].l, b[i + 2].l)) pts.push(b[i].l);
    if (b[i].h >= Math.max(b[i - 1].h, b[i - 2].h, b[i + 1].h, b[i + 2].h)) pts.push(b[i].h);
  }
  const groups = [];
  for (const p of pts.sort((x, y) => x - y)) { const g = groups.find(g => Math.abs(g.price - p) / g.price < 0.02); if (g) { g.price = (g.price * g.n + p) / (g.n + 1); g.n++; } else groups.push({ price: p, n: 1 }); }
  const px = b.at(-1)?.c;
  const strong = groups.filter(g => g.n >= 2);
  return { support: strong.filter(g => g.price < px).sort((a, b2) => b2.price - a.price).slice(0, 2).map(g => r2(g.price)), resistance: strong.filter(g => g.price > px).sort((a, b2) => a.price - b2.price).slice(0, 2).map(g => r2(g.price)) };
}
export function technicalRead(bars) {
  const c = bars.map(x => x.c), px = c.at(-1);
  const s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200), rsi = rsiLast(c);
  const e12 = emaArr(c, 12), e26 = emaArr(c, 26), macdLine = e12.map((x, i) => x - e26[i]), sig = emaArr(macdLine, 9), macd = r2(macdLine.at(-1), 3), signal = r2(sig.at(-1), 3);
  const v = bars.map(x => x.v).filter(x => x != null), vol20 = v.length >= 20 ? mean(v.slice(-20)) : null, vol60 = v.length >= 60 ? mean(v.slice(-60)) : null;
  const lv = bars[0]?.h != null ? levels(bars) : { support: [], resistance: [] };
  const trend = s50 && s200 ? (px > s50 && s50 > s200 ? 'up' : px < s50 && s50 < s200 ? 'down' : 'mixed') : s50 ? (px > s50 ? 'up' : 'down') : 'unknown';
  const words = [
    trend === 'up' ? 'The price is above its 50-day and 200-day averages: an uptrend.' : trend === 'down' ? 'The price is below its 50-day and 200-day averages: a downtrend.' : trend === 'mixed' ? 'The averages disagree: no clear trend.' : 'Not enough history for a trend.',
    rsi == null ? '' : rsi >= 70 ? `RSI ${rsi}: it rose fast recently (often called overbought).` : rsi <= 30 ? `RSI ${rsi}: it fell fast recently (often called oversold).` : `RSI ${rsi}: neither stretched up nor down.`,
    macd != null && signal != null ? (macd > signal ? 'MACD is above its signal line: momentum is improving.' : 'MACD is below its signal line: momentum is fading.') : '',
    vol20 && vol60 ? (vol20 > vol60 * 1.2 ? 'Trading volume is higher than usual lately.' : vol20 < vol60 * 0.8 ? 'Trading volume is lower than usual lately.' : '') : '',
    lv.support[0] ? `Nearest support about ${lv.support[0]}${lv.resistance[0] ? `, resistance about ${lv.resistance[0]}` : ''}.` : '',
  ].filter(Boolean);
  return { price: r2(px), sma20: r2(s20), sma50: r2(s50), sma200: r2(s200), rsi, macd, signal, trend, ...lv, volume20: r2(vol20, 0), read: words.join(' '), by: 'rules', note: 'A description of past prices, not a forecast.' };
}

// ---------- supply and demand (indicative) ----------
// Buy and sell volume are estimated from where each bar closed in its range (close near the high =
// mostly buying). The gauge is the 20-day money flow (−100 sellers to +100 buyers). The volume
// profile spreads each bar's volume over its price range in 24 bins.
export function supplyDemand(bars, quote = null) {
  const b = bars.filter(x => x.h != null && x.l != null && x.v != null);
  if (b.length < 20) return { available: false, note: 'Needs daily bars with high, low and volume (market data). Not available for this symbol right now.' };
  const clv = x => (x.h > x.l ? ((x.c - x.l) - (x.h - x.c)) / (x.h - x.l) : 0);
  const last20 = b.slice(-20);
  const buy = last20.reduce((s, x) => s + x.v * (1 + clv(x)) / 2, 0), total = last20.reduce((s, x) => s + x.v, 0);
  const flow = total ? last20.reduce((s, x) => s + clv(x) * x.v, 0) / total : 0;
  const gauge = Math.round(flow * 100);
  const w = b.slice(-120), lo = Math.min(...w.map(x => x.l)), hi = Math.max(...w.map(x => x.h)), bins = 24, step = (hi - lo) / bins || 1;
  const profile = Array.from({ length: bins }, (_, i) => ({ from: r2(lo + i * step), to: r2(lo + (i + 1) * step), volume: 0 }));
  for (const x of w) { const a = Math.max(0, Math.floor((x.l - lo) / step)), z = Math.min(bins - 1, Math.floor((x.h - lo) / step)); const per = x.v / (z - a + 1); for (let i = a; i <= z; i++) profile[i].volume += per; }
  profile.forEach(p => (p.volume = Math.round(p.volume)));
  const poc = profile.reduce((m, p) => (p.volume > m.volume ? p : m), profile[0]);
  const avg20 = mean(b.slice(-21, -1).map(x => x.v)), lastV = b.at(-1).v;
  return { available: true, buyPct: total ? r2(buy / total * 100, 0) : null, sellPct: total ? r2(100 - buy / total * 100, 0) : null, gauge,
    control: gauge >= 15 ? 'Buyers in control' : gauge <= -15 ? 'Sellers in control' : 'Balanced', profile, poc: { from: poc.from, to: poc.to },
    unusual: avg20 ? { ratio: r2(lastV / avg20, 1), flag: lastV > 2 * avg20 } : null,
    top: quote ? { bid: quote.bid ?? null, ask: quote.ask ?? null, bidSize: quote.bidSize ?? null, askSize: quote.askSize ?? null, spread: quote.bid && quote.ask ? r2(quote.ask - quote.bid, 4) : null } : null,
    depth: null, note: 'Indicative, not a prediction. Buy and sell volume are estimated from daily bars; market depth (level 2) is not offered by the connected data, so only the top of book is shown.' };
}

// ---------- earnings ----------
// Report dates (8-K "Results of operations"), EPS per quarter and the price move from the close before
// each report to the close the day after. With a Finnhub key: expected vs actual EPS and the next date.
export function earningsReactions(reportDates, closes, dates) {
  const idx = d => { let i = dates.findIndex(x => x >= d); return i < 0 ? -1 : i; };
  return reportDates.map(d => { const i = idx(d); if (i < 1 || i + 1 >= closes.length) return { date: d, move: null }; return { date: d, move: r2((closes[i + 1] / closes[i - 1] - 1) * 100, 1) }; });
}
export function nextEarnings(reportDates, confirmed = null, t = Date.now()) {
  if (confirmed) return { date: confirmed, estimated: false };
  const last = [...reportDates].sort().at(-1); if (!last) return null;
  let d = Date.parse(last) + 91 * DAY; while (d < t - DAY) d += 91 * DAY;
  return { date: new Date(d).toISOString().slice(0, 10), estimated: true };
}

// ---------- strengths and risks (rules; the AI rewrites them when set up) ----------
export function strengthsRisks({ ratios = {}, val = {}, div = null, tech = null }) {
  const L = ratios.latest || {}, s = [], r = [];
  if (ratios.revenueGrowth > 8) s.push(`Revenue grew ${ratios.revenueGrowth}% a year over ${ratios.revenueYears} years.`); else if (ratios.revenueGrowth != null && ratios.revenueGrowth < 0) r.push(`Revenue shrank ${Math.abs(ratios.revenueGrowth)}% a year.`);
  if (L.netMargin > 15) s.push(`High profit margin (${L.netMargin}% net).`); else if (L.netMargin != null && L.netMargin < 0) r.push('Lost money in the last fiscal year.');
  if (L.roe > 15) s.push(`Strong return on equity (${L.roe}%).`);
  if (L.debtToEquity > 2) r.push(`Heavy debt (${L.debtToEquity}× equity).`); else if (L.debtToEquity != null && L.debtToEquity < 0.5) s.push('Little long-term debt.');
  if (L.fcfMargin > 10) s.push(`Turns ${L.fcfMargin}% of revenue into free cash flow.`); else if (L.fcfMargin != null && L.fcfMargin < 0) r.push('Spends more cash than it brings in.');
  if (val.label?.id === 'expensive') r.push(val.label.text + '.'); else if (val.label?.id === 'cheap') s.push(val.label.text + '.');
  if (ratios.revenueTrend === 'slowing') r.push('Revenue growth is slowing.');
  if (div?.pays && div.safety?.score < 45) r.push('The dividend looks stretched.'); else if (div?.pays && div.streak >= 5) s.push(`Raised its dividend ${div.streak} years in a row.`);
  if (tech?.trend === 'down') r.push('The price is in a downtrend.');
  return { strengths: s.slice(0, 4), risks: r.slice(0, 4) };
}

// ---------- the growth-at-a-price scanner ----------
export const PRESETS = {
  growth: { name: 'Growth worth paying for', about: 'High P/E, but earnings and revenue growing fast, good margins and positive free cash flow.', filters: { peMin: 30, epsGrowthMin: 20, revenueGrowthMin: 15, netMarginMin: 15, fcfPositive: true } },
  weakening: { name: 'Expensive and weakening', about: 'High P/E while earnings shrink or revenue growth slows: the price may assume more than the business delivers.', filters: { peMin: 30, weakening: true } },
  value: { name: 'Profitable and cheap', about: 'Low P/E, profitable, with positive free cash flow.', filters: { peMax: 15, peMin: 0.1, netMarginMin: 5, fcfPositive: true } },
};
export const FILTER_KEYS = ['peMin', 'peMax', 'epsGrowthMin', 'revenueGrowthMin', 'netMarginMin', 'beatsMin', 'fcfPositive', 'weakening', 'dividendYieldMin'];
export function cleanFilters(f = {}) {
  const out = {};
  for (const k of FILTER_KEYS) {
    if (f[k] === undefined || f[k] === null || f[k] === '') continue;
    if (k === 'fcfPositive' || k === 'weakening') { out[k] = f[k] === true || f[k] === 'true' || f[k] === 1 || f[k] === '1'; continue; }
    const v = +f[k]; if (!Number.isFinite(v)) throw bad(`${k} must be a number`); out[k] = Math.max(-1000, Math.min(10000, v));
  }
  return out;
}
// rows: { symbol, pe, epsGrowth, revenueGrowth, netMargin, fcf, beats (of the last 4 or null), revenueTrend, dividendYield }
export function applyFilters(rows, filters) {
  const f = cleanFilters(filters);
  return rows.filter(r => {
    if (f.peMin != null && !(r.pe != null && r.pe >= f.peMin)) return false;
    if (f.peMax != null && !(r.pe != null && r.pe <= f.peMax)) return false;
    if (f.epsGrowthMin != null && !(r.epsGrowth != null && r.epsGrowth >= f.epsGrowthMin)) return false;
    if (f.revenueGrowthMin != null && !(r.revenueGrowth != null && r.revenueGrowth >= f.revenueGrowthMin)) return false;
    if (f.netMarginMin != null && !(r.netMargin != null && r.netMargin >= f.netMarginMin)) return false;
    if (f.beatsMin != null && !(r.beats != null && r.beats >= f.beatsMin)) return false;
    if (f.fcfPositive && !(r.fcf > 0)) return false;
    if (f.weakening && !((r.epsGrowth != null && r.epsGrowth < 0) || r.revenueTrend === 'slowing')) return false;
    if (f.dividendYieldMin != null && !(r.dividendYield != null && r.dividendYield >= f.dividendYieldMin)) return false;
    return true;
  });
}

// ---------- the company card shown before a buy ----------
export function buildCard(x) {
  const v = x.val || {}, d = x.div || {}, e = x.earn || {};
  return {
    symbol: x.symbol, name: x.name, about: x.about || null, sector: x.sector || null, marketCap: v.marketCap ?? null,
    pe: v.pe ?? null, sectorPE: v.sectorPE ?? null, peLabel: v.label?.id || 'na',
    lastEarnings: e.last || null, nextEarnings: e.next || null, dividendYield: d.pays ? d.yieldPct : 0,
    range52: x.range52 || null, headlines: (x.headlines || []).slice(0, 3), strength: x.sr?.strengths?.[0] || null, risk: x.sr?.risks?.[0] || null,
    etf: !!x.etf, note: 'Information, not advice. It never blocks your order.',
  };
}
export function range52(closes) { const c = closes.slice(-252); return c.length ? { low: r2(Math.min(...c)), high: r2(Math.max(...c)), at: c.at(-1) ? r2((c.at(-1) - Math.min(...c)) / ((Math.max(...c) - Math.min(...c)) || 1) * 100, 0) : null } : null; }

// ---------- loading (cached) ----------
const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key); if (hit && Date.now() - hit.at < ttl) return hit.v;
  const v = await fn(); cache.set(key, { at: Date.now(), v }); if (cache.size > 2000) cache.delete(cache.keys().next().value); return v;
}
async function cikOf(symbol) {
  const map = await tickerCiks().catch(() => ({}));
  const hit = map[symbol] || map[symbol.replace('.', '-')]; return hit ? { cik: String(hit.cik).padStart(10, '0'), name: hit.name } : null;
}
export const companyFacts = cik => secCompanyFacts(cik, 2 * DAY); // trimmed (src/institutions.js)
const submissions = cik => secSubmissions(cik, DAY); // trimmed (src/institutions.js)
// Earnings report dates: 8-K filings with item 2.02 (Results of Operations), newest last.
export function reportDatesFrom(subs, n = 12) {
  const r = subs?.filings?.recent; if (!r?.form) return [];
  const out = []; for (let i = 0; i < r.form.length; i++) if (r.form[i] === '8-K' && String(r.items?.[i] || '').split(',').includes('2.02')) out.push(r.filingDate[i]);
  return [...new Set(out)].sort().slice(-n);
}
// Daily bars with high, low and volume where market data allows, else closes only.
export async function ohlcv(symbol, userId, days = 800) {
  return cached(`ohlcv:${symbol}`, 30 * 60e3, async () => {
    if (D.dataEnabled()) {
      try {
        const b = (await D.bars([symbol], { timeframe: '1Day', start: new Date(Date.now() - days * DAY).toISOString().slice(0, 10), limit: 10000 }))?.[symbol];
        if (b?.length > 30) return { bars: b.map(r => ({ t: String(r.t).slice(0, 10), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v })), full: true, source: 'alpaca' };
      } catch {}
    }
    const g = await getBars(symbol, new Date(Date.now() - days * DAY).toISOString().slice(0, 10), userId);
    return { bars: g.closes.map((c, i) => ({ t: g.dates[i], c })), full: false, source: g.source };
  });
}
async function topOfBook(symbol) {
  if (!D.dataEnabled()) return null;
  try { const q = (await D.latest([symbol]))?.[symbol]?.quote; return q ? { bid: q.bp, ask: q.ap, bidSize: q.bs, askSize: q.as } : null; } catch { return null; }
}
const fyClose = (bars, end) => { let v = null; for (const b of bars) { if (b.t <= end) v = b.c; else break; } return v; };
// Sector P/E: the median trailing P/E of the large stocks in the same SEC industry group (first two
// digits of the SIC code). Built from the same cached data, at most once a day.
async function sectorPEs(userId) {
  return cached('sectorPE', DAY, async () => {
    const groups = {};
    for (let i = 0; i < UNIVERSE.length; i += 6) {
      await Promise.all(UNIVERSE.slice(i, i + 6).map(async s => {
        try {
          const id = await cikOf(s); if (!id) return;
          const [subs, facts, px] = await Promise.all([submissions(id.cik), companyFacts(id.cik), lastPrice(s, userId)]);
          const eps = annualSeries(facts.facts, ['EarningsPerShareDiluted', 'EarningsPerShareBasic'], 'USD/shares').at(-1)?.value;
          if (eps > 0 && px) (groups[String(subs.sic || '').slice(0, 2)] ||= []).push(px / eps);
        } catch {}
      }));
    }
    return Object.fromEntries(Object.entries(groups).filter(([, v]) => v.length >= 3).map(([k, v]) => [k, r2(median(v), 1)]));
  });
}
// The whole stock page, built once and cached for 6 hours (prices refresh separately).
export async function stockData(symbol, userId, { sector = true } = {}) {
  symbol = String(symbol || '').toUpperCase(); if (!SYM.test(symbol)) throw bad('Check the symbol');
  return cached(`stock:${symbol}`, 6 * 3600e3, async () => {
    const id = await cikOf(symbol);
    const [px, series] = await Promise.all([lastPrice(symbol, userId).catch(() => null), ohlcv(symbol, userId).catch(() => null)]);
    if (!id) return { symbol, kind: 'fund-or-foreign', name: symbol, price: px, series, note: 'No SEC company filings for this symbol (funds and many foreign companies do not file them). Valuation and fundamentals are not available.' };
    const [factsDoc, subs] = await Promise.all([companyFacts(id.cik), submissions(id.cik).catch(() => null)]);
    const facts = factsDoc.facts, st = statements(facts), q = quarterlySeries(facts);
    const ttmEps = q.length >= 4 ? r2(q.slice(-4).reduce((s, x) => s + x.value, 0), 2) : null;
    const bars = series?.bars || [], price = px ?? bars.at(-1)?.c ?? null;
    const fyPrices = Object.fromEntries(st.rows.map(x => [x.end, fyClose(bars, x.end)]).filter(([, v]) => v));
    let forwardEps = null, fh = null;
    // Forward EPS: the next quarter's analyst estimate × 4 (labelled on the page).
    if (eventsEnabled()) { fh = await fhEarnings(symbol).catch(() => null); forwardEps = fh?.next?.epsEstimate ? fh.next.epsEstimate * 4 : null; }
    const sic2 = String(subs?.sic || '').slice(0, 2), sectorPE = sector ? (await sectorPEs(userId).catch(() => ({})))[sic2] ?? null : null;
    const val = valuation({ price, rows: st.rows, ttmEps, fyPrices, forwardEps, sectorPE });
    const rt = keyRatios(st.rows);
    const reports = reportDatesFrom(subs);
    const closes = bars.map(b => b.c), dates = bars.map(b => b.t);
    const earn = { reports: earningsReactions(reports, closes, dates), quarters: q.map(x => ({ end: x.end, eps: x.value })), estimates: fh?.history || null, upcoming: fh?.next || null, next: nextEarnings(reports, fh?.next?.date || null), last: reports.at(-1) || null, keyed: eventsEnabled(),
      note: eventsEnabled() ? 'Expected EPS from Finnhub analyst estimates.' : 'Report dates and EPS come from SEC filings. Expected EPS, revenue and guidance need the Finnhub key (Admin → Keys); the next date is estimated.' };
    const div = dividendView(st.rows, price);
    return { symbol, kind: 'stock', name: factsDoc.entityName || id.name, sector: subs?.sicDescription || null, sic: subs?.sic || null, exchange: subs?.exchanges?.[0] || null, price, statements: st, ratios: rt, valuation: val, earnings: earn, dividends: div, series: { full: !!series?.full, source: series?.source || null }, range52: range52(closes), at: Date.now() };
  });
}
async function headlines(symbol) {
  if (!D.dataEnabled()) return [];
  return cached(`news:${symbol}`, 30 * 60e3, async () => ((await D.news({ symbols: [symbol], limit: 3 }).catch(() => null)) || []).map(n => ({ title: n.headline, url: n.url, at: n.created_at, source: n.source })));
}
export async function cardFor(symbol, userId) {
  return cached(`card:${symbol}`, 3 * 3600e3, async () => {
    const s = await stockData(symbol, userId, { sector: true }).catch(() => null);
    if (!s) return buildCard({ symbol, name: symbol });
    const sr = s.kind === 'stock' ? strengthsRisks({ ratios: s.ratios, val: s.valuation, div: s.dividends }) : null;
    const about = s.kind === 'stock' ? `${s.name}${s.sector ? ` · ${s.sector}` : ''}${s.exchange ? ` · listed on ${s.exchange}` : ''}.` : 'A fund, or a company without US SEC filings: no company figures to show. Its cost and holdings are on its fund page.';
    return buildCard({ symbol, name: s.name, about, sector: s.sector, val: s.valuation, div: s.dividends, earn: { last: s.earnings?.last, next: s.earnings?.next }, range52: s.range52, headlines: await headlines(symbol), sr, etf: s.kind !== 'stock' });
  });
}
async function aiSummary(s) {
  const { llmEnabled, jsonCall } = await import('./llm.js');
  const base = strengthsRisks({ ratios: s.ratios, val: s.valuation, div: s.dividends });
  if (!llmEnabled()) return { ...base, by: 'rules' };
  try {
    const facts = JSON.stringify({ name: s.name, sector: s.sector, ratios: s.ratios.latest, growth: { revenue: s.ratios.revenueGrowth, eps: s.ratios.epsGrowth, trend: s.ratios.revenueTrend }, valuation: { pe: s.valuation.pe, avg5: s.valuation.avg5, sectorPE: s.valuation.sectorPE, label: s.valuation.label.id }, dividend: s.dividends?.pays ? { yield: s.dividends.yieldPct, payout: s.dividends.payout, safety: s.dividends.safety.score } : null });
    const out = await jsonCall({ system: 'Write a plain-language summary of a company from the facts given only. No advice, no price targets, no predictions, never "guaranteed". Short sentences.', user: facts,
      schema: { type: 'object', properties: { summary: { type: 'string' }, strengths: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'strengths', 'risks'] } });
    const clean = a => (Array.isArray(a) ? a.map(String).filter(x => !/guarantee|risk-free|will (rise|go up)/i.test(x)).slice(0, 4) : []);
    return { summary: String(out.summary || '').slice(0, 600), strengths: clean(out.strengths), risks: clean(out.risks), by: 'ai' };
  } catch { return { ...base, by: 'rules' }; }
}
// Free members see two years of history and the rules summary; Pro unlocks five years, the AI
// summary and the volume profile. The rest is the same for everyone (DECISIONS.md G-6).
const trimFree = (s, paid) => {
  if (paid || s.kind !== 'stock') return { ...s, locked: false };
  return { ...s, locked: true, statements: { ...s.statements, rows: s.statements.rows.slice(-2) }, valuation: { ...s.valuation, history: s.valuation.history.slice(-2) } };
};

export const stockRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  const wrap = fn => (req, res) => fn(req, res).catch(e => res.status(e.status || 500).json({ error: e.status ? e.message : 'This data is not available right now. Try again in a minute.', ...(e.upgrade ? { upgrade: true, feature: e.feature } : {}) }));
  r.get('/compare', wrap(async (req, res) => {
    const list = [...new Set(String(req.query.symbols || '').toUpperCase().split(/[\s,]+/).filter(s => SYM.test(s)))].slice(0, 4);
    if (list.length < 2) throw bad('Pick two to four symbols');
    const rows = await Promise.all(list.map(async s => { const d = await stockData(s, req.user.id).catch(e => ({ symbol: s, error: e.message })); return d.error || d.kind !== 'stock' ? { symbol: s, error: d.error || d.note } : { symbol: s, name: d.name, sector: d.sector, price: d.price, pe: d.valuation.pe, avg5: d.valuation.avg5, peLabel: d.valuation.label.id, ps: d.valuation.ps, evEbitda: d.valuation.evEbitda, revenueGrowth: d.ratios.revenueGrowth, epsGrowth: d.ratios.epsGrowth, netMargin: d.ratios.latest.netMargin, roe: d.ratios.latest.roe, debtToEquity: d.ratios.latest.debtToEquity, dividendYield: d.dividends.pays ? d.dividends.yieldPct : 0, marketCap: d.valuation.marketCap }; }));
    res.json({ rows, note: NOT_ADVICE });
  }));
  r.get('/presets', (req, res) => res.json({ presets: PRESETS, keys: FILTER_KEYS }));
  // The growth-at-a-price scanner over the large-stock universe (rows cached with the stock data).
  r.post('/scan', wrap(async (req, res) => {
    const filters = req.body?.preset && PRESETS[req.body.preset] ? PRESETS[req.body.preset].filters : cleanFilters(req.body?.filters || {});
    const rows = await scanRows(req.user.id);
    res.json({ filters, rows: applyFilters(rows, filters), scanned: rows.length, note: NOT_ADVICE });
  }));
  r.get('/filters', wrap(async (req, res) => res.json({ saved: (await getSetting(req.user.id, 'valuescan:saved', [])) || [], paid: isPaid(req.user) })));
  r.post('/filters', wrap(async (req, res) => {
    if (!isPaid(req.user)) throw Object.assign(bad('Saved filters with alerts are part of the Pro plan'), { status: 402, upgrade: true, feature: 'Saved scanner filters and alerts' });
    const name = String(req.body?.name || '').trim().slice(0, 60); if (!name) throw bad('Give the filter a name');
    const list = ((await getSetting(req.user.id, 'valuescan:saved', [])) || []).filter(x => x.name !== name);
    if (list.length >= 20) throw bad('At most 20 saved filters');
    list.push({ name, filters: cleanFilters(req.body?.filters || {}), alert: !!req.body?.alert, seen: [] });
    await setSetting(req.user.id, 'valuescan:saved', list); res.json({ saved: list });
  }));
  r.delete('/filters/:name', wrap(async (req, res) => { const list = ((await getSetting(req.user.id, 'valuescan:saved', [])) || []).filter(x => x.name !== req.params.name); await setSetting(req.user.id, 'valuescan:saved', list); res.json({ saved: list }); }));
  r.get('/card/hidden', wrap(async (req, res) => res.json({ hidden: (await getSetting(req.user.id, 'precard:hide', [])) || [] })));
  r.post('/card/hidden', wrap(async (req, res) => {
    const s = String(req.body?.symbol || '').toUpperCase(); if (!SYM.test(s)) throw bad('Check the symbol');
    const cur = new Set((await getSetting(req.user.id, 'precard:hide', [])) || []); if (req.body?.hide === false) cur.delete(s); else cur.add(s);
    await setSetting(req.user.id, 'precard:hide', [...cur].slice(-500)); res.json({ hidden: [...cur] });
  }));
  r.get('/:symbol/card', wrap(async (req, res) => {
    const s = String(req.params.symbol).toUpperCase(); if (!SYM.test(s)) throw bad('Check the symbol');
    const hidden = ((await getSetting(req.user.id, 'precard:hide', [])) || []).includes(s);
    res.json(hidden ? { symbol: s, hidden: true } : await cardFor(s, req.user.id));
  }));
  r.get('/:symbol/technicals', wrap(async (req, res) => {
    const s = String(req.params.symbol).toUpperCase(); if (!SYM.test(s)) throw bad('Check the symbol');
    const series = await ohlcv(s, req.user.id), paid = isPaid(req.user);
    const sd = series.full ? supplyDemand(series.bars, await topOfBook(s)) : supplyDemand([]);
    res.json({ symbol: s, technical: technicalRead(series.bars), supply: paid || !sd.available ? sd : { ...sd, profile: null, locked: true }, bars: series.bars.slice(-260), full: series.full, source: series.source, paid });
  }));
  r.get('/:symbol', wrap(async (req, res) => {
    const s = String(req.params.symbol).toUpperCase(), paid = isPaid(req.user);
    const d = await stockData(s, req.user.id);
    const summary = d.kind === 'stock' ? (paid ? await cached(`ai:${s}`, DAY, () => aiSummary(d)) : { ...strengthsRisks({ ratios: d.ratios, val: d.valuation, div: d.dividends }), by: 'rules' }) : null;
    res.json({ ...trimFree(d, paid), summary, paid, note: NOT_ADVICE });
  }));
  return r;
})();
// Scanner rows for the large-stock universe, built from the cached stock data (once an hour).
export async function scanRows(userId) {
  return cached('scanRows', 3600e3, async () => {
    const rows = [];
    for (let i = 0; i < UNIVERSE.length; i += 6) {
      await Promise.all(UNIVERSE.slice(i, i + 6).map(async s => {
        try {
          const d = await stockData(s, userId, { sector: false }); if (d.kind !== 'stock') return;
          const est = d.earnings?.estimates; const beats = Array.isArray(est) ? est.slice(0, 4).filter(x => x.eps != null && x.estimate != null && x.eps > x.estimate).length : null;
          rows.push({ symbol: s, name: d.name, price: d.price, pe: d.valuation.pe, epsGrowth: d.ratios.epsGrowth, revenueGrowth: d.ratios.revenueGrowth, revenueTrend: d.ratios.revenueTrend, netMargin: d.ratios.latest.netMargin, fcf: d.statements.rows.at(-1)?.fcf ?? null, beats, dividendYield: d.dividends.pays ? d.dividends.yieldPct : 0, peLabel: d.valuation.label.id });
        } catch {}
      }));
    }
    return rows;
  });
}
// Daily: saved filters with alerts on tell the member about symbols that newly match.
export async function runValueAlerts() {
  const { all } = await import('./db.js'); const { notifyUser } = await import('./notify-user.js');
  const users = await all("SELECT user_id FROM user_settings WHERE k = 'valuescan:saved'").catch(() => []);
  let sent = 0;
  for (const { user_id: uid } of users) {
    const list = (await getSetting(uid, 'valuescan:saved', [])) || []; if (!list.some(x => x.alert)) continue;
    const rows = await scanRows(uid).catch(() => []);
    for (const f of list.filter(x => x.alert)) {
      const now = applyFilters(rows, f.filters).map(x => x.symbol), fresh = now.filter(x => !(f.seen || []).includes(x));
      if (fresh.length) { await notifyUser(uid, `Scanner "${f.name}": new matches ${fresh.slice(0, 8).join(', ')}. Information, not advice.`).catch(() => {}); sent++; }
      f.seen = now;
    }
    await setSetting(uid, 'valuescan:saved', list);
  }
  return sent;
}
