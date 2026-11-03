// Portfolio & risk (also the practice tools): for any account, the paper account included.
//   allocation    by holding, by kind (stocks, funds, leveraged funds, crypto, cash), by sector
//   concentration the biggest holding, the top 3, how many holdings it "acts like", plain warnings
//   performance   the account's own history vs the S&P 500, worst drop, how bumpy it is
//   risk          beta to the market, a bad day (1 day in 20) and the worst day in the last year
//   scenarios     the market falling 10/20%, past crashes, or any move the user picks
//   what if       add a pretend holding ("what if I bought $1,000 of TSLA?") without trading
// Everything is an estimate from past prices; the page says so.
import express from 'express';
import { requireUser } from './auth.js';
import { accountSummary, getBars, portfolioHistory, lastPrice, validSymbol, ACCOUNT_IDS } from './brokers.js';
import { isLeveraged } from './rotation/blueprints.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const yearsAgo = n => new Date(Date.now() - n * 365 * 864e5).toISOString().slice(0, 10);
const r2 = x => (x == null || !Number.isFinite(+x) ? null : Math.round(+x * 100) / 100);
const FUNDS = new Set('SPY VOO IVV VTI QQQ DIA IWM VEA VWO EFA EEM AGG BND TLT IEF SHY BIL GLD SLV VNQ XLK XLF XLE XLV XLY XLP XLI XLU XLB XLRE XLC SCHD VIG VYM ARKK SMH SOXX IBIT FBTC GBTC SH PSQ BTAL BSV KMLM'.split(' '));
const SECTOR = { AAPL: 'Technology', MSFT: 'Technology', NVDA: 'Technology', AMD: 'Technology', INTC: 'Technology', AVGO: 'Technology', ORCL: 'Technology', ADBE: 'Technology', CRM: 'Technology', CSCO: 'Technology', QCOM: 'Technology', TXN: 'Technology', MU: 'Technology', PLTR: 'Technology',
  GOOGL: 'Communication', GOOG: 'Communication', META: 'Communication', NFLX: 'Communication', DIS: 'Communication', TMUS: 'Communication', VZ: 'Communication', T: 'Communication',
  AMZN: 'Consumer discretionary', TSLA: 'Consumer discretionary', HD: 'Consumer discretionary', MCD: 'Consumer discretionary', NKE: 'Consumer discretionary', SBUX: 'Consumer discretionary',
  WMT: 'Consumer staples', COST: 'Consumer staples', PG: 'Consumer staples', KO: 'Consumer staples', PEP: 'Consumer staples', PM: 'Consumer staples',
  JPM: 'Financials', BAC: 'Financials', WFC: 'Financials', GS: 'Financials', MS: 'Financials', V: 'Financials', MA: 'Financials', 'BRK.B': 'Financials',
  UNH: 'Health care', JNJ: 'Health care', LLY: 'Health care', ABBV: 'Health care', MRK: 'Health care', PFE: 'Health care', TMO: 'Health care', AMGN: 'Health care',
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy', CAT: 'Industrials', GE: 'Industrials', BA: 'Industrials', HON: 'Industrials', UPS: 'Industrials', LIN: 'Materials', NEE: 'Utilities',
  XLK: 'Technology', XLC: 'Communication', XLY: 'Consumer discretionary', XLP: 'Consumer staples', XLF: 'Financials', XLV: 'Health care', XLE: 'Energy', XLI: 'Industrials', XLB: 'Materials', XLU: 'Utilities', XLRE: 'Real estate', VNQ: 'Real estate', SMH: 'Technology', SOXX: 'Technology' };
export const kindOf = s => (s.includes('/') || /^(IBIT|FBTC|GBTC)$/.test(s) ? 'Crypto' : isLeveraged(s) ? 'Leveraged funds' : FUNDS.has(s) ? 'Funds' : 'Stocks');
export const sectorOf = s => (s.includes('/') ? 'Crypto' : isLeveraged(s) ? 'Leveraged index funds' : ['SPY', 'VOO', 'IVV', 'VTI', 'QQQ', 'DIA', 'IWM'].includes(s) ? 'Broad market' : ['AGG', 'BND', 'TLT', 'IEF', 'SHY', 'BIL', 'BSV'].includes(s) ? 'Bonds' : ['GLD', 'SLV'].includes(s) ? 'Gold and metals' : SECTOR[s] || 'Other');

// Concentration: weights (fractions of the invested money) → plain-words picture.
export function concentration(rows, equity) {
  const invested = rows.reduce((a, r) => a + r.value, 0);
  const w = rows.map(r => ({ symbol: r.symbol, w: invested ? r.value / invested : 0, ofEquity: equity ? r.value / equity : 0 })).sort((a, b) => b.w - a.w);
  const hhi = w.reduce((a, x) => a + x.w * x.w, 0);
  const top = w[0], top3 = w.slice(0, 3).reduce((a, x) => a + x.w, 0);
  const warnings = [];
  if (top && top.w > 0.2 && rows.length > 1) warnings.push(`${top.symbol} is ${Math.round(top.w * 100)}% of what you hold. If it fell 30%, your holdings would fall about ${Math.round(top.w * 30)}% from that alone.`);
  if (rows.length === 1 && top) warnings.push(`Everything is in one holding (${top.symbol}). One company or fund going wrong hits all of it.`);
  return { holdings: rows.length, top: top ? { symbol: top.symbol, pct: r2(top.w * 100) } : null, top3Pct: r2(top3 * 100), hhi: r2(hhi), actsLike: hhi ? r2(1 / hhi) : 0, warnings };
}
const groupBy = (rows, key, total) => {
  const m = new Map(); for (const r of rows) m.set(key(r), (m.get(key(r)) || 0) + r.value);
  return [...m.entries()].map(([name, value]) => ({ name, value: r2(value), pct: total ? r2(value / total * 100) : 0 })).sort((a, b) => b.value - a.value);
};
const stats = rs => { const n = rs.length; if (!n) return null; const m = rs.reduce((a, x) => a + x, 0) / n; const sd = Math.sqrt(rs.reduce((a, x) => a + (x - m) ** 2, 0) / n); return { mean: m, sd }; };
const dd = series => { let peak = -Infinity, worst = 0; for (const v of series) { peak = Math.max(peak, v); if (peak > 0) worst = Math.min(worst, v / peak - 1); } return worst; };

export async function analyze(userId, account = 'paper', extra = []) {
  const s = await accountSummary(userId, account);
  const rows = s.positions.filter(p => p.value > 0).map(p => ({ symbol: p.symbol, qty: p.qty, value: +p.value, pnl: p.pnl ?? null, pretend: false }));
  for (const x of extra) { const ex = rows.find(r => r.symbol === x.symbol); if (ex) { ex.value += x.value; ex.pretend = true; } else rows.push({ symbol: x.symbol, qty: null, value: x.value, pnl: null, pretend: true }); }
  const pretendCash = extra.reduce((a, x) => a + x.value, 0);
  const cash = Math.max(0, (s.cash || 0) - pretendCash), equity = rows.reduce((a, r) => a + r.value, 0) + cash;
  // One year of daily prices for each holding and SPY.
  const spy = await getBars('SPY', yearsAgo(2), userId), spyR = spy.closes.slice(1).map((x, i) => x / spy.closes[i] - 1).slice(-252);
  const series = {};
  for (const r of rows.slice(0, 30)) { try { const b = await getBars(r.symbol, yearsAgo(2), userId); series[r.symbol] = b.closes.slice(1).map((x, i) => x / b.closes[i] - 1).slice(-252); } catch { series[r.symbol] = null; } }
  const betaOf = sym => {
    const a = series[sym]; if (!a?.length) return sym.includes('/') ? 2 : 1;
    const n = Math.min(a.length, spyR.length), x = a.slice(-n), m = spyR.slice(-n), mx = x.reduce((p, v) => p + v, 0) / n, mm = m.reduce((p, v) => p + v, 0) / n;
    const cov = x.reduce((p, v, i) => p + (v - mx) * (m[i] - mm), 0), vm = m.reduce((p, v) => p + (v - mm) ** 2, 0);
    return vm ? cov / vm : 1;
  };
  for (const r of rows) { r.beta = r2(betaOf(r.symbol)); r.kind = kindOf(r.symbol); r.sector = sectorOf(r.symbol); r.pct = equity ? r2(r.value / equity * 100) : 0; r.value = r2(r.value); }
  const invested = rows.reduce((a, r) => a + r.value, 0);
  const beta = invested ? rows.reduce((a, r) => a + r.value * r.beta, 0) / invested : 0;
  // Daily returns of today's mix over the last year (cash earns nothing here).
  const n = Math.min(spyR.length, ...rows.map(r => series[r.symbol]?.length || spyR.length));
  const daily = [];
  for (let i = 0; i < n; i++) { let v = 0; for (const r of rows) { const a = series[r.symbol]; const ri = a ? a[a.length - n + i] : spyR[spyR.length - n + i] * r.beta; v += (r.value / (equity || 1)) * (ri || 0); } daily.push(v); }
  const sorted = [...daily].sort((a, b) => a - b), q05 = sorted.length ? sorted[Math.floor(sorted.length * 0.05)] : 0, worst = sorted[0] ?? 0;
  const st = stats(daily);
  const kinds = groupBy([...rows, ...(cash ? [{ symbol: 'Cash', value: cash, kind: 'Cash' }] : [])], r => r.kind, equity);
  const sectors = groupBy(rows, r => r.sector, invested);
  const conc = concentration(rows, equity);
  const lev = kinds.find(k => k.name === 'Leveraged funds'), cry = kinds.find(k => k.name === 'Crypto'), topSector = sectors[0];
  if (lev && lev.pct > 0) conc.warnings.push(`${lev.pct}% is in leveraged funds. They move 2-3 times the market each day and can lose most of their value in a bad stretch, even if the market later recovers.`);
  if (cry && cry.pct > 10) conc.warnings.push(`${cry.pct}% is in crypto, which often moves 3-5% in a day and has fallen more than 70% before.`);
  if (topSector && topSector.pct > 40 && !['Broad market', 'Bonds'].includes(topSector.name) && rows.length > 1) conc.warnings.push(`${topSector.pct}% of what you hold is in ${topSector.name.toLowerCase()}. One bad stretch for that part of the market would hit most of it.`);
  // Performance from the account's own history.
  const hist = await portfolioHistory(userId, account).catch(() => []);
  const eq = hist.map(h => h.equity).filter(Number.isFinite);
  const perf = eq.length > 1 ? { from: hist[0].day, to: hist.at(-1).day, returnPct: r2((eq.at(-1) / eq[0] - 1) * 100), maxDrawdownPct: r2(dd(eq) * 100),
    spyPct: (() => { const i = spy.dates.findIndex(d => d >= hist[0].day); return i >= 0 ? r2((spy.closes.at(-1) / spy.closes[i] - 1) * 100) : null; })() } : null;
  const scen = [['Market falls 10%', -10], ['Market falls 20%', -20], ['2022 bear market (S&P 500 -25%)', -25], ['2020 COVID crash (S&P 500 -34%)', -34], ['2008 financial crisis (S&P 500 -55%)', -55]];
  return {
    account, equity: r2(equity), cash: r2(cash), invested: r2(invested), pretend: extra.length ? extra : null,
    holdings: rows.sort((a, b) => b.value - a.value), byKind: kinds, bySector: sectors, concentration: conc,
    risk: { beta: r2(beta), volatilityYearPct: st ? r2(st.sd * Math.sqrt(252) * 100) : null, badDayPct: r2(q05 * 100), badDay: r2(q05 * equity), worstDayPct: r2(worst * 100), worstDay: r2(worst * equity), days: daily.length },
    performance: perf,
    scenarios: scen.map(([name, m]) => { const loss = rows.reduce((a, r) => a + r.value * Math.max(-1, r.beta * m / 100), 0); return { name, marketMovePct: m, loss: r2(loss), pct: equity ? r2(loss / equity * 100) : 0, after: r2(equity + loss) }; }),
  };
}

export const portfolioRiskRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const account = String(req.query.account || 'paper');
    if (!ACCOUNT_IDS.includes(account) && !/^alpaca/.test(account)) throw bad('Pick an account');
    // "add=TSLA:1000,AAPL:500": pretend holdings in dollars, priced now.
    const extra = [];
    for (const part of String(req.query.add || '').split(',').filter(Boolean).slice(0, 5)) {
      const [sym, amt] = part.split(':'), s = String(sym || '').trim().toUpperCase(), v = +amt;
      if (!validSymbol(s) && !/^[A-Z0-9]{2,10}\/[A-Z]{3,4}$/.test(s)) throw bad(`"${sym}" is not a valid symbol`);
      if (!(v > 0 && v <= 1e7)) throw bad('Pretend amounts are dollars from $1 to $10,000,000');
      if (!s.includes('/')) await lastPrice(s, req.user.id).catch(() => { throw bad(`No price for ${s}`); });
      extra.push({ symbol: s, value: v });
    }
    res.json(await analyze(req.user.id, account, extra));
  });
  return r;
})();
