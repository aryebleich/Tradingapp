// Futures research (src/instruments.js): contract months, equity-index expiries (third Friday) and
// roll dates, and the list of brokerages that offer futures (Alpaca does not).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollCalendar, FUTURES_BROKERS, CYCLES, FUTURES } from '../src/instruments.js';

test('index contracts: third-Friday expiry, roll 8 days before; past expiries are skipped', () => {
  const r = rollCalendar('ES', new Date('2026-11-22T12:00:00Z'));
  assert.deepEqual(r.map(x => x.code), ['ESZ26', 'ESH27', 'ESM27']);
  assert.equal(r[0].expires, '2026-12-18'); assert.equal(new Date(r[0].expires).getUTCDay(), 5); assert.equal(r[0].roll, '2026-12-10');
  assert.equal(rollCalendar('ES', new Date('2026-12-19T12:00:00Z'), 1)[0].code, 'ESH27');
  const gc = rollCalendar('GC', new Date('2026-11-22T12:00:00Z'), 2);
  assert.deepEqual(gc.map(x => x.code), ['GCZ26', 'GCG27']); assert.equal(gc[0].expires, null); // left to the exchange calendar
  assert.ok(Object.keys(FUTURES).every(k => CYCLES[k]), 'every contract has its months');
  assert.ok(FUTURES_BROKERS.length >= 4 && !FUTURES_BROKERS.some(([n]) => /Alpaca/.test(n)));
});
