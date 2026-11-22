// A stand-in for SEC EDGAR (tickers, submissions, company facts) with made-up companies in the real
// file shapes, for tests and local checks of the stock page. Point SEC_DATA_URL and SEC_WWW_URL at it.
import http from 'node:http';

const years = [2020, 2021, 2022, 2023, 2024, 2025];
const fy = (y, val) => ({ start: `${y}-01-01`, end: `${y}-12-31`, val, form: '10-K', fy: y, fp: 'FY', filed: `${y + 1}-02-15` });
const pt = (y, val) => ({ end: `${y}-12-31`, val, form: '10-K', fy: y, fp: 'FY', filed: `${y + 1}-02-15` });
// A company from a few growth numbers: revenue in billions growing g a year, net margin m, dividends d.
function company(name, { rev0 = 100, g = 0.12, m = 0.18, eps0 = 1.5, div0 = 0.4, shares = 10e9, debt = 30, equity0 = 80 } = {}) {
  const rev = years.map((_, i) => rev0 * (1 + g) ** i * 1e9), ni = rev.map(r => r * m), eps = years.map((_, i) => +(eps0 * (1 + g) ** i).toFixed(2));
  const u = vals => ({ units: { USD: years.map((y, i) => fy(y, vals[i])) } }), p = vals => ({ units: { USD: years.map((y, i) => pt(y, vals[i])) } });
  return { entityName: name, facts: { 'us-gaap': {
    Revenues: u(rev), GrossProfit: u(rev.map(r => r * 0.42)), OperatingIncomeLoss: u(rev.map(r => r * m * 1.3)), NetIncomeLoss: u(ni), DepreciationDepletionAndAmortization: u(rev.map(r => r * 0.04)),
    NetCashProvidedByUsedInOperatingActivities: u(ni.map(x => x * 1.3)), PaymentsToAcquirePropertyPlantAndEquipment: u(rev.map(r => r * 0.05)), PaymentsOfDividendsCommonStock: u(years.map((_, i) => div0 * (1.1 ** i) * shares)),
    Assets: p(rev.map(r => r * 1.6)), StockholdersEquity: p(years.map((_, i) => equity0 * 1e9 * 1.08 ** i)), LongTermDebtNoncurrent: p(years.map(() => debt * 1e9)), CashAndCashEquivalentsAtCarryingValue: p(years.map(() => 25e9)),
    EarningsPerShareDiluted: { units: { 'USD/shares': [...years.map((y, i) => fy(y, eps[i])), ...[0, 1, 2, 3].map(q => ({ start: `2025-${String(q * 3 + 1).padStart(2, '0')}-01`, end: `2025-${String(q * 3 + 3).padStart(2, '0')}-${q === 0 || q === 3 ? 31 : 30}`, val: +(eps[5] / 4).toFixed(2), form: '10-Q', filed: `2025-${String(q * 3 + 4 > 12 ? 12 : q * 3 + 4).padStart(2, '0')}-20` }))] } },
    CommonStockDividendsPerShareDeclared: { units: { 'USD/shares': years.map((y, i) => fy(y, +(div0 * 1.1 ** i).toFixed(2))) } },
    WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: years.map(y => fy(y, shares)) } },
  } } };
}
export const COMPANIES = {
  AAPL: { cik: 320193, sic: '3571', sicDescription: 'Electronic Computers', ...company('Apple Inc.', { rev0: 270, g: 0.07, m: 0.25, eps0: 3.3, div0: 0.8, shares: 15.5e9, debt: 95, equity0: 65 }) },
  MSFT: { cik: 789019, sic: '7372', sicDescription: 'Services-Prepackaged Software', ...company('Microsoft Corp', { rev0: 140, g: 0.14, m: 0.34, eps0: 5.8, div0: 2.0, shares: 7.45e9, debt: 45, equity0: 120 }) },
  NVDA: { cik: 1045810, sic: '3674', sicDescription: 'Semiconductors', ...company('NVIDIA Corp', { rev0: 11, g: 0.55, m: 0.4, eps0: 0.15, div0: 0.016, shares: 24.5e9, debt: 8, equity0: 17 }) },
  KO: { cik: 21344, sic: '2080', sicDescription: 'Beverages', ...company('Coca-Cola Co', { rev0: 33, g: 0.05, m: 0.22, eps0: 1.8, div0: 1.64, shares: 4.3e9, debt: 38, equity0: 19 }) },
};
const pad = c => String(c).padStart(10, '0');
export function startSecMock() {
  const server = http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/files/company_tickers.json') return send(200, Object.fromEntries(Object.entries(COMPANIES).map(([t, c], i) => [i, { cik_str: c.cik, ticker: t, title: c.entityName }])));
    if (u.pathname === '/files/company_tickers_exchange.json') return send(200, { fields: ['cik', 'name', 'ticker', 'exchange'], data: Object.entries(COMPANIES).map(([t, c]) => [c.cik, c.entityName, t, 'Nasdaq']) });
    let m = /^\/submissions\/CIK(\d{10})\.json$/.exec(u.pathname);
    if (m) { const c = Object.values(COMPANIES).find(x => pad(x.cik) === m[1]); if (!c) return send(404, {}); return send(200, { name: c.entityName, sic: c.sic, sicDescription: c.sicDescription, exchanges: ['Nasdaq'], fiscalYearEnd: '1231',
      filings: { recent: { form: ['8-K', '10-Q', '8-K', '8-K', '8-K'], items: ['2.02', '', '5.02', '2.02,9.01', '2.02'], filingDate: ['2025-05-01', '2025-05-02', '2025-06-10', '2025-07-31', '2025-10-30'] } } }); }
    m = /^\/api\/xbrl\/companyfacts\/CIK(\d{10})\.json$/.exec(u.pathname);
    if (m) { const c = Object.values(COMPANIES).find(x => pad(x.cik) === m[1]); return c ? send(200, { entityName: c.entityName, facts: c.facts }) : send(404, {}); }
    if (u.pathname.startsWith('/api/xbrl/frames/')) return send(404, {});
    send(404, { message: 'not found ' + u.pathname });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
