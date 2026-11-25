// The shared cache (src/shared-cache.js): one provider call at a time per key, the last answer while
// it refreshes, and an error never replaces a good answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shared, sharedStats } from '../src/shared-cache.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

test('many callers at once share one provider call', async () => {
  let calls = 0;
  const fn = async () => { calls++; await wait(30); return calls; };
  const all = await Promise.all(Array.from({ length: 50 }, () => shared('t:one', 1000, 0, fn)));
  assert.equal(calls, 1);
  assert.ok(all.every(v => v === 1));
});

test('an old answer is given at once while one refresh runs; past the stale window callers wait', async () => {
  let n = 0;
  const fn = async () => { await wait(20); return ++n; };
  assert.equal(await shared('t:swr', 30, 200, fn), 1);
  await wait(40);
  const t0 = Date.now();
  assert.equal(await shared('t:swr', 30, 200, fn), 1, 'stale answer, no waiting');
  assert.ok(Date.now() - t0 < 15);
  await wait(30);
  assert.equal(await shared('t:swr', 30, 200, fn), 2, 'the refresh landed');
  await wait(300);
  assert.equal(await shared('t:swr', 30, 200, fn), 3, 'too old: waits for a fresh answer');
});

test('a failed refresh keeps the last good answer, and a first failure is reported', async () => {
  let fail = false;
  const fn = async () => { if (fail) throw new Error('provider down'); return 'good'; };
  assert.equal(await shared('t:err', 10, 500, fn), 'good');
  fail = true; await wait(20);
  assert.equal(await shared('t:err', 10, 500, fn), 'good');
  await wait(10);
  assert.equal(await shared('t:err', 10, 500, fn), 'good');
  await assert.rejects(shared('t:new', 10, 500, fn), /provider down/);
  assert.ok(sharedStats().errors >= 1);
});
