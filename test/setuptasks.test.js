// The ranked setup list (Part A6): blockers come first, open tasks before done ones, progress counts
// are right, every task has a page to go to, and no value is ever part of the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankTasks, nextTasks, TIERS } from '../src/setup-tasks.js';

const item = (env, on) => ({ name: 'x ' + env, env, on });

test('blockers come before revenue, revenue before quick wins, quick wins before nice-to-haves', () => {
  const r = rankTasks([
    item('ANTHROPIC_API_KEY', false),          // nice
    item('GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET', false), // quick
    item('STRIPE_SECRET_KEY', false),          // revenue
    item('ENCRYPTION_KEY', false),             // blocker
  ]);
  const tiers = r.tasks.map(t => t.tier);
  assert.deepEqual(tiers, ['blocker', 'revenue', 'quick', 'nice']);
  assert.deepEqual(r.tasks.map(t => t.rank), [1, 2, 3, 4]);
});

test('an open blocker is "needs attention"; an open non-blocker is "not started"; a set one is done', () => {
  const r = rankTasks([item('ENCRYPTION_KEY', false), item('STRIPE_SECRET_KEY', false), item('ADMIN_EMAIL', true)]);
  const by = Object.fromEntries(r.tasks.map(t => [t.env, t.status]));
  assert.equal(by.ENCRYPTION_KEY, 'attention');
  assert.equal(by.STRIPE_SECRET_KEY, 'todo');
  assert.equal(by.ADMIN_EMAIL, 'done');
});

test('done tasks sort after open ones, and the progress counts match', () => {
  const r = rankTasks([item('ADMIN_EMAIL', true), item('ENCRYPTION_KEY', false), item('RESEND_API_KEY', true), item('STRIPE_SECRET_KEY', false)]);
  assert.equal(r.total, 4);
  assert.equal(r.done, 2);
  assert.equal(r.percent, 50);
  const statuses = r.tasks.map(t => t.status);
  assert.deepEqual(statuses.slice(0, 2).every(s => s !== 'done'), true, 'open first');
  assert.deepEqual(statuses.slice(2), ['done', 'done']);
});

test('every task has a page to go to, a why and a time estimate', () => {
  const r = rankTasks([item('ENCRYPTION_KEY', false), item('PERSISTENT_DISK or DATABASE_URL', false), item('RESEND_API_KEY', false)]);
  for (const t of r.tasks) {
    assert.match(t.go, /^#\/admin-/, t.env);
    assert.ok(t.why.length > 10, t.env);
    assert.ok(t.min > 0, t.env);
    assert.ok(TIERS.includes(t.tier));
  }
});

test('the next-tasks answer for the AI chat lists the first open tasks only', () => {
  const r = rankTasks([item('ADMIN_EMAIL', true), item('ENCRYPTION_KEY', false), item('STRIPE_SECRET_KEY', false), item('ANTHROPIC_API_KEY', false)]);
  const next = nextTasks(r, 2);
  assert.equal(next.length, 2);
  assert.equal(next[0].env, 'ENCRYPTION_KEY');
  assert.ok(next.every(t => t.status !== 'done'));
});

test('the list never carries a value, only names, flags and links', () => {
  process.env.SECRET_TEST_VALUE_XYZ = 'sk_live_should_never_appear';
  const r = rankTasks([item('ENCRYPTION_KEY', true)]);
  assert.ok(!JSON.stringify(r).includes('sk_live_should_never_appear'));
  delete process.env.SECRET_TEST_VALUE_XYZ;
});
