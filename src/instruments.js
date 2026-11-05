// More ways to invest, next to stocks and ETFs:
//  - Futures: quotes and contract specs for the main index, energy, metal, rate, currency and
//    bitcoin futures, with practice (paper) trading by the contract: margin, point value and P/L.
//    Live futures need a futures brokerage; Alpaca does not offer them.
//  - Mutual funds: the popular index funds with their yearly cost and minimum, their price (NAV),
//    paper investing, and the matching ETF to buy on a live account (Alpaca has no mutual funds).
//  - Savings: today's Treasury bill and savings yields, cash-like funds, savings offers the owner
//    lists, and the user's linked savings accounts.
//  - Rates and news for the bonds page: Treasury yields, mortgage rates, the Fed funds rate (FRED,
//    no key needed) and Federal Reserve press releases, with a local view by the user's state.
import express from 'express';
import { one, all, run, now } from './db.js';
import { requireUser } from './auth.js';
import { siteGet, siteSet } from './site.js';
import { getSetting } from './settings.js';
import * as DS from './datasources.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const r2 = (x, d = 2) => +(+x || 0).toFixed(d);
const offline = () => process.env.FREE_DATA === 'off' && !process.env.DATA_SOURCES_TEST;

// ---------- futures ----------
// root: name, Yahoo symbol, dollars per 1.00 move, tick size, exchange, group
export const FUTURES = {
  ES: ['E-mini S&P 500', 'ES=F', 50, 0.25, 'CME', 'Index'], MES: ['Micro E-mini S&P 500', 'MES=F', 5, 0.25, 'CME', 'Index'],
  NQ: ['E-mini Nasdaq-100', 'NQ=F', 20, 0.25, 'CME', 'Index'], MNQ: ['Micro E-mini Nasdaq-100', 'MNQ=F', 2, 0.25, 'CME', 'Index'],
  YM: ['E-mini Dow', 'YM=F', 5, 1, 'CBOT', 'Index'], MYM: ['Micro E-mini Dow', 'MYM=F', 0.5, 1, 'CBOT', 'Index'],
  RTY: ['E-mini Russell 2000', 'RTY=F', 50, 0.1, 'CME', 'Index'], M2K: ['Micro E-mini Russell 2000', 'M2K=F', 5, 0.1, 'CME', 'Index'],
  CL: ['Crude oil (WTI)', 'CL=F', 1000, 0.01, 'NYMEX', 'Energy'], MCL: ['Micro crude oil', 'MCL=F', 100, 0.01, 'NYMEX', 'Energy'], NG: ['Natural gas', 'NG=F', 10000, 0.001, 'NYMEX', 'Energy'],
  GC: ['Gold', 'GC=F', 100, 0.1, 'COMEX', 'Metals'], MGC: ['Micro gold', 'MGC=F', 10, 0.1, 'COMEX', 'Metals'], SI: ['Silver', 'SI=F', 5000, 0.005, 'COMEX', 'Metals'], HG: ['Copper', 'HG=F', 25000, 0.0005, 'COMEX', 'Metals'],
  ZN: ['10-Year Treasury Note', 'ZN=F', 1000, 0.015625, 'CBOT', 'Rates'], ZB: ['30-Year Treasury Bond', 'ZB=F', 1000, 0.03125, 'CBOT', 'Rates'],
  '6E': ['Euro FX', '6E=F', 125000, 0.00005, 'CME', 'Currencies'], '6J': ['Japanese yen', '6J=F', 12500000, 0.0000005, 'CME', 'Currencies'],
  ZC: ['Corn', 'ZC=F', 50, 0.25, 'CBOT', 'Grains'], ZS: ['Soybeans', 'ZS=F', 50, 0.25, 'CBOT', 'Grains'], ZW: ['Wheat', 'ZW=F', 50, 0.25, 'CBOT', 'Grains'],
  BTC: ['Bitcoin futures', 'BTC=F', 5, 5, 'CME', 'Crypto'], MBT: ['Micro bitcoin futures', 'MBT=F', 0.1, 5, 'CME', 'Crypto'],
};
export const MARGIN_RATE = 0.08; // a practice estimate of initial margin; exchanges set the real one
export async function futuresQuote(root) {
  const f = FUTURES[root]; if (!f) throw bad('Unknown contract');
  if (offline()) return { price: +(5000 + root.charCodeAt(0)).toFixed(2), source: 'simulated' };
  const p = await DS.PROVIDERS.yahoo.quote(f[1]).catch(() => null) || await DS.PROVIDERS.stooq.quote(`${root.toLowerCase()}.f`).catch(() => null);
  if (!p) throw bad('No futures quote right now; try again in a minute', 503);
  return { price: p, source: 'Yahoo Finance (delayed)' };
}
export function contractMath(root, price, contracts = 1) {
  const [name, , mult, tick] = FUTURES[root];
  const notional = price * mult * Math.abs(contracts);
  return { root, name, pointValue: mult, tick, tickValue: r2(tick * mult, 4), notional: r2(notional), margin: r2(notional * MARGIN_RATE), onePercent: r2(notional * 0.01) };
}
async function futuresPositions(userId) {
  const rows = await all('SELECT * FROM paper_futures WHERE user_id = ? ORDER BY root', userId), out = [];
  for (const r of rows) {
    const q = await futuresQuote(r.root).catch(() => null), mult = FUTURES[r.root][2];
    out.push({ root: r.root, name: FUTURES[r.root][0], contracts: r.contracts, entry: r.entry, price: q?.price ?? null, pnl: q ? r2((q.price - r.entry) * mult * r.contracts) : null, margin: q ? contractMath(r.root, q.price, r.contracts).margin : null });
  }
  return out;
}
// Practice trade: + buys (long), - sells (short); closing or reducing realizes the P/L in paper cash.
export async function tradeFutures(userId, root, contracts) {
  if (!FUTURES[root]) throw bad('Unknown contract');
  contracts = Math.trunc(+contracts); if (!contracts || Math.abs(contracts) > 50) throw bad('Trade 1 to 50 contracts');
  const { price } = await futuresQuote(root), mult = FUTURES[root][2];
  const acct = await one('SELECT cash FROM paper_accounts WHERE user_id = ?', userId); if (!acct) throw bad('Open the paper account first (Portfolio page)');
  const cur = await one('SELECT * FROM paper_futures WHERE user_id = ? AND root = ?', userId, root);
  const have = cur?.contracts || 0, next = have + contracts;
  let realized = 0;
  if (have && Math.sign(have) !== Math.sign(contracts)) realized = (price - cur.entry) * mult * Math.min(Math.abs(contracts), Math.abs(have)) * Math.sign(have);
  if (Math.abs(next) > Math.abs(have) || Math.sign(next) !== Math.sign(have)) {
    const used = (await futuresPositions(userId)).filter(p => p.root !== root).reduce((s, p) => s + (p.margin || 0), 0);
    const need = contractMath(root, price, next).margin;
    if (used + need > acct.cash + realized) throw bad(`Not enough paper cash for the margin: about $${Math.round(used + need).toLocaleString('en-US')} needed`, 409);
  }
  if (!next) await run('DELETE FROM paper_futures WHERE user_id = ? AND root = ?', userId, root);
  else if (!have || Math.sign(have) !== Math.sign(next)) await run('INSERT INTO paper_futures (user_id, root, contracts, entry, opened_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id, root) DO UPDATE SET contracts = excluded.contracts, entry = excluded.entry, opened_at = excluded.opened_at', userId, root, next, price, now());
  else if (Math.abs(next) > Math.abs(have)) await run('UPDATE paper_futures SET contracts = ?, entry = ? WHERE user_id = ? AND root = ?', next, (cur.entry * have + price * contracts) / next, userId, root);
  else await run('UPDATE paper_futures SET contracts = ? WHERE user_id = ? AND root = ?', next, userId, root);
  if (realized) await run('UPDATE paper_accounts SET cash = cash + ? WHERE user_id = ?', r2(realized), userId);
  return { root, contracts, price, position: next, realized: r2(realized) };
}

// ---------- mutual funds ----------
// symbol: name, yearly cost %, minimum $, matching ETF, category
export const MUTUAL_FUNDS = {
  FXAIX: ['Fidelity 500 Index', 0.015, 0, 'IVV', 'S&P 500'], VFIAX: ['Vanguard 500 Index Admiral', 0.04, 3000, 'VOO', 'S&P 500'], SWPPX: ['Schwab S&P 500 Index', 0.02, 0, 'SCHX', 'S&P 500'],
  FSKAX: ['Fidelity Total Market Index', 0.015, 0, 'ITOT', 'Whole US market'], VTSAX: ['Vanguard Total Stock Market Admiral', 0.04, 3000, 'VTI', 'Whole US market'], SWTSX: ['Schwab Total Stock Market Index', 0.03, 0, 'SCHB', 'Whole US market'],
  FTIHX: ['Fidelity Total International Index', 0.06, 0, 'IXUS', 'International'], VTIAX: ['Vanguard Total International Stock Admiral', 0.09, 3000, 'VXUS', 'International'],
  FXNAX: ['Fidelity US Bond Index', 0.025, 0, 'AGG', 'US bonds'], VBTLX: ['Vanguard Total Bond Market Admiral', 0.04, 3000, 'BND', 'US bonds'],
  VFFVX: ['Vanguard Target Retirement 2055', 0.08, 1000, 'VT', 'Target date (retire about 2055)'], FDEWX: ['Fidelity Freedom 2055', 0.75, 0, 'VT', 'Target date (actively managed)'],
  VWELX: ['Vanguard Wellington Investor', 0.25, 3000, 'AOR', 'Balanced 65/35 (active)'], AGTHX: ['American Funds Growth Fund of America A', 0.61, 250, 'VUG', 'Large growth (active, has a sales charge)'],
};

// ---------- savings and rates ----------
const FRED_SERIES = { DTB3: '3-month Treasury bill', DTB6: '6-month Treasury bill', DGS1: '1-year Treasury', DGS2: '2-year Treasury', DGS10: '10-year Treasury', DGS30: '30-year Treasury', MORTGAGE30US: '30-year fixed mortgage', MORTGAGE15US: '15-year fixed mortgage', DFF: 'Fed funds rate' };
let rateCache = null;
export async function rates() {
  if (rateCache && now() - rateCache.at < 3 * 3600e3) return rateCache.v;
  const out = {};
  if (!offline()) {
    const base = (process.env.FRED_URL || 'https://fred.stlouisfed.org').replace(/\/$/, '');
    const start = new Date(now() - 400 * 864e5).toISOString().slice(0, 10);
    const txt = await fetch(`${base}/graph/fredgraph.csv?id=${Object.keys(FRED_SERIES).join(',')}&cosd=${start}`, { headers: { 'User-Agent': 'Mozilla/5.0 Brightolio' }, signal: AbortSignal.timeout(15000) }).then(r => (r.ok ? r.text() : '')).catch(() => '');
    const lines = txt.trim().split('\n'), head = (lines[0] || '').split(',');
    for (let c = 1; c < head.length; c++) {
      const id = head[c].trim(), pts = [];
      for (const l of lines.slice(1)) { const p = l.split(','); if (p[c] && p[c] !== '.' && !isNaN(+p[c])) pts.push([p[0], +p[c]]); }
      if (!pts.length) continue;
      const last = pts.at(-1), yearAgo = pts.find(([d]) => d >= new Date(Date.parse(last[0]) - 365 * 864e5).toISOString().slice(0, 10));
      const monthAgo = [...pts].reverse().find(([d]) => d <= new Date(Date.parse(last[0]) - 28 * 864e5).toISOString().slice(0, 10));
      out[id] = { name: FRED_SERIES[id], rate: last[1], date: last[0], change1m: monthAgo ? r2(last[1] - monthAgo[1]) : null, change1y: yearAgo ? r2(last[1] - yearAgo[1]) : null };
    }
  }
  const v = { series: out, source: 'Federal Reserve Bank of St. Louis (FRED); mortgage rates from Freddie Mac\'s weekly survey', at: now() };
  if (Object.keys(out).length) rateCache = { at: now(), v };
  return v;
}
// Federal Reserve press releases (rate decisions, statements).
let newsCache = null;
export async function rateNews() {
  if (newsCache && now() - newsCache.at < 3600e3) return newsCache.v;
  if (offline()) return [];
  const base = (process.env.FED_URL || 'https://www.federalreserve.gov').replace(/\/$/, '');
  const xml = await fetch(`${base}/feeds/press_monetary.xml`, { headers: { 'User-Agent': 'Mozilla/5.0 Brightolio' }, signal: AbortSignal.timeout(10000) }).then(r => (r.ok ? r.text() : '')).catch(() => '');
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 10).map(m => {
    const tag = t => (m[1].match(new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`)) || [])[1]?.trim() || '';
    return { title: tag('title'), url: tag('link'), date: tag('pubDate'), source: 'Federal Reserve' };
  }).filter(x => x.title);
  if (items.length) newsCache = { at: now(), v: items };
  return items;
}
// Local view: approximate effective property tax rate by state (percent of home value a year).
export const PROPERTY_TAX = { AL: 0.38, AK: 1.0, AZ: 0.51, AR: 0.57, CA: 0.71, CO: 0.49, CT: 1.79, DE: 0.51, DC: 0.56, FL: 0.8, GA: 0.81, HI: 0.27, ID: 0.53, IL: 2.07, IN: 0.77, IA: 1.43, KS: 1.34, KY: 0.77, LA: 0.51, ME: 1.09, MD: 0.99, MA: 1.04, MI: 1.24, MN: 1.02, MS: 0.67, MO: 0.88, MT: 0.68, NE: 1.54, NV: 0.48, NH: 1.77, NJ: 2.23, NM: 0.67, NY: 1.4, NC: 0.7, ND: 0.88, OH: 1.41, OK: 0.81, OR: 0.82, PA: 1.36, RI: 1.32, SC: 0.51, SD: 1.08, TN: 0.56, TX: 1.58, UT: 0.52, VT: 1.71, VA: 0.75, WA: 0.84, WV: 0.53, WI: 1.51, WY: 0.55 };
export const CONFORMING_LIMIT = 832750; // 2026 one-unit baseline (higher in high-cost counties, Alaska and Hawaii)
export function mortgageMonthly(price, downPct, ratePct, years = 30) {
  const loan = price * (1 - downPct / 100), r = ratePct / 1200, n = years * 12;
  return r2(r ? loan * r / (1 - (1 + r) ** -n) : loan / n);
}
export async function localRates(userId, override = {}) {
  const tax = await getSetting(userId, 'taxProfile', null) || {}, state = (override.state || tax.state || 'NY').toUpperCase(), city = override.city || tax.city || '';
  const rt = (await rates()).series, m30 = rt.MORTGAGE30US?.rate, m15 = rt.MORTGAGE15US?.rate;
  const price = +override.price || 450000, down = override.down == null ? 20 : +override.down;
  const ptax = PROPERTY_TAX[state] ?? 1, pi30 = m30 ? mortgageMonthly(price, down, m30, 30) : null, pi15 = m15 ? mortgageMonthly(price, down, m15, 15) : null;
  return { state, city, price, down, rate30: m30 ?? null, rate15: m15 ?? null, propertyTaxPct: ptax, monthly30: pi30, monthly15: pi15, taxMonthly: r2(price * ptax / 100 / 12), total30: pi30 ? r2(pi30 + price * ptax / 100 / 12) : null, conformingLimit: CONFORMING_LIMIT, jumbo: price * (1 - down / 100) > CONFORMING_LIMIT };
}
export const savingsOffers = () => siteGet('savingsOffers', []) || [];

export const instrumentsRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/futures', async (req, res) => {
    const quotes = await Promise.all(Object.keys(FUTURES).map(async k => { const q = await futuresQuote(k).catch(() => null); return { root: k, name: FUTURES[k][0], exchange: FUTURES[k][4], group: FUTURES[k][5], price: q?.price ?? null, ...(q ? contractMath(k, q.price) : { pointValue: FUTURES[k][2], tick: FUTURES[k][3] }) }; }));
    res.json({ contracts: quotes, positions: await futuresPositions(req.user.id), marginRate: MARGIN_RATE });
  });
  r.post('/futures/trade', async (req, res) => res.json(await tradeFutures(req.user.id, String(req.body?.root || '').toUpperCase(), req.body?.contracts)));
  r.get('/funds', async (req, res) => {
    const out = [];
    for (const [sym, [name, er, min, etf, cat]] of Object.entries(MUTUAL_FUNDS)) {
      const q = await DS.quote(sym, req.user.id).catch(() => null);
      out.push({ symbol: sym, name, expenseRatio: er, minimum: min, etf, category: cat, nav: q?.price ?? null, costPer10k: r2(er * 100) });
    }
    res.json({ funds: out });
  });
  r.get('/savings', async (req, res) => {
    const rt = (await rates()).series;
    const linked = (await all("SELECT institution, accounts FROM money_items WHERE user_id = ?", req.user.id)).flatMap(i => JSON.parse(i.accounts || '[]').filter(a => a.type === 'depository').map(a => ({ institution: i.institution, name: a.name, subtype: a.subtype, balance: a.balance })));
    res.json({ tbill3m: rt.DTB3 || null, tbill6m: rt.DTB6 || null, treasury1y: rt.DGS1 || null, fedFunds: rt.DFF || null, offers: savingsOffers(), linked, cashFunds: ['SGOV', 'BIL', 'USFR'] });
  });
  r.get('/rates', async (req, res) => res.json({ ...(await rates()), news: await rateNews(), local: await localRates(req.user.id, req.query) }));
  return r;
})();
export async function saveOffers(list) {
  const clean = (Array.isArray(list) ? list : []).slice(0, 20).map(o => ({ bank: String(o.bank || '').slice(0, 60), apy: +o.apy || 0, note: String(o.note || '').slice(0, 160), url: /^https:\/\//.test(o.url || '') ? String(o.url).slice(0, 300) : '' })).filter(o => o.bank && o.apy > 0);
  await siteSet('savingsOffers', clean);
  return clean;
}
