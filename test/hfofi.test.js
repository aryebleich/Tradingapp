// Order flow (OFI) lab (src/hfofi.js): each factor against hand-computed values, VOI and OFI when the
// bid or ask rises, falls or stays; the rolling sum and percentiles; no look-ahead (thresholds from
// in-sample data only); the backtest's positions, returns and costs; the upload checks; and the
// whole pipeline against R's own output on the sample data, to 6 decimal places.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as O from '../src/hfofi.js';

const close = (a, b, d = 1e-6, msg = '') => { if (a == null || b == null) return assert.equal(a, b, msg); assert.ok(Math.abs(a - b) <= d * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`); };
const q = (bid, ask, bidVol, askVol) => ({ bid, ask, bidVol, askVol });

test('spread, mid, microprice and imbalance by hand', () => {
  const x = q(100, 101, 30, 10);
  assert.equal(O.spread(x), 1); assert.equal(O.mid(x), 100.5);
  close(O.microprice(x), (100 * 10 + 101 * 30) / 40); // 100.75: leans toward the ask when the bid is heavier
  assert.equal(O.imbalance(x), 0.5);
});

test('VOI and OFI when the bid and ask rise, fall or stay the same', () => {
  const p = q(100, 101, 20, 30);
  // Bid up, ask up.
  assert.equal(O.voi(p, q(101, 102, 5, 7)), 5 - 0); // ΔVbid = new bid vol; ask rose → ΔVask = 0
  assert.equal(O.ofi(p, q(101, 102, 5, 7)), 5 - 0 - 0 + 30);
  // Unchanged prices: the change in volume.
  assert.equal(O.voi(p, q(100, 101, 25, 26)), (25 - 20) - (26 - 30));
  assert.equal(O.ofi(p, q(100, 101, 25, 26)), 25 - 20 - 26 + 30);
  // Bid down, ask down.
  assert.equal(O.voi(p, q(99, 100, 40, 9)), 0 - 9);
  assert.equal(O.ofi(p, q(99, 100, 40, 9)), 0 - 20 - 9 + 0);
  // The first update has no previous quote.
  assert.equal(O.voi(null, p), null); assert.equal(O.ofi(null, p), null);
});

test('OFI-N is a right-aligned rolling sum; R-style percentiles', () => {
  assert.deepEqual(O.rollSum([null, 1, 2, 3, 4], 2), [null, null, 3, 5, 7]);
  assert.deepEqual(O.rollSum([1, 2, 3], 3), [null, null, 6]);
  close(O.quantile7([1, 2, 3, 4], 0.8), 3.4); // R: quantile(1:4, .8) = 3.4
  assert.equal(O.quantile7([5, null, 1, 3], 0.5), 3);
  const f = O.factors([q(1, 2, 1, 1), q(1, 2, 2, 1), q(2, 3, 1, 1), q(2, 3, 1, 3)], 2);
  assert.deepEqual(f.ofi, [null, 1, 1 + 1, 1 - 1 - 3 + 1]); assert.deepEqual(f.ofi_n.slice(0, 3), [null, null, 3]);
});

test('backtest: positions, returns and costs on a tiny series', () => {
  const mids = [100, 101, 102, 101, 100], sig = [0, 10, 5, -10, 0];
  const bt = O.backtest(mids, sig, 8, -8, { fee: 0.001, tick: 1, slip: 1 });
  assert.deepEqual(bt.pos, [0, 1, 1, 0, 0]); // in above 8, hold between, out below -8
  close(bt.gross[1], 102 / 101 - 1); close(bt.gross[2], 101 / 102 - 1); assert.equal(bt.gross[0], 0); assert.equal(bt.gross[4], 0);
  close(bt.cost[1], 0.001 + 1 / 101); close(bt.cost[3], 0.001 + 1 / 101); assert.equal(bt.cost[2], 0);
  const tr = O.tradesOf(bt.pos, bt.gross); assert.equal(tr.length, 1); close(tr[0], 101 / 101 - 1);
  close(O.maxDrawdown([0.1, -0.5, 0.2]), 0.55 - 1.1 < 0 ? 0.55 / 1.1 - 1 : 0);
});

test('no look-ahead: the thresholds come from the in-sample part only', () => {
  // Out-of-sample OFI is huge; thresholds must not move with it.
  const mk = (k, v) => Array.from({ length: k }, (_, i) => q(100, 101, 10 + (i % 5) * v, 10));
  const a = O.analyze([...mk(200, 1), ...mk(200, 50)], { inSample: 0.5 }), b = O.analyze([...mk(200, 1), ...mk(200, 1)], { inSample: 0.5 });
  assert.equal(a.thresholds.hi, b.thresholds.hi); assert.equal(a.thresholds.lo, b.thresholds.lo);
  assert.equal(a.thresholds.split, 200);
});

test('upload: wrong columns and files that are too big are refused', () => {
  assert.throws(() => O.parseTicks('time,price\n1,2\n3,4\n'), /missing columns: last, bid, ask, bid_vol, ask_vol, volume, turnover/);
  assert.throws(() => O.parseTicks('x', { bytes: 21 * 1024 * 1024 }), /too big: at most 20 MB/);
  assert.throws(() => O.parseTicks('datetime,last,bid,ask,bid_vol,ask_vol,volume,turnover\n'), /no rows/);
  assert.throws(() => O.parseTicks('datetime,last,bid,ask,bid_vol,ask_vol,volume,turnover\n1,2,3,x,5,6,7,8\n1,2,3,4,5,6,7,8\n'), /not a number/);
  const ctp = O.parseTicks('UpdateTime,LastPrice,BidPrice1,AskPrice1,BidVolume1,AskVolume1,Volume,Turnover\n2023-03-01T09:00:00.000+0800,1,1,2,3,4,5,6\n2023-03-01T09:00:00.500+0800,1,1,2,3,4,5,6\n');
  assert.equal(ctp.length, 2); assert.equal(ctp[1].t - ctp[0].t, 500); assert.equal(ctp[0].askVol, 4);
});

test('the JavaScript matches R on the sample data (6 decimal places)', () => {
  const R = JSON.parse(fs.readFileSync(new URL('./fixtures/hfofi-expected.json', import.meta.url), 'utf8'));
  const ticks = O.parseTicks(fs.readFileSync(new URL('../research/hf-ofi/data/sample.csv', import.meta.url), 'utf8'));
  assert.equal(ticks.length, R.n);
  const a = O.analyze(ticks, { n: R.window }), f = a.f;
  for (const [k, vals] of Object.entries(R.head)) vals.forEach((v, i) => close(f[k][i], v, 1e-6, `${k}[${i}]`));
  for (const [k, s] of Object.entries(R.sums)) close(f[k].reduce((x, y) => x + (y ?? 0), 0), s, 1e-6, `sum ${k}`);
  for (const r of R.regressions) {
    const j = a.regressions.find(x => x.factor === r.factor && x.horizon === r.horizon);
    assert.equal(j.n, r.n, `${r.factor} h${r.horizon} n`); close(j.beta, r.beta, 1e-6, `${r.factor} h${r.horizon} beta`); close(j.t, r.t, 1e-6, `${r.factor} t`); close(j.r2, r.r2, 1e-6, `${r.factor} r2`);
  }
  close(a.thresholds.hi, R.thresholds.hi); close(a.thresholds.lo, R.thresholds.lo); assert.equal(a.thresholds.split, R.thresholds.split);
  assert.equal(a.inSample.bt.pos.reduce((x, y) => x + y, 0), R.pos_in_sum); assert.equal(a.outOfSample.bt.pos.reduce((x, y) => x + y, 0), R.pos_out_sum);
  for (const [seg, rows] of [['inSample', R.in_sample], ['outOfSample', R.out_of_sample]]) for (const r of rows) {
    const s = a[seg].stats[r.basis];
    for (const k of ['trades', 'hit_rate', 'avg_trade', 'total', 'max_dd', 'sharpe']) close(s[k], r[k], 1e-6, `${seg} ${r.basis} ${k}`);
  }
  assert.match(O.NOTE, /Academic exercise\. Simulated results; not investment advice/);
});

test('server: the sample, the R project zip (no data), the PDF, Alpaca quotes as ticks', async () => {
  const L = await import('../src/hfofilab.js');
  const names = L.projectFiles().map(f => f.name);
  assert.ok(names.includes('hf-ofi/hf.Rmd') && names.includes('hf-ofi/run.sh') && names.includes('hf-ofi/data/README.md'));
  assert.ok(!names.some(n => /\.(Rds|csv|pdf)$/.test(n)), names.join(' '));
  const z = L.zip([{ name: 'a.txt', data: Buffer.from('hello') }]); assert.equal(z.readUInt32LE(0), 0x04034b50);
  const t = L.quotesToTicks([{ t: '2026-11-24T15:00:00Z', bp: 10, ap: 10.02, bs: 3, as: 5 }, { t: '2026-11-24T15:00:01Z', bp: 0, ap: 10, bs: 1, as: 1 }]);
  assert.equal(t.length, 1); assert.equal(t[0].askVol, 5); close(t[0].last, 10.01);
  const { serve } = await import('./client.js'); const s = await serve(); const u = s.client(); await u.signup('ofi@example.com');
  assert.equal((await u('/hfofi/quotes?symbol=SPY&day=2026-11-26')).status, 400); // Thanksgiving: closed
  assert.match((await u('/hfofi/quotes?symbol=SPY&day=2026-11-24')).body.error, /not set up|Alpaca/);
  s.close();
});
