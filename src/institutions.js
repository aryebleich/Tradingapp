// Institutional portfolio tracking from SEC 13F filings (free, public data on EDGAR): the latest
// holdings of well-known managers, what changed since the previous quarter, and a one-tap mirror
// that turns the top holdings into a rule-based portfolio. 13F data is reported up to 45 days
// after each quarter ends, so it shows what a manager held then, not today.
import { dbCached } from './memo.js';
import express from 'express';
import { one, run, now } from './db.js';
import { requireUser, rateLimit } from './auth.js';

export const MANAGERS = [
  { cik: '0001067983', name: 'Berkshire Hathaway', person: 'Warren Buffett' },
  { cik: '0001336528', name: 'Pershing Square Capital', person: 'Bill Ackman' },
  { cik: '0001649339', name: 'Scion Asset Management', person: 'Michael Burry' },
  { cik: '0001536411', name: 'Duquesne Family Office', person: 'Stanley Druckenmiller' },
  { cik: '0001656456', name: 'Appaloosa Management', person: 'David Tepper' },
  { cik: '0001697748', name: 'ARK Investment Management', person: 'Cathie Wood' },
  { cik: '0001350694', name: 'Bridgewater Associates', person: 'Ray Dalio (founder)' },
  { cik: '0001029160', name: 'Soros Fund Management', person: 'George Soros' },
  { cik: '0001167483', name: 'Tiger Global Management', person: 'Chase Coleman' },
  { cik: '0001037389', name: 'Renaissance Technologies', person: 'Jim Simons (founder)' },
];
const DATA = () => (process.env.SEC_DATA_URL || 'https://data.sec.gov').replace(/\/$/, '');
const WWW = () => (process.env.SEC_WWW_URL || 'https://www.sec.gov').replace(/\/$/, '');
// The SEC asks automated clients to identify themselves with a contact address.
const UA = () => ({ 'User-Agent': `Brightolio ${process.env.SEC_CONTACT || process.env.ADMIN_EMAIL || 'support@quantpocket.app'}`, Accept: 'application/json, text/xml, */*' });
export async function get(url, type = 'json') {
  const r = await fetch(url, { headers: UA(), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw Object.assign(new Error(`SEC EDGAR answered ${r.status}`), { status: r.status === 404 ? 404 : 502 });
  return type === 'json' ? r.json() : r.text();
}
// The cache table with an in-memory front (src/memo.js): repeat reads never reach the database.
const cached = dbCached;

export { DATA as secData, WWW as secWww, cached as secCached };
// SEC company facts, trimmed before they are kept: the full document is 5-10 MB per company (every
// figure the company ever reported), and keeping a few dozen whole ones in the cache table and in
// memory filled the heap (941 MB) and the database (526 MB). Only the figures the app reads are kept
// (stock.js statements and series, wealth.js fundamentals), from 10-K and 10-Q reports of the last
// 12 years, with only the fields those read: a few KB per company.
export const FACT_CONCEPTS = new Set(['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax',
  'GrossProfit', 'OperatingIncomeLoss', 'NetIncomeLoss', 'ProfitLoss', 'DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet',
  'NetCashProvidedByUsedInOperatingActivities', 'PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsOfDividendsCommonStock', 'PaymentsOfDividends',
  'Assets', 'Liabilities', 'StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'AssetsCurrent', 'LiabilitiesCurrent',
  'CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'LongTermDebtNoncurrent', 'LongTermDebt', 'LongTermDebtAndCapitalLeaseObligations',
  'EarningsPerShareDiluted', 'EarningsPerShareBasic', 'CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid',
  'WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingBasic']);
const FACT_FIELDS = ['start', 'end', 'val', 'form', 'filed', 'fy', 'fp', 'frame'];
export function trimFacts(doc, now = Date.now()) {
  const since = new Date(now - 12 * 365.25 * 864e5).toISOString().slice(0, 10), out = {};
  for (const [name, c] of Object.entries(doc?.facts?.['us-gaap'] || {})) {
    if (!FACT_CONCEPTS.has(name)) continue;
    const units = {};
    for (const [u, rows] of Object.entries(c.units || {})) {
      const keep = rows.filter(r => /^10-[KQ]/.test(r.form || '') && (r.end ? String(r.end) >= since : +r.fy >= +since.slice(0, 4))).map(r => Object.fromEntries(FACT_FIELDS.filter(k => r[k] != null).map(k => [k, r[k]])));
      if (keep.length) units[u] = keep;
    }
    if (Object.keys(units).length) out[name] = { units };
  }
  return { cik: doc?.cik ?? null, entityName: doc?.entityName ?? null, facts: { 'us-gaap': out } };
}
// SEC submissions (2-5 MB each: every filing ever made), trimmed the same way: the company details the
// app reads, and of the filings only the earnings reports (8-K item 2.02) with form, items and date.
export function trimSubmissions(doc) {
  const r = doc?.filings?.recent || {}, keep = { form: [], items: [], filingDate: [] };
  for (let i = 0; i < (r.form || []).length; i++) if (r.form[i] === '8-K' && String(r.items?.[i] || '').split(',').includes('2.02')) { keep.form.push('8-K'); keep.items.push(r.items[i]); keep.filingDate.push(r.filingDate?.[i]); }
  const b = doc?.addresses?.business || {};
  return { cik: doc?.cik ?? null, name: doc?.name ?? null, sic: doc?.sic ?? null, sicDescription: doc?.sicDescription ?? null, exchanges: doc?.exchanges || [], fiscalYearEnd: doc?.fiscalYearEnd ?? null,
    stateOfIncorporation: doc?.stateOfIncorporation ?? null, addresses: { business: { stateOrCountry: b.stateOrCountry ?? null, isForeignLocation: b.isForeignLocation ?? null } }, filings: { recent: keep } };
}
export const companySubmissions = (cik, ttl = 864e5) => cached('sec:subs3:' + cik, ttl, async () => trimSubmissions(await get(`${DATA()}/submissions/CIK${cik}.json`)));
export const companyFacts = (cik, ttl = 2 * 864e5) => cached('sec:facts2:' + cik, ttl, async () => trimFacts(await get(`${DATA()}/api/xbrl/companyfacts/CIK${cik}.json`)));
const norm = s => ' ' + String(s || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|HLDGS|HOLDINGS|HOLDING|GROUP|CL|CLASS|COM|NEW|DEL|SA|NV|AG|SE|ADR|SPONSORED|SHS|ORD|A|B|C)\b/g, ' ').replace(/\s+/g, ' ').trim();
// Company names to tickers, from the SEC's own ticker file.
async function tickerMap() {
  return cached('sec:tickers', 7 * 864e5, async () => {
    const d = await get(`${WWW()}/files/company_tickers.json`), m = {};
    for (const r of Object.values(d)) { const k = norm(r.title); if (k && !m[k]) m[k] = r.ticker; }
    return m;
  });
}

const tag = (block, name) => { const m = block.match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i')); return m ? m[1].trim() : null; };
export function parseInfoTable(xml, dollars) {
  const rows = [];
  for (const m of String(xml).matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi)) {
    const b = m[1], amt = tag(b, 'shrsOrPrnAmt') || b;
    rows.push({ issuer: tag(b, 'nameOfIssuer'), cls: tag(b, 'titleOfClass'), cusip: tag(b, 'cusip'), value: +(tag(b, 'value') || 0) * (dollars ? 1 : 1000), shares: +(tag(amt, 'sshPrnamt') || 0), putCall: tag(b, 'putCall') });
  }
  const by = new Map();
  for (const r of rows) {
    const k = r.cusip + (r.putCall || '');
    const x = by.get(k) || by.set(k, { ...r, value: 0, shares: 0 }).get(k);
    x.value += r.value; x.shares += r.shares;
  }
  return [...by.values()].sort((a, b) => b.value - a.value);
}

async function filing(cik, acc, filed) {
  const dir = `${WWW()}/Archives/edgar/data/${+cik}/${acc.replace(/-/g, '')}`;
  const idx = await get(`${dir}/index.json`);
  const xml = (idx.directory?.item || []).map(i => i.name).find(n => /\.xml$/i.test(n) && !/primary_doc/i.test(n));
  if (!xml) throw Object.assign(new Error('No holdings table in this filing'), { status: 502 });
  // Since January 2023 13F values are in dollars; before, in thousands.
  return parseInfoTable(await get(`${dir}/${xml}`, 'text'), filed >= '2023-01-03');
}

export async function holdings(cikIn) {
  const cik = String(cikIn).replace(/\D/g, '').padStart(10, '0');
  if (!/^\d{10}$/.test(cik) || +cik === 0) throw Object.assign(new Error('Enter a CIK number'), { status: 400 });
  return cached('13f:' + cik, 12 * 3600e3, async () => {
    const sub = await get(`${DATA()}/submissions/CIK${cik}.json`), f = sub.filings?.recent || {};
    const list = (f.form || []).map((form, i) => ({ form, acc: f.accessionNumber[i], filed: f.filingDate[i], period: f.reportDate[i] })).filter(x => x.form === '13F-HR');
    if (!list.length) throw Object.assign(new Error('No 13F filings for this manager'), { status: 404 });
    const [cur, prev] = await Promise.all([filing(cik, list[0].acc, list[0].filed), list[1] ? filing(cik, list[1].acc, list[1].filed).catch(() => null) : null]);
    const tickers = await tickerMap().catch(() => ({}));
    const total = cur.filter(r => !r.putCall).reduce((a, r) => a + r.value, 0) || 1;
    const before = new Map((prev || []).map(r => [r.cusip + (r.putCall || ''), r]));
    const rows = cur.map(r => {
      const p = before.get(r.cusip + (r.putCall || '')), change = !prev ? null : !p ? 'new' : r.shares > p.shares * 1.005 ? 'added' : r.shares < p.shares * 0.995 ? 'reduced' : 'same';
      return { ...r, ticker: tickers[norm(r.issuer)] || null, weight: r.putCall ? null : +(r.value / total * 100).toFixed(2), change, sharesChangePct: p && p.shares ? +((r.shares / p.shares - 1) * 100).toFixed(1) : null };
    });
    const now_ = new Set(cur.map(r => r.cusip + (r.putCall || '')));
    const soldOut = (prev || []).filter(r => !now_.has(r.cusip + (r.putCall || ''))).map(r => ({ issuer: r.issuer, cusip: r.cusip, ticker: tickers[norm(r.issuer)] || null, previousValue: r.value, putCall: r.putCall }));
    return { cik, name: sub.name, period: list[0].period, filed: list[0].filed, previousPeriod: list[1]?.period || null, totalValue: total, positions: rows.length, holdings: rows.slice(0, 200), soldOut: soldOut.slice(0, 50) };
  });
}

export const institutionsRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', (req, res) => res.json(MANAGERS));
  r.get('/:cik', async (req, res) => {
    if (!rateLimit('13f:' + req.user.id, 60, 3600e3)) throw Object.assign(new Error('Too many lookups this hour'), { status: 429 });
    res.json(await holdings(req.params.cik));
  });
  return r;
})();
