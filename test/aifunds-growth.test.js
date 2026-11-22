// AI long/short portfolios, the growth additions (src/aifunds.js): the cap on each position, the
// largest fall from a high, the hypothetical backtest and its honest labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capWeights, maxDrawdown, backtest, buildBook, MAX_WEIGHT, FEES, RISKS } from '../src/aifunds.js';

test('no position above the cap; the rest of the book is untouched', () => {
  const b = capWeights([{ symbol: 'A', weight: 0.6, why: 'strong' }, { symbol: 'B', weight: 0.1 }, { symbol: 'C', weight: -0.4 }], 0.25);
  assert.deepEqual(b.map(x => x.weight), [0.25, 0.1, -0.25]); assert.match(b[0].why, /capped at 25%/);
  assert.equal(MAX_WEIGHT, 0.25);
  const mk = f => Array.from({ length: 300 }, (_, i) => f(i));
  const one = buildBook('neutral', 5, { A: mk(i => 50 + i), E: mk(i => 100 + Math.sin(i / 9)) }, { canShort: true, names: 1 });
  assert.ok(capWeights(one).every(x => Math.abs(x.weight) <= MAX_WEIGHT));
});

test('largest fall from a high', () => {
  assert.equal(maxDrawdown([100, 120, 90, 130, 117]), -25);
  assert.equal(maxDrawdown([100, 101, 102]), 0);
  assert.equal(maxDrawdown([]), null);
});

test('backtest: weekly turns over past prices, labelled hypothetical, with the drawdown and SPY to compare', () => {
  const mk = f => Array.from({ length: 400 }, (_, i) => f(i));
  const series = { SPY: mk(i => 400 + i * 0.3 + Math.sin(i / 7) * 4), A: mk(i => 50 + i * 0.2), B: mk(i => 60 + i * 0.15 + Math.sin(i / 5)), C: mk(i => 300 - i * 0.4), D: mk(i => 250 - i * 0.3), E: mk(i => 100 + Math.sin(i / 9) * 3) };
  const b = backtest('neutral', 3, series);
  assert.ok(b.weeks >= 20, String(b.weeks)); assert.equal(b.nav[0], 100); assert.equal(b.nav.length, b.weeks + 1);
  assert.ok(b.maxDrawdown <= 0); assert.ok(b.worstWeek <= 0 || b.worstWeek >= -100); assert.equal(typeof b.spy, 'number');
  assert.match(b.note, /Hypothetical/); assert.match(b.note, /not a prediction/);
  assert.equal(backtest('neutral', 3, { A: mk(i => i + 1).slice(0, 200) }), null); // too little history
  assert.match(FEES, /No management or performance fee/); assert.ok(RISKS.some(r => /Shorts can lose more/.test(r)));
});
