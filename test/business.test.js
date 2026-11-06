// Business tools: double-entry books, invoices and payments, inventory and cost of goods sold, bank
// import and matching, payroll (gross to net, employer taxes, NACHA direct deposit), reports, and the
// customer's invoice page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/business/engine.js';

const { startMock } = await import('./mock-alpaca.js');
const mock = await startMock();
Object.assign(process.env, { ALPACA_TRADING_URL: mock.url, ALPACA_DATA_URL: mock.url, ALPACA_DATA_SANDBOX_URL: mock.url });
const { app } = await import('../server.js');
let server, base, cookie = '';
const call = async (path, body, method) => {
  const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b, type: r.headers.get('content-type') };
};
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  await call('/auth/register', { email: 'biz@example.com', password: 'Str0ngPassword1', agree: true });
});
after(() => { server.close(); mock.close(); });

test('engine: entries must balance; payroll math; NACHA lines are 94 characters', () => {
  const accts = E.CHART;
  assert.throws(() => E.checkEntry({ date: '2026-01-02', lines: [{ account: '1000', debit: 10 }, { account: '4000', credit: 9 }] }, accts), /must be equal/);
  assert.throws(() => E.checkEntry({ date: '2026-01-02', lines: [{ account: '9999', debit: 10 }, { account: '4000', credit: 10 }] }, accts), /Unknown account/);
  const e = E.checkEntry({ date: '2026-01-02', lines: [{ account: '1000', debit: 10 }, { account: '4000', credit: 10 }], tags: ['Shop', 'shop'] }, accts);
  assert.deepEqual(e.tags, ['shop']);
  // $78,000 a year every two weeks: 2026 brackets after the $16,100 standard deduction.
  const p = E.paycheck({ id: 1, name: 'A', payType: 'salary', rate: 78000, frequency: 'biweekly', filing: 'single', stateRate: 5 }, { year: 2026 });
  assert.equal(p.gross, 3000); assert.equal(p.federal, 320.38); assert.equal(p.ss, 186); assert.equal(p.medicare, 43.5); assert.equal(p.state, 150); assert.equal(p.net, 2300.12);
  // Social Security stops at the wage base; hourly with overtime.
  assert.equal(E.paycheck({ payType: 'salary', rate: 400000, frequency: 'monthly' }, { ytd: 184000, year: 2026 }).ss, 31);
  assert.equal(E.paycheck({ payType: 'hourly', rate: 20, frequency: 'weekly' }, { hours: 40, overtime: 5 }).gross, 950);
  const f = E.nacha({ company: { name: 'Acme', odfiRouting: '021000021', companyId: '1123456789' }, payments: [{ name: 'Jane', routing: '011000015', account: '12345', amount: 10 }], effectiveDate: '2026-11-13' });
  assert.ok(f.text.trim().split('\n').every(l => l.length === 94)); assert.equal(f.text.trim().split('\n').length % 10, 0); assert.equal(f.total, 10);
  assert.throws(() => E.nacha({ company: { name: 'A', odfiRouting: '123456789', companyId: '1' }, payments: [], effectiveDate: '2026-11-13' }), /routing/);
  // Bank CSV in two common layouts.
  assert.deepEqual(E.parseBankCsv('Date,Description,Amount\n11/03/2026,"STAPLES #12, NY",-24.50\n2026-11-04,Stripe payout,1000'), [{ date: '2026-11-03', description: 'STAPLES #12, NY', amount: -24.5 }, { date: '2026-11-04', description: 'Stripe payout', amount: 1000 }]);
  assert.equal(E.parseBankCsv('Posted Date,Payee,Debit,Credit\n2026-11-05,Rent,1500,')[0].amount, -1500);
  assert.equal(E.ruleCategory('ADOBE CREATIVE CLOUD', -54.99), '6400'); assert.equal(E.ruleCategory('Stripe payout', 900), '4000');
});

test('business: invoice, payment, stock, bank, payroll, reports always balance', async () => {
  assert.equal((await call('/biz/settings', { name: 'Acme LLC', currency: 'USD', ach: { companyId: '1123456789', odfiRouting: '021000021', bankName: 'JPMORGAN' } }, 'PUT')).status, 200);
  assert.ok((await call('/biz/accounts')).body.find(a => a.code === '1100'), 'standard chart of accounts');

  // A product in stock, then an invoice that sells 2 of them plus a service line, with tax.
  const item = (await call('/biz/items', { name: 'Widget', variant: 'Blue', price: 50, reorderPoint: 3 })).body;
  assert.equal((await call(`/biz/items/${item.id}/receive`, { qty: 4, unitCost: 20 })).body.avgCost, 20);
  assert.equal((await call(`/biz/items/${item.id}/receive`, { qty: 4, unitCost: 30 })).body.avgCost, 25);
  const inv = await call('/biz/invoices', { contact: { name: 'Bob Co', email: 'bob@example.com' }, lines: [{ desc: 'Widget', qty: 2, price: 50, item: String(item.id) }, { desc: 'Setup', qty: 1, price: 100 }], taxPct: 10, recurring: 'monthly' });
  assert.equal(inv.status, 200, JSON.stringify(inv.body)); assert.equal(inv.body.total, 220); assert.equal(inv.body.number, 'INV-0001'); assert.match(inv.body.link, /\/i\/[A-Za-z0-9_-]+$/);
  assert.equal((await call('/biz/items')).body[0].qty, 6, 'two came out of stock');

  // The customer's page: no sign-in, the amount due, a PDF.
  const token = inv.body.link.split('/i/')[1];
  const page = await fetch(base + '/i/' + token); const html = await page.text();
  assert.equal(page.status, 200); assert.match(html, /Invoice INV-0001/); assert.match(html, /220\.00/); assert.doesNotMatch(html, /Pay .* by card/, 'no card button without the business Stripe key');
  assert.equal((await fetch(base + '/i/' + token + '/pdf')).headers.get('content-type'), 'application/pdf');
  assert.equal((await fetch(base + '/i/not-a-real-token-123')).status, 404);

  // Partial, then full payment.
  assert.equal((await call(`/biz/invoices/${inv.body.id}/payment`, { amount: 120 })).body.status, 'partial');
  assert.equal((await call(`/biz/invoices/${inv.body.id}/payment`, {})).body.status, 'paid');

  // Bank lines: the payment is matched to the books; an Adobe charge is categorised and posted.
  const today = new Date().toISOString().slice(0, 10);
  const imp = await call('/biz/bank/import', { csv: `Date,Description,Amount\n${today},Deposit from Bob Co,100\n${today},ADOBE CREATIVE CLOUD,-54.99\n${today},Mystery,-10` });
  assert.equal(imp.body.added, 3); assert.equal(imp.body.matched, 1);
  assert.equal((await call('/biz/bank/import', { csv: `Date,Description,Amount\n${today},ADOBE CREATIVE CLOUD,-54.99` })).body.added, 0, 'no duplicates');
  assert.equal((await call('/biz/bank/post-suggested', {})).body.posted, 1);
  const adobe = (await call('/biz/bank')).body.find(t => /ADOBE/.test(t.description));
  assert.equal(adobe.status, 'posted'); assert.equal(adobe.suggested, '6400');

  // A receipt typed in (no AI here) is matched to the bank line of the same amount.
  const rc = await call('/biz/receipts', { vendor: 'Corner shop', total: 10, date: today });
  assert.equal(rc.status, 200); assert.ok(rc.body.matchedBank);

  // Payroll: preview, then commit with the password; the ACH file and the stub.
  const emp = await call('/biz/employees', { name: 'Jane Doe', payType: 'salary', rate: 78000, frequency: 'biweekly', stateRate: 5, routing: '011000015', account: '123456789' });
  assert.equal(emp.status, 200); assert.equal(emp.body.hasBank, true); assert.equal(emp.body.bank, undefined, 'bank details never sent back');
  const pv = await call('/biz/payruns', { payDate: today });
  assert.equal(pv.body.preview, true); assert.equal(pv.body.totals.net, 2300.12);
  assert.equal((await call('/biz/payruns', { payDate: today, commit: true, password: 'nope' })).status, 401);
  const pr = await call('/biz/payruns', { payDate: today, commit: true, password: 'Str0ngPassword1' });
  assert.equal(pr.status, 200);
  const ach = await call(`/biz/payruns/${pr.body.id}/ach`);
  assert.equal(ach.status, 200); assert.ok(String(ach.body).split('\n').filter(Boolean).every(l => l.length === 94));
  assert.equal((await call(`/biz/payruns/${pr.body.id}/stub/${emp.body.id}.pdf`)).type, 'application/pdf');
  assert.equal((await call(`/biz/w2?year=${today.slice(0, 4)}`)).body.employees[0].wages, 3000);

  // Reports: the books balance, and the numbers add up.
  const rep = (await call('/biz/reports')).body;
  assert.equal(rep.balance.balanced, true, JSON.stringify(rep.balance));
  assert.equal(rep.pnl.income.find(a => a.code === '4000').balance, 200);
  assert.equal(rep.pnl.expenses.find(a => a.code === '5000').balance, 50, 'cost of goods: 2 at $25');
  const trial = rep.trial.reduce((t, a) => [t[0] + a.debit, t[1] + a.credit], [0, 0]);
  assert.ok(Math.abs(trial[0] - trial[1]) < 0.01, 'trial balance');
  const ov = (await call('/biz/overview')).body;
  assert.equal(ov.receivable, 0); assert.equal(typeof ov.cash, 'number');
  assert.equal((await call('/biz/reports.pdf')).type, 'application/pdf');

  // A second invoice voided: its entry is reversed.
  const inv2 = await call('/biz/invoices', { contact: { name: 'Ann' }, lines: [{ desc: 'Consulting', qty: 3, price: 100 }] });
  assert.equal((await call(`/biz/invoices/${inv2.body.id}/void`, {})).body.status, 'void');
  assert.equal((await call('/biz/reports')).body.balance.balanced, true);
});
