// The heavy backtests run in the CPU pool (src/cpu.js), never on the request thread: the basket
// backtest and the landing-page demo give the same answer in a worker thread as inline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpu, cpuStats } from '../src/cpu.js';
import { basketRun } from '../src/baskets-math.js';
import { demoBacktest } from '../src/cpu-tasks.js';
import { warmupFor, PRESETS } from '../src/engine.js';

const days = n => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2018, 0, 1) + i * 864e5).toISOString().slice(0, 10));
const walk = (n, seed, drift) => { let x = 100, s = seed; return Array.from({ length: n }, () => { s = (s * 9301 + 49297) % 233280; x *= 1 + drift + (s / 233280 - 0.5) * 0.02; return +x.toFixed(4); }); };

test('the basket backtest runs in a worker thread and matches the inline answer', async () => {
  const d = days(1800), data = {};
  for (const [i, s] of ['AAA', 'BBB', 'CCC', 'SPY'].entries()) data[s] = { closes: walk(1800, 7 + i, 0.0003 * (i + 1)), dates: d, source: 'test' };
  const spec = { universe: 'AAA,BBB,CCC', filters: '', rankBy: 'momentum6m', topN: 2, weighting: 'equal', rebalance: 'monthly', cashPct: 0, weights: {} };
  const before = cpuStats().ran + cpuStats().inline;
  const pooled = await cpu('baskets-math', 'basketRun', [spec, ['AAA', 'BBB', 'CCC'], data, 3]);
  assert.equal(cpuStats().ran + cpuStats().inline, before + 1);
  assert.deepEqual(pooled, basketRun(spec, ['AAA', 'BBB', 'CCC'], data, 3));
  assert.ok(pooled.stats.rebalances > 10 && pooled.curve.length > 50);
});

test('the landing-page demo backtest runs in the pool and matches the inline answer', async () => {
  const closes = walk(1500, 3, 0.0004), dates = days(1500), cfg = { ...PRESETS['SMA cross'], capital: 10000 }, warm = warmupFor(cfg);
  const pooled = await cpu('cpu-tasks', 'demoBacktest', [closes, cfg, warm, dates]);
  assert.deepEqual(pooled, demoBacktest(closes, cfg, warm, dates));
  assert.ok(pooled.curve.length > 100 && pooled.curve.length <= 260);
});

test('a module that touches the database cannot run in the pool', async () => {
  await assert.rejects(cpu('baskets', 'backtestBasket', []), /cannot run in the CPU pool/);
});
