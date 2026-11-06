// Batch 19: every Alpaca account counted once (duplicates and master/omnibus accounts), one chart
// for several accounts, and Equalize accounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe, totals, combineHistories } from '../src/consolidate.js';
import { planEqualize } from '../src/equalize.js';

const acct = (id, number, equity, positions, extra = {}) => ({ id, label: id, role: 'sub', live: true, number, equity, cash: equity - positions.reduce((s, p) => s + p.value, 0), lastEquity: equity, positions, ...extra });
const P = (symbol, qty, price) => ({ symbol, qty, value: qty * price, price, pnl: 0 });

test('the same Alpaca account connected twice is counted once', () => {
  const r = dedupe([acct('alpaca', '312345678', 1000, [P('AAPL', 2, 200)], { role: 'main' }), acct('alpaca:2', '312345678', 1000, [P('AAPL', 2, 200)])]);
  assert.equal(r[0].counted, true); assert.equal(r[1].counted, false); assert.equal(r[1].why, 'duplicate'); assert.equal(r[1].sameAs, 'alpaca');
  // A paper and a live account never count as the same account.
  assert.ok(dedupe([acct('a', '1', 10, []), { ...acct('b', '1', 10, []), live: false }]).every(x => x.counted));
});

test('a master (omnibus) account that is the sum of its sub accounts is left out of the totals', () => {
  const s1 = acct('alpaca:2', '2', 1500, [P('AAPL', 5, 200)]), s2 = acct('alpaca:3', '3', 2500, [P('AAPL', 5, 200), P('MSFT', 3, 400)]);
  const master = acct('alpaca', '1', 4000, [P('AAPL', 10, 200), P('MSFT', 3, 400)], { role: 'main' });
  const r = dedupe([master, s1, s2]);
  assert.equal(r[0].why, 'master'); assert.deepEqual(r[0].subs, ['alpaca:2', 'alpaca:3']);
  const t = totals(r.filter(x => x.counted));
  assert.equal(t.equity, 4000, 'not 8000'); assert.equal(t.positions.find(p => p.symbol === 'AAPL').qty, 10);
  // Alpaca's own type wins, even with one sub account.
  const typed = dedupe([acct('alpaca', '1', 900, [P('SPY', 1, 500)], { type: 'omnibus' }), acct('alpaca:2', '2', 900, [P('SPY', 1, 500)], { type: 'omnibus_sub' })]);
  assert.equal(typed[0].why, 'master'); assert.equal(typed[1].counted, true);
  // Independent accounts that only look alike are all counted.
  const indep = dedupe([acct('a', '1', 1000, [P('SPY', 1, 500)]), acct('b', '2', 1000, [P('SPY', 1, 500)]), acct('c', '3', 3000, [P('QQQ', 2, 400)])]);
  assert.ok(indep.every(x => x.counted));
});

test('one chart for several accounts adds them at each time', () => {
  const h = combineHistories([{ baseValue: 100, points: [{ t: 1, equity: 100 }, { t: 2, equity: 110 }, { t: 3, equity: 120 }] }, { baseValue: 50, points: [{ t: 2, equity: 50 }, { t: 3, equity: 55 }] }]);
  assert.deepEqual(h.points.map(p => p.equity), [100, 160, 175]); assert.equal(h.baseValue, 150);
});

test('Equalize gives every account the same mix, sized to its own value; sells come first', () => {
  const a = acct('alpaca:2', '2', 10000, [P('VTI', 40, 250)]);            // all in VTI
  const b = acct('alpaca:3', '3', 10000, [P('BND', 100, 70)]);           // 70% BND, 30% cash
  const p = planEqualize([a, b], { options: { minTrade: 1 } });
  const w = Object.fromEntries(p.weights.map(x => [x.symbol, x.pct]));
  assert.equal(w.VTI, 50); assert.equal(w.BND, 35);                      // 15% cash overall
  for (const acc of p.accounts) for (const r of acc.rows) assert.equal(r.targetPct, w[r.symbol]);
  const ofA = p.orders.filter(o => o.account === 'alpaca:2');
  assert.equal(ofA[0].side, 'sell'); assert.equal(ofA[0].symbol, 'VTI'); assert.equal(ofA[0].dollars, 5000);
  assert.ok(ofA.some(o => o.side === 'buy' && o.symbol === 'BND' && Math.abs(o.dollars - 3500) < 1));
  const ofB = p.orders.filter(o => o.account === 'alpaca:3');
  assert.ok(ofB.some(o => o.side === 'sell' && o.symbol === 'BND' && Math.abs(o.dollars - 3500) < 1));
  assert.ok(ofB.some(o => o.side === 'buy' && o.symbol === 'VTI' && o.dollars <= 5000 && o.dollars > 4990));
  assert.equal(p.needed, true);
  // Already equal: nothing to do.
  assert.equal(planEqualize([acct('x', '1', 1000, [P('SPY', 1, 500)]), acct('y', '2', 2000, [P('SPY', 2, 500)])]).orders.length, 0);
  // A model account sets the mix; "keep 10% cash"; whole shares only.
  const m = planEqualize([a, b], { model: 'alpaca:2', options: { cashPct: 10, wholeShares: true, minTrade: 1 } });
  assert.deepEqual(m.weights, [{ symbol: 'VTI', pct: 90 }]);
  assert.ok(m.orders.every(o => !o.qty || Number.isInteger(o.qty)));
  // Option contracts are never equalized.
  assert.ok(!planEqualize([acct('x', '1', 1000, [P('AAPL250117C00200000', 1, 500)]), acct('y', '2', 1000, [])]).orders.some(o => o.symbol.length > 10));
});
