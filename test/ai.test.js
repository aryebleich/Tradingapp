// AI features: forecasting model, agents, and the assistant without an AI key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from './client.js';
const { fit, predict, train } = await import('../src/ml.js');
const { snapshot, rsi, sma } = await import('../src/ta.js');

let srv; before(async () => { delete process.env.ANTHROPIC_API_KEY; srv = await serve(); }); after(() => srv.close());

test('logistic regression learns a simple rule; walk-forward metrics are out of sample', () => {
  const X = [], y = [];
  for (let i = 0; i < 600; i++) { const a = Math.sin(i * 1.7), b = Math.cos(i * 0.3); X.push([a, b]); y.push(a + 0.2 * b > 0 ? 1 : 0); }
  const m = fit(X, y, { l2: 0.001, iters: 600 });
  const acc = X.filter((x, i) => (predict(m, x) > 0.5 ? 1 : 0) === y[i]).length / X.length;
  assert.ok(acc > 0.95, 'accuracy ' + acc);
  // A trending series: the model and the report work end to end.
  const closes = Array.from({ length: 1500 }, (_, i) => 100 * Math.exp(i * 0.0004 + 0.05 * Math.sin(i / 9)));
  const dates = closes.map((_, i) => new Date(Date.UTC(2018, 0, 1) + i * 864e5).toISOString().slice(0, 10));
  const r = train(closes, dates, { horizon: 5, threshold: 0.55 });
  assert.ok(r.metrics.testDays > 300 && r.metrics.testFrom > dates[1000]);
  assert.ok(r.forecast.probUp >= 0 && r.forecast.probUp <= 100);
  assert.equal(r.importance.length, 11);
  assert.ok(Math.abs(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]).at(-1) - 100) < 1e-9);
  assert.equal(sma([1, 2, 3], 2)[2], 2.5);
  assert.ok(snapshot(closes).sma200 > 0);
});

test('forecast and agents API; assistant answers without an AI key', async () => {
  await srv.client().signup('first-is-admin@example.com');
  const c = srv.client(); await c.signup('ai@example.com');
  const f = (await c('/ml/forecast', { symbol: 'SPY', horizon: 5 })).body;
  assert.equal(f.symbol, 'SPY'); assert.ok(f.metrics.accuracy > 0); assert.ok(f.forecast.signal);
  const a = (await c('/ml/agents', { symbol: 'QQQ', horizon: 10, features: ['ret20', 'rsi14', 'dist200'] })).body;
  assert.ok(a.id); assert.deepEqual(a.config.features, ['ret20', 'rsi14', 'dist200']);
  assert.equal((await c(`/ml/agents/${a.id}/deploy`, { account: 'alpaca' })).status, 402); // real accounts need Pro
  assert.equal((await c(`/ml/agents/${a.id}/deploy`, { account: 'paper', size: 20 })).status, 200);
  assert.equal((await c('/ml/agents')).body[0].deployed, 1);

  assert.equal((await c('/ai/status')).body.ai, false);
  const q = (await c('/ai/chat', { messages: [{ role: 'user', content: 'How does AAPL look?' }] })).body;
  assert.match(q.reply, /AAPL.*RSI\(14\)/);
  const s = (await c('/ai/chat', { messages: [{ role: 'user', content: 'Build a strategy: buy SPY when RSI is below 30 in an uptrend, sell above 60, 8% stop loss' }] })).body;
  assert.equal(s.draft.symbol, 'SPY'); assert.match(s.draft.entry, /RSI\(14\) < 30/); assert.equal(s.draft.sl, 8);
});
