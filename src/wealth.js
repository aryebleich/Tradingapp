// Wealth builder: the long-term habits that work for most investors, each with a tool.
// Index funds compared by cost and record · compound growth (client) · automatic monthly or weekly
// buys of a fund mix (scheduled orders) · buy-and-hold check of the user's own trading ·
// automatic dividend reinvestment (DRIP) · a fundamentals checklist from SEC filings ·
// tax-advantaged account limits (client) · core-satellite plans (built as a rule-based portfolio)
// · sector and region diversification · twice-yearly rebalance reminders.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser } from './auth.js';
import { getBars, accountSummary, placeOrder, ACCOUNT_IDS } from './brokers.js';
import { isPaid } from './fees.js';
import { getSetting, setSetting } from './settings.js';
import { get, secData, secWww, secCached } from './institutions.js';
import { tradingForAccount } from './alpaca/connections.js';
import { notifyUser } from './notify-user.js';
import { nyTime } from './time.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const upgrade = feature => Object.assign(new Error(`${feature} is part of the Pro plan`), { status: 402, upgrade: true, feature });

// ---------- index funds ----------
export const INDEX_FUNDS = [
  { symbol: 'VTI', name: 'Vanguard Total Stock Market', tracks: 'Whole US market (~3,600 companies)', fee: 0.03, kind: 'core' },
  { symbol: 'ITOT', name: 'iShares Core S&P Total US Stock', tracks: 'Whole US market', fee: 0.03, kind: 'core' },
  { symbol: 'VOO', name: 'Vanguard S&P 500', tracks: '500 largest US companies', fee: 0.03, kind: 'core' },
  { symbol: 'SPLG', name: 'SPDR Portfolio S&P 500', tracks: '500 largest US companies', fee: 0.02, kind: 'core' },
  { symbol: 'VT', name: 'Vanguard Total World Stock', tracks: 'The whole world (~9,800 companies)', fee: 0.06, kind: 'core' },
  { symbol: 'VXUS', name: 'Vanguard Total International Stock', tracks: 'Everything outside the US', fee: 0.05, kind: 'international' },
  { symbol: 'QQQM', name: 'Invesco Nasdaq-100', tracks: '100 largest Nasdaq companies (tech-heavy)', fee: 0.15, kind: 'growth' },
  { symbol: 'BND', name: 'Vanguard Total Bond Market', tracks: 'US investment-grade bonds', fee: 0.03, kind: 'bonds' },
];
let fundCache = null;
async function fundRecords(userId) {
  if (fundCache && now() - fundCache.at < 12 * 3600e3) return fundCache.v;
  const start = new Date(Date.now() - 10.5 * 365 * 864e5).toISOString().slice(0, 10);
  const v = await Promise.all(INDEX_FUNDS.map(async f => {
    try {
      const b = await getBars(f.symbol, start, userId), c = b.closes, n = c.length;
      const cagr = y => (n > y * 252 ? ((c[n - 1] / c[n - 1 - y * 252]) ** (1 / y) - 1) * 100 : null);
      return { ...f, price: c[n - 1], cagr5: cagr(5), cagr10: cagr(10) };
    } catch { return { ...f }; }
  }));
  fundCache = { at: now(), v };
  return v;
}

// ---------- sectors and regions ----------
const ETF_CLASS = {
  VTI: ['Broad US market', 'United States'], ITOT: ['Broad US market', 'United States'], VOO: ['Broad US market', 'United States'], SPY: ['Broad US market', 'United States'], IVV: ['Broad US market', 'United States'], SPLG: ['Broad US market', 'United States'],
  QQQ: ['Technology', 'United States'], QQQM: ['Technology', 'United States'], VT: ['Broad world market', 'Global'], VXUS: ['Broad world market', 'International'], VEA: ['Broad world market', 'Developed markets'],
  IEFA: ['Broad world market', 'Developed markets'], EFA: ['Broad world market', 'Developed markets'], VWO: ['Broad world market', 'Emerging markets'], EEM: ['Broad world market', 'Emerging markets'],
  BND: ['Bonds', 'United States'], AGG: ['Bonds', 'United States'], TLT: ['Bonds', 'United States'], SHY: ['Bonds', 'United States'], BIL: ['Cash & T-bills', 'United States'], SGOV: ['Cash & T-bills', 'United States'],
  GLD: ['Gold & commodities', 'Global'], IAU: ['Gold & commodities', 'Global'], SMH: ['Technology', 'United States'], XLK: ['Technology', 'United States'], XLF: ['Financials', 'United States'],
  XLV: ['Healthcare', 'United States'], XLE: ['Energy', 'United States'], ICLN: ['Clean energy', 'Global'], BOTZ: ['Technology', 'Global'], AIQ: ['Technology', 'Global'], CIBR: ['Technology', 'Global'], VNQ: ['Real estate', 'United States'],
  TQQQ: ['Technology', 'United States'], SOXL: ['Technology', 'United States'],
};
const SECTOR_OF = {
  AAPL: 'Technology', MSFT: 'Technology', NVDA: 'Technology', AVGO: 'Technology', AMD: 'Technology', ORCL: 'Technology', CRM: 'Technology', ADBE: 'Technology', INTC: 'Technology', CSCO: 'Technology', IBM: 'Technology', QCOM: 'Technology', TSM: 'Technology',
  GOOGL: 'Communication', GOOG: 'Communication', META: 'Communication', NFLX: 'Communication', DIS: 'Communication', T: 'Communication', VZ: 'Communication', TMUS: 'Communication',
  AMZN: 'Consumer', TSLA: 'Consumer', HD: 'Consumer', MCD: 'Consumer', NKE: 'Consumer', SBUX: 'Consumer', WMT: 'Consumer', COST: 'Consumer', PG: 'Consumer', KO: 'Consumer', PEP: 'Consumer', TGT: 'Consumer',
  JPM: 'Financials', BAC: 'Financials', WFC: 'Financials', GS: 'Financials', MS: 'Financials', V: 'Financials', MA: 'Financials', 'BRK.B': 'Financials', AXP: 'Financials', BLK: 'Financials',
  JNJ: 'Healthcare', UNH: 'Healthcare', LLY: 'Healthcare', PFE: 'Healthcare', MRK: 'Healthcare', ABBV: 'Healthcare', TMO: 'Healthcare', ABT: 'Healthcare',
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy', CAT: 'Industrials', BA: 'Industrials', GE: 'Industrials', HON: 'Industrials', UPS: 'Industrials', NEE: 'Utilities', DUK: 'Utilities',
};
const sicSector = sic => {
  const n = +sic;
  if (!n) return null;
  if (n === 1311 || (n >= 2900 && n < 3000) || (n >= 1300 && n < 1400)) return 'Energy';
  if ((n >= 2830 && n < 2840) || (n >= 3840 && n < 3860) || (n >= 8000 && n < 8100)) return 'Healthcare';
  if ((n >= 3570 && n < 3580) || (n >= 3660 && n < 3680) || (n >= 7370 && n < 7380)) return 'Technology';
  if (n >= 4800 && n < 4900) return 'Communication';
  if (n >= 4900 && n < 5000) return 'Utilities';
  if (n === 6798) return 'Real estate';
  if (n >= 6000 && n < 6800) return 'Financials';
  if ((n >= 5000 && n < 6000) || (n >= 2000 && n < 2400) || n === 3711) return 'Consumer';
  if (n >= 1000 && n < 1500) return 'Materials';
  if (n >= 2000 && n < 4000) return 'Industrials';
  return null;
};
async function cikMap() {
  return secCached('sec:cik', 7 * 864e5, async () => {
    const d = await get(`${secWww()}/files/company_tickers.json`), m = {};
    for (const r of Object.values(d)) m[r.ticker] = String(r.cik_str).padStart(10, '0');
    return m;
  });
}
async function classify(symbol) {
  if (symbol.includes('/')) return ['Crypto', 'Global'];
  if (ETF_CLASS[symbol]) return ETF_CLASS[symbol];
  if (SECTOR_OF[symbol]) return [SECTOR_OF[symbol], 'United States'];
  try {
    const cik = (await cikMap())[symbol.replace('.', '-')];
    if (!cik) return ['Other', 'Unknown'];
    const sub = await secCached('sec:sub:' + cik, 30 * 864e5, () => get(`${secData()}/submissions/CIK${cik}.json`));
    const country = sub.addresses?.business?.stateOrCountry, us = !country || /^[A-Z]{2}$/.test(country) && !['A0', 'A1', 'A2'].includes(country);
    return [sicSector(sub.sic) || 'Other', sub.addresses?.business?.isForeignLocation ? 'International' : us ? 'United States' : 'International'];
  } catch { return ['Other', 'Unknown']; }
}
export async function diversification(userId, account) {
  const s = await accountSummary(userId, account);
  const pos = (s.positions || []).filter(p => p.value > 0 || p.qty > 0).map(p => ({ symbol: p.symbol, value: +p.value || +p.qty * +p.price || 0 }));
  const total = pos.reduce((a, p) => a + p.value, 0);
  const groups = { sector: {}, region: {} };
  for (const p of pos) {
    const [sector, region] = await classify(p.symbol);
    (groups.sector[sector] ||= { value: 0, symbols: [] }).value += p.value; groups.sector[sector].symbols.push(p.symbol);
    (groups.region[region] ||= { value: 0, symbols: [] }).value += p.value; groups.region[region].symbols.push(p.symbol);
  }
  const list = g => Object.entries(g).map(([name, v]) => ({ name, value: +v.value.toFixed(2), pct: total ? +(v.value / total * 100).toFixed(1) : 0, symbols: v.symbols })).sort((a, b) => b.value - a.value);
  const sectors = list(groups.sector), regions = list(groups.region);
  const warnings = [];
  const broad = ['Broad US market', 'Broad world market'];
  const top = sectors.find(x => !broad.includes(x.name));
  if (top && top.pct > 40) warnings.push(`${top.pct}% is in ${top.name}. A downturn in one industry would hit most of your money.`);
  const bigOne = [...pos].sort((a, b) => b.value - a.value)[0];
  if (bigOne && total && bigOne.value / total > 0.25 && !ETF_CLASS[bigOne.symbol]) warnings.push(`${bigOne.symbol} alone is ${(bigOne.value / total * 100).toFixed(0)}% of the account.`);
  const us = regions.find(r => r.name === 'United States');
  if (us && us.pct > 95 && pos.length) warnings.push('Almost everything is in the United States. A world or international fund (VT, VXUS) spreads the risk across countries.');
  return { total: +total.toFixed(2), positions: pos.length, sectors, regions, warnings };
}

// ---------- fundamentals checklist from SEC filings (XBRL company facts) ----------
const annual = (facts, names, unit = 'USD') => {
  for (const n of names) {
    const rows = facts?.['us-gaap']?.[n]?.units?.[unit];
    if (!rows) continue;
    const byYear = {};
    for (const r of rows) if (r.form === '10-K' && r.fp === 'FY' && (!r.frame || /^CY\d{4}$/.test(r.frame))) byYear[r.fy] = r.val;
    const ys = Object.keys(byYear).map(Number).sort();
    if (ys.length) return ys.slice(-5).map(y => ({ year: y, value: byYear[y] }));
  }
  return [];
};
export async function fundamentals(symbol) {
  symbol = String(symbol || '').toUpperCase().trim();
  if (!/^[A-Z.\-]{1,10}$/.test(symbol)) throw bad('Enter a stock ticker');
  const cik = (await cikMap())[symbol.replace('.', '-')];
  if (!cik) throw bad(`No SEC filer found for ${symbol}. Funds and foreign companies may not file here.`, 404);
  const d = await secCached('sec:facts:' + cik, 7 * 864e5, () => get(`${secData()}/api/xbrl/companyfacts/CIK${cik}.json`));
  const f = d.facts;
  const revenue = annual(f, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet']);
  const eps = annual(f, ['EarningsPerShareDiluted', 'EarningsPerShareBasic'], 'USD/shares');
  const income = annual(f, ['NetIncomeLoss']);
  const liabilities = annual(f, ['Liabilities']), equity = annual(f, ['StockholdersEquity']), debt = annual(f, ['LongTermDebtNoncurrent', 'LongTermDebt']);
  const growth = s => (s.length >= 2 && s[0].value > 0 ? ((s.at(-1).value / s[0].value) ** (1 / (s.at(-1).year - s[0].year || 1)) - 1) * 100 : null);
  const revG = growth(revenue), epsG = growth(eps.filter(x => x.value > 0));
  const de = debt.at(-1) && equity.at(-1)?.value > 0 ? debt.at(-1).value / equity.at(-1).value : null;
  const margin = income.at(-1) && revenue.at(-1)?.value > 0 ? income.at(-1).value / revenue.at(-1).value * 100 : null;
  const checks = [
    { name: 'Revenue growing', pass: revG == null ? null : revG > 3, detail: revG == null ? 'Not reported' : `${revG.toFixed(1)}% a year over ${revenue.length} years` },
    { name: 'Earnings per share growing', pass: epsG == null ? null : epsG > 3, detail: epsG == null ? 'Not enough positive years' : `${epsG.toFixed(1)}% a year` },
    { name: 'Profitable', pass: income.at(-1) ? income.at(-1).value > 0 : null, detail: margin == null ? 'Not reported' : `Net margin ${margin.toFixed(1)}%` },
    { name: 'Low debt', pass: de == null ? null : de < 1, detail: de == null ? 'Not reported' : `Long-term debt is ${de.toFixed(2)}× shareholders' equity` },
    { name: 'Earnings every year', pass: eps.length ? eps.every(x => x.value > 0) : null, detail: eps.map(x => `${x.year}: $${x.value}`).join(' · ') || 'Not reported' },
  ];
  return { symbol, company: d.entityName, revenue, eps, income, liabilities, equity, checks, score: checks.filter(c => c.pass).length, of: checks.filter(c => c.pass != null).length };
}

// ---------- buy-and-hold check of the user's own trading ----------
export async function habits(user, account) {
  const fills = await all('SELECT symbol, side, qty, price, at FROM fills WHERE user_id = ? AND account = ? ORDER BY at', user.id, account);
  const lots = {}, held = [];
  let shortGain = 0, longGain = 0;
  for (const f of fills) {
    const q = lots[f.symbol] ||= [];
    if (f.side === 'buy') { q.push({ qty: f.qty, price: f.price, at: f.at }); continue; }
    let left = f.qty;
    while (left > 1e-9 && q.length) {
      const l = q[0], take = Math.min(left, l.qty), days = (f.at - l.at) / 864e5;
      const g = take * (f.price - l.price);
      if (days > 365) longGain += g; else shortGain += g;
      held.push(days); l.qty -= take; left -= take; if (l.qty <= 1e-9) q.shift();
    }
  }
  const span = fills.length ? Math.max(30, (now() - fills[0].at) / 864e5) : 0;
  const tradesPerYear = span ? fills.length / span * 365 : 0;
  const median = held.length ? [...held].sort((a, b) => a - b)[Math.floor(held.length / 2)] : null;
  const bracket = +user.tax_bracket || 0.24, extraTax = Math.max(0, shortGain) * Math.max(0, bracket - 0.15);
  return {
    trades: fills.length, tradesPerYear: +tradesPerYear.toFixed(1), medianHoldDays: median == null ? null : Math.round(median),
    shortGain: +shortGain.toFixed(2), longGain: +longGain.toFixed(2), extraTax: +extraTax.toFixed(2), bracket,
    verdict: !fills.length ? 'No trades yet.' : tradesPerYear > 50 ? 'Very active: frequent trading usually loses to holding a fund, after taxes and costs.' : median != null && median < 365 ? 'Most sales come within a year, taxed at your full rate. Holding over a year cuts the tax.' : 'Good: you hold for the long term.',
  };
}

// ---------- automatic dividend reinvestment ----------
export async function runDrip() {
  let bought = 0;
  for (const row of await all("SELECT user_id, v FROM user_settings WHERE k = 'drip'")) {
    let cfg; try { cfg = JSON.parse(row.v); } catch { continue; }
    for (const account of (cfg.accounts || []).filter(a => a !== 'paper')) {
      const t = await tradingForAccount(row.user_id, account).catch(() => null);
      if (!t) continue;
      const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
      const divs = await t.activities({ activity_types: 'DIV', after: since, page_size: 100 }).catch(() => []);
      for (const d of Array.isArray(divs) ? divs : []) {
        const amount = +d.net_amount;
        if (!(amount >= 1) || !d.symbol) continue; // fractional buys start at $1
        const claimed = await run('INSERT OR IGNORE INTO drip_log (user_id, activity_id, symbol, amount, at) VALUES (?,?,?,?,?)', row.user_id, String(d.id), d.symbol, amount, now());
        if (!claimed.changes) continue;
        try {
          await placeOrder(row.user_id, account, { symbol: d.symbol, side: 'buy', notional: Math.floor(amount * 100) / 100 }, 'drip');
          bought++;
          await notifyUser(row.user_id, `Dividend reinvested: $${amount.toFixed(2)} of ${d.symbol} bought back automatically (${account}).`);
        } catch (e) { console.warn('drip', row.user_id, d.symbol, e.message); }
      }
    }
  }
  return bought;
}

// ---------- twice-yearly rebalance reminder (opt-in) ----------
export async function rebalanceReminders(t = now()) {
  const n = nyTime(t);
  if (!['01', '07'].includes(n.day.slice(5, 7)) || +n.day.slice(8) !== 15) return 0;
  let sent = 0;
  for (const r of await all("SELECT user_id FROM user_settings WHERE k = 'rebalanceReminder' AND v = 'true'")) {
    await notifyUser(r.user_id, 'Twice-a-year check: open Wealth builder → Diversify & rebalance to see whether your mix drifted from your target, and bring it back.');
    sent++;
  }
  return sent;
}

export const wealthRouter = express.Router();
wealthRouter.use(requireUser);
const acctOf = req => (ACCOUNT_IDS.includes(req.query.account || req.body?.account) ? req.query.account || req.body.account : 'paper');
wealthRouter.get('/funds', async (req, res) => res.json(await fundRecords(req.user.id)));
wealthRouter.get('/diversify', async (req, res) => res.json(await diversification(req.user.id, acctOf(req))));
wealthRouter.get('/fundamentals/:symbol', async (req, res) => res.json(await fundamentals(req.params.symbol)));
wealthRouter.get('/habits', async (req, res) => res.json(await habits(req.user, acctOf(req))));
wealthRouter.get('/settings', async (req, res) => res.json({ drip: await getSetting(req.user.id, 'drip', { accounts: [] }), rebalanceReminder: !!(await getSetting(req.user.id, 'rebalanceReminder', false)), dripLog: await all('SELECT symbol, amount, at FROM drip_log WHERE user_id = ? ORDER BY id DESC LIMIT 20', req.user.id) }));
wealthRouter.put('/settings', async (req, res) => {
  const b = req.body || {};
  if (b.drip) {
    const accounts = (b.drip.accounts || []).filter(a => ACCOUNT_IDS.includes(a) && a !== 'paper');
    if (accounts.length && !isPaid(req.user)) throw upgrade('Automatic dividend reinvestment');
    await setSetting(req.user.id, 'drip', { accounts });
  }
  if (b.rebalanceReminder !== undefined) await setSetting(req.user.id, 'rebalanceReminder', !!b.rebalanceReminder);
  await audit(req.user.id, 'wealth_settings', b, req.ip);
  res.json({ ok: true });
});
// Automatic investing in a mix of funds: one recurring buy per fund (Scheduled trades runs them).
wealthRouter.post('/autoinvest', async (req, res) => {
  const b = req.body || {}, account = acctOf(req);
  const amount = +b.amount, items = (b.items || []).map(i => ({ symbol: String(i.symbol || '').toUpperCase().trim(), weight: +i.weight })).filter(i => /^[A-Z.]{1,10}$/.test(i.symbol) && i.weight > 0);
  if (!(amount >= 5 && amount <= 1e6)) throw bad('Amount must be between $5 and $1,000,000');
  if (!items.length || items.length > 10) throw bad('Pick 1 to 10 funds');
  if (account !== 'paper' && !isPaid(req.user)) throw upgrade('Automatic investing in your brokerage account');
  const repeat = b.repeat === 'weekly' ? 'weekly' : 'monthly', day = Math.min(28, Math.max(1, Math.round(+b.day || 1)));
  const total = items.reduce((a, i) => a + i.weight, 0);
  const d = new Date(); d.setUTCDate(day); d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() < now()) { if (repeat === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1, day); else d.setTime(now() + 864e5); d.setUTCHours(14, 0, 0, 0); }
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  const ids = [];
  for (const i of items) {
    const part = +(amount * i.weight / total).toFixed(2);
    if (part < 1) throw bad(`${i.symbol} would get less than $1 a time; raise the amount or its share`);
    ids.push((await run('INSERT INTO scheduled_orders (user_id, account, symbol, side, qty, notional, repeat, next_run, created_at) VALUES (?,?,?,?,?,?,?,?,?)', req.user.id, account, i.symbol, 'buy', null, part, repeat, d.getTime(), now())).lastInsertRowid);
  }
  await audit(req.user.id, 'autoinvest_created', { account, amount, repeat, items }, req.ip);
  res.json({ ids, nextRun: d.getTime() });
});

// Today's headlines about what the user holds, for the moving news pop-ups.
wealthRouter.get('/holdings-news', async (req, res) => {
  const { news } = await import('./alpaca/data.js');
  const s = await accountSummary(req.user.id, acctOf(req)).catch(() => ({ positions: [] }));
  const syms = [...new Set((s.positions || []).map(p => p.symbol).filter(x => x && !x.includes('/')))].slice(0, 25);
  if (!syms.length) return res.json([]);
  const start = new Date(Date.now() - 24 * 3600e3).toISOString();
  const items = await news({ symbols: syms, limit: 15, start }).catch(() => []);
  res.json(items.map(n => ({ id: n.id, headline: n.headline, summary: String(n.summary || '').slice(0, 220), url: n.url, source: n.source, at: n.created_at, symbols: (n.symbols || []).filter(x => syms.includes(x)) })).filter(n => n.symbols.length));
});
