// Diversification (src/diversify.js): the score and its parts, fund overlap, correlation and the
// suggestions with their previews (never orders).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score, suggestions, overlaps, avgCorrelation, preview } from '../src/diversify.js';

const h = (symbol, value, sector, region = 'United States', type = 'Stocks') => ({ symbol, value, sector, region, type });

test('a concentrated tech account scores low and gets clear suggestions with previews', () => {
  const hold = [h('NVDA', 60000, 'Technology'), h('AAPL', 20000, 'Technology'), h('MSFT', 15000, 'Technology'), h('JPM', 5000, 'Financials')];
  const sc = score(hold, { correlation: 0.75 });
  assert.ok(sc.score < 40, String(sc.score)); assert.equal(sc.label, 'Concentrated');
  assert.equal(sc.single.symbol, 'NVDA'); assert.equal(sc.single.pct, 60);
  assert.equal(sc.parts.length, 6); assert.equal(sc.parts.reduce((s, p) => s + p.of, 0), 100);
  const sg = suggestions(hold, sc);
  assert.ok(sg.length >= 2 && sg.length <= 3);
  assert.match(sg[0].title, /Trim NVDA/); assert.equal(sg[0].sell.dollars, 40000); assert.equal(sg[0].buy.symbol, 'VT');
  assert.ok(sg[0].preview.scoreAfter > sg[0].preview.scoreBefore, JSON.stringify(sg[0].preview));
  assert.ok(sg.every(s => s.why && s.preview && !('order' in s)));
});

test('a broad fund mix scores well; overlapping funds are flagged and can be combined', () => {
  const broad = [h('VTI', 50000, 'Broad US market'), h('VXUS', 30000, 'Broad world market', 'International'), h('BND', 20000, 'Bonds', 'United States', 'Bonds')];
  const good = score(broad, { correlation: 0.3 });
  assert.ok(good.score >= 75, String(good.score)); assert.equal(good.label, 'Well spread');
  const dup = [h('SPY', 50000, 'Broad US market'), h('VOO', 30000, 'Broad US market'), h('VTI', 20000, 'Broad US market')];
  const ov = overlaps(dup.map(x => x.symbol));
  assert.ok(ov.some(o => /both track the S&P 500/.test(o.why))); assert.ok(ov.some(o => o.a === 'VTI'));
  const sg = suggestions(dup, score(dup));
  assert.ok(sg.some(s => /^Combine/.test(s.title)));
});

test('correlation from prices, and an empty account', () => {
  const up = Array.from({ length: 300 }, (_, i) => 100 + i + Math.sin(i) * 3), twin = up.map(x => x * 2), other = up.map((_, i) => 100 + Math.cos(i * 1.7) * 5);
  assert.ok(avgCorrelation({ A: up, B: twin }) > 0.95);
  assert.ok(Math.abs(avgCorrelation({ A: up, C: other })) < 0.5);
  assert.equal(avgCorrelation({ A: up }), null);
  assert.equal(score([]).score, null);
  const p = preview([h('X', 100, 'Technology')], { buy: { symbol: 'BND', dollars: 50 }, sell: null, fromCash: true });
  assert.equal(p.cashNeeded, 50);
});
