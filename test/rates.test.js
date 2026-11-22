// Rates vs stocks (src/rates.js): the next Fed meeting, month-end values, the yield curve and the
// correlation of rate changes with sector returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextFomc, monthly, curve, correlation, FOMC_2026, SECTORS } from '../src/rates.js';

test('the next Fed decision comes from the published calendar, and says so after it runs out', () => {
  assert.deepEqual(nextFomc(Date.parse('2026-11-22')), { date: '2026-12-09', days: 17, source: 'Federal Reserve FOMC calendar' });
  assert.equal(nextFomc(Date.parse('2026-12-09')).days, 0);
  assert.equal(nextFomc(Date.parse('2026-12-10')).date, null);
  assert.equal(FOMC_2026.length, 8);
});

test('month ends, the curve (10y − 2y) and its inversion', () => {
  const m = monthly([['2026-01-02', 4], ['2026-01-30', 4.2], ['2026-02-27', 4.4], ['2026-02-28', null]]);
  assert.deepEqual(m, [['2026-01-30', 4.2], ['2026-02-27', 4.4]]);
  assert.deepEqual(curve([['2026-01-30', 4.2], ['2026-02-27', 4.0]], [['2026-01-30', 4.5], ['2026-02-27', 3.9]]), [['2026-01-30', -0.3], ['2026-02-27', 0.1]]);
});

test('correlation: negative when prices fall as yields rise; null with too little history', () => {
  const months = Array.from({ length: 24 }, (_, i) => `2024-${String(1 + (i % 12)).padStart(2, '0')}-28`.replace('2024', String(2024 + Math.floor(i / 12))));
  const rate = months.map((d, i) => [d, 4 + (i % 2 ? 0.2 : -0.2)]), px = months.map((d, i) => [d, 100 * (i % 2 ? 0.98 : 1.02)]);
  assert.ok(correlation(rate, px) < -0.9);
  assert.equal(correlation(rate.slice(0, 6), px.slice(0, 6)), null);
  assert.deepEqual(SECTORS.map(s => s[0]), ['SPY', 'XLK', 'XLU', 'XLF']);
});
