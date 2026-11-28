// Insider trades from SEC Form 4 (src/insiders.js, FEAT-02), against a local stand-in for EDGAR: the XML
// is read right (buys, sales, roles, the 10b5-1 flag), each filing is kept once, the cluster filter needs
// 2 insiders within 14 days, and every row has its lag and link.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const form4 = ({ symbol = 'ACME', name = 'Jane Roe', title = 'Chief Executive Officer', code = 'P', shares = 1000, price = 50, date = '2026-11-20', plan = false, doc = '4' } = {}) => `<?xml version="1.0"?>
<ownershipDocument><documentType>${doc}</documentType><periodOfReport>${date}</periodOfReport>
<issuer><issuerCik>0000000123</issuerCik><issuerName>Acme Corp</issuerName><issuerTradingSymbol>${symbol}</issuerTradingSymbol></issuer>
<reportingOwner><reportingOwnerId><rptOwnerName>${name}</rptOwnerName></reportingOwnerId>
<reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer><officerTitle>${title}</officerTitle></reportingOwnerRelationship></reportingOwner>
${plan ? '<aff10b5One>1</aff10b5One>' : ''}
<nonDerivativeTable><nonDerivativeTransaction><transactionDate><value>${date}</value></transactionDate>
<transactionCoding><transactionCode>${code}</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>${shares}</value></transactionShares><transactionPricePerShare><value>${price}</value></transactionPricePerShare>
<transactionAcquiredDisposedCode><value>${code === 'P' ? 'A' : 'D'}</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`;

const filings = {
  '0000000001-26-000001': form4({ name: 'Jane Roe', date: '2026-11-20' }),
  '0000000002-26-000002': form4({ name: 'John Doe', title: 'Chief Financial Officer', date: '2026-11-24', shares: 500, price: 52 }),
  '0000000003-26-000003': form4({ symbol: 'SOLO', name: 'Ann Lee', date: '2026-11-21' }),
  '0000000004-26-000004': form4({ name: 'Max Sell', code: 'S', plan: true, date: '2026-11-22' }),
};
const entry = (acc, filed, role) => `<entry><title>4 - Acme (${role})</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/123/${acc.replace(/-/g, '')}/${acc}-index.htm"/><category label="form type" term="4"/><updated>${filed}T10:00:00-05:00</updated></entry>`;
let srv, edgar, base;
before(async () => {
  edgar = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (body, type = 'application/json') => { res.setHeader('Content-Type', type); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    if (u.pathname === '/cgi-bin/browse-edgar') return send(`<feed>${Object.keys(filings).map((acc, i) => entry(acc, `2026-11-2${5 + (i % 2)}`, 'Issuer') + entry(acc, `2026-11-2${5 + (i % 2)}`, 'Reporting')).join('')}</feed>`, 'application/atom+xml');
    const m = /^\/Archives\/edgar\/data\/\d+\/(\d{18})\/(.+)$/.exec(u.pathname);
    if (m) {
      const acc = `${m[1].slice(0, 10)}-${m[1].slice(10, 12)}-${m[1].slice(12)}`;
      if (m[2] === 'index.json') return send({ directory: { item: [{ name: 'xslF345X05/doc.xml' }, { name: 'doc.xml' }] } });
      if (filings[acc]) return send(filings[acc], 'text/xml');
    }
    if (u.pathname === '/files/company_tickers.json') return send({ 0: { cik_str: 123, ticker: 'ACME', title: 'Acme Corp' } });
    if (u.pathname === '/submissions/CIK0000000123.json') return send({ name: 'Acme Corp', filings: { recent: { form: ['4', '10-Q', '4'], accessionNumber: ['0000000001-26-000001', 'x', '0000000004-26-000004'], filingDate: ['2026-11-24', '2026-11-01', '2026-11-25'], primaryDocument: ['xslF345X05/doc.xml', 'q.htm', 'xslF345X05/doc.xml'] } } });
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(r => edgar.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${edgar.address().port}`;
  process.env.SEC_WWW_URL = base; process.env.SEC_DATA_URL = base;
  const { serve } = await import('./client.js'); srv = await serve();
});
after(() => { srv?.close(); edgar?.close(); });
const I = await import('../src/insiders.js');

test('Form 4: buys and sales, the role, the 10b5-1 flag and the value', () => {
  const p = I.parseForm4(form4({ plan: true, code: 'S', shares: 200, price: 10.5 }));
  assert.equal(p.symbol, 'ACME'); assert.equal(p.insider, 'Jane Roe'); assert.equal(p.role, 'Chief Executive Officer'); assert.equal(p.plan10b51, true);
  assert.deepEqual(p.transactions, [{ date: '2026-11-20', code: 'S', shares: 200, price: 10.5, value: 2100, acquired: false }]);
  assert.equal(I.lagDays('2026-11-20', '2026-11-24'), 4);
});

test('the market list: each filing once, buys by default, the cluster filter, lag and links', async () => {
  const added = await I.ingest();
  assert.equal(added, 4, 'four filings, each listed twice in the feed, kept once');
  assert.equal(await I.ingest(), 0, 'a second run adds nothing');
  const t = Date.UTC(2026, 10, 27);
  const buys = await I.marketList({}, t);
  assert.deepEqual(buys.rows.map(r => r.symbol).sort(), ['ACME', 'ACME', 'SOLO']);
  assert.ok(buys.rows.every(r => r.code === 'P' && r.lag != null && /-index\.htm$/.test(r.url)));
  assert.match(buys.note, /not investment advice/);
  const cluster = await I.marketList({ cluster: true }, t);
  assert.deepEqual([...new Set(cluster.rows.map(r => r.symbol))], ['ACME'], 'two insiders within 14 days');
  const sales = await I.marketList({ code: 'S' }, t);
  assert.equal(sales.rows.length, 1); assert.equal(sales.rows[0].plan10b51, true);
  assert.equal((await I.marketList({ role: 'Chief Financial' }, t)).rows.length, 1);
  assert.equal((await I.marketList({ minValue: 40000 }, t)).rows.length, 2, 'the $26,000 buy is below the floor');
});

test('one stock: its latest Form 4 filings from EDGAR, through the API', async () => {
  const c = srv.client(); await c.signup('insiders@example.com');
  const d = (await c('/insiders/ACME')).body;
  assert.equal(d.issuer, 'Acme Corp');
  assert.deepEqual(d.rows.map(r => [r.insider, r.code, r.lag]), [['Jane Roe', 'P', 4], ['Max Sell', 'S', 3]]);
  assert.ok(d.rows[1].plan10b51);
  assert.equal((await c('/insiders/NOPE')).body.rows.length, 0);
  assert.equal((await c('/insiders/bad symbol!')).status, 400);
  assert.equal((await c('/insiders?cluster=1')).status, 200);
});
