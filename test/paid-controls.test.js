import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accountPlanSuffix, requiredPlan, unlockLabel } from '../public/paid-controls.js';

test('only gated brokerage choices show a Pro label', () => {
  assert.equal(accountPlanSuffix('paper', false), '');
  assert.equal(accountPlanSuffix('alpaca', true), '');
  assert.equal(accountPlanSuffix('alpaca', false), ' · Unlock with Pro');
});

test('every stock and growth lock resolves to a known plan, including Elite controls', () => {
  const features = new Set();
  for (const file of ['growth', 'stock', 'analytics', 'wealth', 'pairs', 'build']) {
    const source = readFileSync(new URL('../public/pages/' + file + '.js', import.meta.url), 'utf8');
    for (const match of source.matchAll(/(?:unlockLabel\('([^']+)'\)|(?:lockNote|lock)\([^\n]*?, '([^']+)'\))/g)) {
      features.add(match[1] || match[2]);
    }
  }
  assert.deepEqual([...features].sort(), Object.keys(requiredPlan).sort());
  assert.equal(unlockLabel('AI intraday trading'), 'Unlock with Elite');
  assert.equal(unlockLabel('AI morning picks with real money'), 'Unlock with Elite');
  assert.throws(() => unlockLabel('unknown'));
});
