// Equalize positions with holdings left out: excluded holdings get no orders, the money is split
// only among the included ones, fewer than two included is refused, and only held symbols are accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPositions, cleanExclude, MAX_EXCLUDE } from '../src/equalize.js';

const row = { id: 'alpaca', label: 'Main', equity: 12000, cash: 1000, positions: [
  { symbol: 'AAPL', qty: 20, value: 6000, price: 300 }, { symbol: 'MSFT', qty: 5, value: 2000, price: 400 },
  { symbol: 'SPY', qty: 4, value: 2000, price: 500 }, { symbol: 'NVDA', qty: 10, value: 1000, price: 100 },
  { symbol: 'AAPL261218C00300000', qty: 1, value: 500, price: 5 }, { symbol: 'TSLA', qty: -2, value: -500, price: 250 }] };

test('excluded holdings get no orders and keep their value', () => {
  const p = planPositions(row, { minTrade: 5, exclude: ['AAPL'] });
  assert.ok(!p.orders.some(o => o.symbol === 'AAPL'), 'no order for an excluded holding');
  assert.deepEqual(p.excluded, ['AAPL']);
  assert.equal(p.holdings.find(h => h.symbol === 'AAPL').included, false);
  assert.equal(p.holdings.filter(h => h.included).length, 3);
  // Options and shorts are never part of the list and stay "left as they are".
  assert.deepEqual(p.skipped.sort(), ['AAPL261218C00300000', 'TSLA']);
  assert.ok(!p.holdings.some(h => h.symbol === 'TSLA' || h.symbol === 'AAPL261218C00300000'));
});

test('the money is split only among the included holdings', () => {
  // MSFT + SPY + NVDA are worth $5,000 together: $1,666.67 each; AAPL's $6,000 is not used.
  const p = planPositions(row, { minTrade: 5, exclude: ['aapl'] });
  assert.equal(p.each, 1666.67);
  const by = Object.fromEntries(p.orders.map(o => [o.symbol, o]));
  assert.equal(by.MSFT.side, 'sell'); assert.equal(by.SPY.side, 'sell'); assert.equal(by.NVDA.side, 'buy');
  assert.ok(Math.abs(by.NVDA.dollars - 666.67) < 0.02);
  // Keep 10% cash: the included get 12,000 × (1 − 0.10 − 6,000/12,000) / 3 = $1,600 each.
  const c = planPositions(row, { cashPct: 10, minTrade: 5, exclude: ['AAPL'] });
  assert.equal(c.each, 1600);
  assert.ok(!c.orders.some(o => o.symbol === 'AAPL'));
  // Totals to buy and sell are reported for the dialog's footer.
  assert.equal(p.totals.buy, +p.orders.filter(o => o.side === 'buy').reduce((s, o) => s + o.dollars, 0).toFixed(2));
});

test('fewer than two included holdings is an error', () => {
  assert.throws(() => planPositions(row, { exclude: ['AAPL', 'MSFT', 'SPY'] }), /at least two holdings/);
  assert.throws(() => planPositions(row, { exclude: ['AAPL', 'MSFT', 'SPY', 'NVDA'] }), /at least two holdings/);
  assert.doesNotThrow(() => planPositions(row, { exclude: ['AAPL', 'MSFT'] }));
});

test('unknown symbols, too many symbols and non-lists are rejected', () => {
  assert.throws(() => planPositions(row, { exclude: ['GOOG'] }), /Not held in this account: GOOG/);
  assert.throws(() => cleanExclude(row, 'AAPL'), /must be a list/);
  assert.throws(() => cleanExclude(row, Array.from({ length: MAX_EXCLUDE + 1 }, () => 'AAPL')), /At most 500/);
  assert.deepEqual(cleanExclude(row, [' aapl ', 'AAPL', '']), ['AAPL']);
  // Excluding an option or a short is accepted (it is held) and changes nothing.
  assert.deepEqual(planPositions(row, { minTrade: 5, exclude: ['TSLA'] }).orders, planPositions(row, { minTrade: 5 }).orders);
});
