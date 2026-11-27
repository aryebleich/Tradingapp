// Premarket and after-hours movers (src/extscan.js, SCAN-01): only trades from that session today count,
// premarket against yesterday's close and after hours against today's close, prices under $1 are left out,
// and every answer names its data source (real time IEX, consolidated, or delayed).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const X = await import('../src/extscan.js');
// Wednesday 2026-11-25 (a trading day), New York is UTC-5 in November.
const at = (h, m) => Date.UTC(2026, 10, 25, h + 5, m);
const snap = (p, t, prev, close, v = 1000) => ({ latestTrade: { p, t: new Date(t).toISOString() }, prevDailyBar: { c: prev }, dailyBar: { c: close, v } });

test('extended movers: premarket gaps against yesterday, only trades from 4:00 to 9:30 today', () => {
  const snaps = {
    AAA: snap(110, at(8, 0), 100, 100), BBB: snap(95, at(7, 30), 100, 100), CCC: snap(101, at(10, 0), 100, 100),
    DDD: snap(0.5, at(8, 0), 0.4, 0.4), EEE: snap(120, at(3, 59), 100, 100), FFF: snap(150, at(8, 0) - 864e5, 100, 100),
  };
  const rows = X.extendedMovers(snaps, 'pre', at(9, 0));
  assert.deepEqual(rows.map(r => r.symbol), ['AAA', 'BBB'], 'regular session, under $1, before 4:00 and yesterday are left out');
  assert.equal(rows[0].gapPct, 10); assert.equal(rows[1].gapPct, -5);
});

test('extended movers: after hours against today\'s close, from 4:00 to 8:00 PM', () => {
  const snaps = { AAA: snap(105, at(17, 0), 90, 100), BBB: snap(80, at(19, 59), 90, 100), CCC: snap(100, at(20, 1), 90, 100) };
  const rows = X.extendedMovers(snaps, 'after', at(20, 30));
  assert.deepEqual(rows.map(r => [r.symbol, r.gapPct]), [['BBB', -20], ['AAA', 5]]);
});

test('extended movers: the data source is always named, and the scan says when it is not that session', async () => {
  assert.match(X.feedLabel('iex').label, /IEX only.*partial/);
  assert.match(X.feedLabel('sip').label, /consolidated/);
  assert.equal(X.feedLabel('delayed_sip').delayed, true);
  const data = { dataEnabled: () => true, mostActives: async () => ({ most_actives: [{ symbol: 'AAA' }] }), snapshots: async () => ({ AAA: snap(110, at(8, 0), 100, 100) }) };
  const pre = await X.extendedScan('pre', { now: at(8, 30), data });
  assert.equal(pre.live, true); assert.match(pre.data.label, /IEX|consolidated|delayed/); assert.equal(pre.rows[0].symbol, 'AAA');
  const { sharedClear } = await import('../src/shared-cache.js'); sharedClear();
  const off = await X.extendedScan('after', { now: at(12, 0), data });
  assert.equal(off.live, false); assert.match(off.note, /Not after hours right now/);
  sharedClear();
  assert.equal((await X.extendedScan('pre', { data: { dataEnabled: () => false } })).available, false);
  sharedClear();
});
