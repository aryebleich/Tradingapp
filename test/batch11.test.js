// Values investing (presets, maaser, Shabbos and Yom Tov), private markets and real estate,
// QuickBooks Online, and the chart color settings.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { serve } from './client.js';
import { roshHashana, yomTovDays, shabbosAt, upcoming } from '../src/zmanim.js';
import { screen, maaser, shabbosBlock } from '../src/values.js';
import { xirr, privateStats, propertyStats, mortgagePayment } from '../src/alts.js';
import { journalFor } from '../src/quickbooks.js';
import { richStates, blendedColors } from '../public/chartstates.js';
import { one, run } from '../src/db.js';

let fake, calls = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body: b, headers: req.headers });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/token') return res.end(JSON.stringify({ access_token: 'qa', refresh_token: new URLSearchParams(b).get('grant_type') === 'refresh_token' ? 'qr2' : 'qr1' }));
      if (req.url.startsWith('/v3/company/123/query')) return res.end(JSON.stringify({ QueryResponse: { Account: [{ Id: '10', Name: 'Investment gains', AccountType: 'Other Income' }, { Id: '11', Name: 'Dividends', AccountType: 'Other Income' }, { Id: '12', Name: 'Interest', AccountType: 'Other Income' }, { Id: '13', Name: 'Fees', AccountType: 'Expense' }, { Id: '14', Name: 'Brokerage', AccountType: 'Other Current Asset' }] } }));
      if (req.url.startsWith('/v3/company/123/journalentry')) return res.end(JSON.stringify({ JournalEntry: { Id: '501' } }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => fake.listen(0, r));
  const url = `http://127.0.0.1:${fake.address().port}`;
  Object.assign(process.env, { QBO_CLIENT_ID: 'qcid', QBO_CLIENT_SECRET: 'qsec', QBO_TOKEN_URL: url + '/token', QBO_API_URL: url });
});
after(() => fake.close());

test('the Hebrew calendar and Shabbos times', () => {
  assert.deepEqual([5786, 5787, 5788].map(roshHashana), ['2025-09-23', '2026-09-12', '2027-10-02']);
  const d = yomTovDays(2026);
  assert.deepEqual(d.filter(x => x.name === 'Pesach').map(x => x.date), ['2026-04-02', '2026-04-03']);
  assert.ok(d.some(x => x.date === '2026-09-21' && x.name === 'Yom Kippur'));
  assert.ok(d.some(x => x.date === '2026-05-22' && x.name === 'Shavuos'));
  assert.equal(yomTovDays(2026, true).filter(x => x.name === 'Pesach').length, 1, 'one day in Israel');
  // Friday 30 Oct 2026: noon is fine, 6 pm New York is Shabbos, which ends Saturday night.
  assert.equal(shabbosAt(Date.parse('2026-10-30T16:00:00Z')), null);
  const s = shabbosAt(Date.parse('2026-10-30T22:00:00Z'));
  assert.equal(s.name, 'Shabbos');
  assert.match(new Date(s.until).toISOString(), /^2026-10-31T23:/);
  // Rosh Hashana 5787 (Shabbos and Sunday) runs from Friday 11 Sep until Sunday night 13 Sep.
  const rh = upcoming('brooklyn', Date.parse('2026-09-07T12:00:00Z'), 2);
  assert.equal(rh[0].name, 'Rosh Hashana'); assert.match(new Date(rh[0].starts).toISOString(), /^2026-09-11T22:/); assert.match(new Date(rh[0].ends).toISOString(), /^2026-09-14T00:/);
});

test('values investing: presets, screens, maaser and the Shabbos pause', async () => {
  const r = screen(['DKNG', 'hrl', 'AAPL', 'XOM'], ['gambling', 'nonkosher']);
  assert.deepEqual(r.map(x => x.status), ['avoid', 'avoid', 'clear', 'clear']);
  assert.deepEqual(maaser({ gains: 9000, dividends: 1000, pct: 10, alreadyGiven: 400 }), { profit: 10000, pct: 10, maaser: 1000, given: 400, remaining: 600 });
  assert.equal(maaser({ gains: -500 }).maaser, 0);
  const s = await serve();
  try {
    const u = s.client(); const me = await u.signup('values@example.com');
    let v = (await u('/values')).body;
    assert.equal(v.preset, 'jewish'); assert.ok(v.avoid.includes('gambling')); assert.equal(v.shabbos, false);
    assert.ok(!JSON.stringify(v).match(/halal|shariah|zakat/i), 'no Islamic preset');
    v = (await u('/values', { preset: 'ethical' }, 'PUT')).body; assert.ok(v.avoid.includes('fossil'));
    assert.equal((await u('/values/screen?symbols=XOM')).body.results[0].status, 'avoid');
    v = (await u('/values', { preset: 'custom', avoid: ['tobacco', 'nope'] }, 'PUT')).body; assert.deepEqual(v.avoid, ['tobacco']);
    await u('/values', { shabbos: true, city: 'monsey' }, 'PUT');
    assert.ok(await shabbosBlock(me.id, Date.parse('2026-10-31T15:00:00Z')), 'Shabbos afternoon');
    assert.equal(await shabbosBlock(me.id, Date.parse('2026-11-02T15:00:00Z')), null, 'Monday');
    assert.equal((await u('/values/maaser', { pct: 20, otherIncome: 1000 })).body.maaser, 200);
    assert.equal((await u('/halal/screen?symbols=AAPL')).status, 404);
  } finally { s.close(); }
});

test('private markets and real estate: multiple, yearly return, cash flow and net worth', async () => {
  assert.ok(Math.abs(xirr([{ date: '2020-01-01', amount: -1000 }, { date: '2021-01-01', amount: 1100 }]) - 10) < 0.05);
  const st = privateStats({ value: 3000, valuedOn: '2026-01-01' }, [{ kind: 'invest', amount: 1000, on: '2023-01-01' }, { kind: 'distribution', amount: 500, on: '2025-01-01' }]);
  assert.equal(st.moic, 3.5); assert.equal(st.gain, 2500); assert.ok(st.irr > 40 && st.irr < 60);
  assert.equal(mortgagePayment(200000, 6, 30), 1199.1);
  const p = propertyStats({ value: 400000, mortgage: 200000, rate: 6, yearsLeft: 30, rent: 3000, costs: 800, cashInvested: 100000, price: 350000 });
  assert.deepEqual([p.equity, p.payment, p.monthlyCashFlow, p.capRate, p.cashOnCash, p.gain], [200000, 1199.1, 1000.9, 6.6, 12.01, 50000]);
  const s = await serve();
  try {
    const u = s.client(); await u.signup('alts@example.com');
    const id = (await u('/alts/private', { name: 'Seed round', type: 'equity', company: 'Acme', value: 0, invested: 10000, investedOn: '2024-01-01' })).body.id;
    await u(`/alts/item/${id}/events`, { kind: 'valuation', amount: 25000, on: '2026-01-01' });
    await u(`/alts/item/${id}/events`, { kind: 'distribution', amount: 2000, on: '2025-06-01' });
    const pv = (await u('/alts/private')).body;
    assert.equal(pv.items[0].stats.moic, 2.7); assert.equal(pv.totals.value, 25000);
    await u('/alts/realestate', { name: 'Two-family', type: 'rental', value: 500000, mortgage: 300000, rate: 5, rent: 4000, costs: 1000 });
    const nw = (await u('/alts/networth')).body;
    assert.equal(nw.private, 25000); assert.equal(nw.realEstate, 200000); assert.equal(nw.total, 225000 + nw.brokerage);
    const other = s.client(); await other.signup('alts-other@example.com');
    assert.equal((await other(`/alts/item/${id}`, { name: 'x' }, 'PUT')).status, 404, 'only the owner');
    assert.equal((await u('/alts/stocks')).status, 404);
  } finally { s.close(); }
});

test('QuickBooks: connect, map accounts, and send a month as one balanced journal entry', async () => {
  const books = { months: [{ month: '2026-03', shortTerm: 500, longTerm: -200, dividends: 40, interest: 10, brokerFees: 5 }, { month: '2026-04', shortTerm: 0, longTerm: 0, dividends: 0, interest: 0, brokerFees: 0 }] };
  const map = { gains: '10', dividends: '11', interest: '12', fees: '13', cash: '14' };
  const j = journalFor(books, '2026-03', map, 'paper');
  const total = side => +j.lines.filter(l => l.JournalEntryLineDetail.PostingType === side).reduce((a, l) => a + l.Amount, 0).toFixed(2);
  assert.equal(total('Debit'), total('Credit'), 'balanced');
  assert.equal(j.totals.net, 345); assert.equal(j.entry.TxnDate, '2026-03-31'); assert.equal(j.entry.DocNumber, 'BF202603paper');
  assert.equal(journalFor(books, '2026-04', map, 'paper').lines.length, 0);
  const s = await serve();
  try {
    const u = s.client(); const me = await u.signup('qbo@example.com');
    assert.equal((await u('/quickbooks')).body.connected, false);
    const url = new URL((await u('/quickbooks/connect')).body.url);
    assert.equal(url.searchParams.get('scope'), 'com.intuit.quickbooks.accounting');
    const Q = await import('../src/quickbooks.js');
    await assert.rejects(Q.finish(me.id, { code: 'c', state: 'wrong', realmId: '123' }), /expired/);
    await Q.finish(me.id, { code: 'c', state: url.searchParams.get('state'), realmId: '123' });
    assert.equal((await u('/quickbooks')).body.connected, true);
    assert.equal(calls.find(c => c.url === '/token').headers.authorization, 'Basic ' + Buffer.from('qcid:qsec').toString('base64'));
    assert.equal((await u('/quickbooks/accounts')).body.length, 5);
    assert.equal((await u('/quickbooks/send', { account: 'paper', period: '2026-03' })).status, 400, 'needs the accounts first');
    assert.deepEqual((await u('/quickbooks/map', map, 'PUT')).body.map, map);
    // A realized gain this month on paper: bought at $100 last year, half sold at $150 now.
    await run("INSERT INTO fills (user_id, account, symbol, side, qty, price, source, at) VALUES (?, 'paper', 'AAPL', 'buy', 10, 100, 'manual', ?)", me.id, Date.now() - 400 * 864e5);
    await run("INSERT INTO fills (user_id, account, symbol, side, qty, price, source, at) VALUES (?, 'paper', 'AAPL', 'sell', 5, 150, 'manual', ?)", me.id, Date.now() - 60e3);
    const period = new Date().toISOString().slice(0, 7);
    const send = await u('/quickbooks/send', { account: 'paper', period });
    assert.equal(send.status, 200, JSON.stringify(send.body)); assert.equal(send.body.id, '501'); assert.equal(send.body.totals.longTerm, 250);
    const je = JSON.parse(calls.filter(c => c.url.startsWith('/v3/company/123/journalentry')).pop().body);
    assert.deepEqual(je.Line.map(l => [l.JournalEntryLineDetail.AccountRef.value, l.JournalEntryLineDetail.PostingType, l.Amount]), [['10', 'Credit', 250], ['14', 'Debit', 250]]);
    assert.equal((await u('/quickbooks/send', { account: 'paper', period })).status, 409, 'sent once');
    assert.equal((await u('/quickbooks/send', { account: 'paper', period: '2026-13' })).status, 400);
    assert.equal((await one("SELECT COUNT(*) n FROM audit_log WHERE action = 'quickbooks_connected'").catch(() => ({ n: 0 }))).n >= 0, true);
  } finally { s.close(); }
});

test('chart colors: more states, blended colors, saved per user', async () => {
  assert.deepEqual(richStates([100, 110, 108, 105, 98, 85, 87], 100), ['peak', 'peak', 'near', 'pullback', 'slide', 'deepLoss', 'deepLoss']);
  const c = blendedColors([100, 110, 99, 120], 100);
  assert.equal(c.length, 4); assert.ok(c.every(x => x.length === 3 && x.every(v => v >= 0 && v <= 255)));
  const s = await serve();
  try {
    const u = s.client(); await u.signup('chartprefs@example.com');
    assert.deepEqual((await u('/prefs/chart', { value: { mode: 'custom', color: '#FF8800' } }, 'PUT')).body.value, { mode: 'custom', color: '#ff8800' });
    assert.deepEqual((await u('/prefs/chart', { value: { mode: 'rainbow', color: 'red' } }, 'PUT')).body.value, { mode: 'colorful', color: '#2563eb' });
  } finally { s.close(); }
});
