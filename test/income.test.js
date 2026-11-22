// Dividends & income and passive investing (src/income.js): the 12-month forecast by month, the
// yearly dividend per share, the passive check of an account, the fee example and the routes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyForecast, yearlyDps, passiveCheck, feeDrag, MIXES, NOTE } from '../src/income.js';

test('forecast: each payment of the last 12 months is expected again, in its month', () => {
  const pay = [{ symbol: 'KO', rate: 0.5, ex_date: '2026-03-01', payable_date: '2026-04-01' }, { symbol: 'KO', rate: 0.5, ex_date: '2026-09-01', payable_date: '2026-10-01' }, { symbol: 'XX', rate: 9, ex_date: '2026-05-01' }];
  const f = monthlyForecast([{ symbol: 'KO', qty: 10 }], pay, new Date('2026-11-22T12:00:00Z'));
  assert.equal(f.months.length, 12); assert.equal(f.months[0].month, '2026-11');
  assert.equal(f.months.find(m => m.month === '2027-04').income, 5); assert.equal(f.months.find(m => m.month === '2027-10').income, 5);
  assert.equal(f.total, 10); // XX is not held
  assert.equal(yearlyDps(pay, 'KO'), 1);
  assert.match(NOTE, /cut or stop/); assert.match(NOTE, /not investment advice/);
});

test('passive check: broad funds, other funds, single stocks and cash, with the average fund fee', () => {
  const funds = { VTI: { broad: true, fee: 0.03 }, BND: { broad: true, fee: 0.03 }, QQQM: { broad: false, fee: 0.15 } };
  const c = passiveCheck([{ symbol: 'VTI', value: 6000 }, { symbol: 'QQQM', value: 1000 }, { symbol: 'NVDA', value: 2000 }], 1000, funds);
  assert.equal(c.broadPct, 60); assert.equal(c.fundsPct, 10); assert.equal(c.stocksPct, 20); assert.equal(c.cashPct, 10);
  assert.equal(c.label, 'Mostly passive'); assert.equal(c.fee, +(((6000 * 0.03 + 1000 * 0.15) / 7000)).toFixed(3));
  assert.equal(passiveCheck([], 0, funds).label, null);
  assert.ok(feeDrag(10000, 30, 7, 1) > feeDrag(10000, 30, 7, 0.03) * 10);
  assert.ok(MIXES.every(m => m.parts.reduce((a, [, w]) => a + w, 0) === 100));
});

let s, u;
before(async () => { const { serve } = await import('./client.js'); s = await serve(); u = s.client(); await u.signup('income@example.com'); });
after(() => s?.close());
test('routes answer for an empty practice account', async () => {
  const d = await u('/income?account=paper'); assert.equal(d.status, 200); assert.deepEqual(d.body.rows, []); assert.equal(d.body.account, 'paper');
  const p = await u('/income/passive'); assert.equal(p.status, 200); assert.equal(p.body.mixes.length, 4); assert.ok(p.body.dragExample.high > p.body.dragExample.low);
});
