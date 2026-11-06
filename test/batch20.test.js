// Batch 20: the indicator library (100+), Brightolio Script (run, backtest, errors), saved scripts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { INDICATORS, compute, sma, rsi } from '../public/indicators.js';
import { run, backtest, firing, EXAMPLE } from '../public/script.js';

const bars = (() => { let c = 100; return Array.from({ length: 400 }, (_, i) => { const o = c; c = Math.max(1, c * (1 + Math.sin(i / 11) * 0.012 + ((i * 7919) % 13 - 6) * 0.0008)); return { t: Date.UTC(2025, 0, 1) + i * 864e5, o, h: Math.max(o, c) * 1.006, l: Math.min(o, c) * 0.994, c, v: 1e6 + (i % 9) * 1e5 }; }); })();

const { app } = await import('../server.js');
let server, base, cookie = '';
const call = async (path, body, method) => {
  const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
};
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  await call('/auth/register', { email: 'script@example.com', password: 'Str0ngPassword1', agree: true });
});
after(() => server.close());

test('more than 100 indicators, every one gives finite values as long as the bars', () => {
  assert.ok(INDICATORS.length >= 100, `${INDICATORS.length} indicators`);
  assert.equal(new Set(INDICATORS.map(x => x.id)).size, INDICATORS.length, 'ids are unique');
  for (const d of INDICATORS) {
    const r = compute(d.id, bars);
    for (const l of r.lines) { assert.equal(l.values.length, bars.length, d.id); assert.ok(Number.isFinite(l.values.at(-1)), `${d.id} ${l.name}`); }
  }
  // Two known values: the SMA is the plain average, RSI of a rising series is 100.
  assert.equal(sma([1, 2, 3, 4], 2).at(-1), 3.5);
  assert.equal(rsi([1, 2, 3, 4, 5, 6, 7, 8], 3).at(-1), 100);
  // Settings are merged over the defaults; unknown ones are ignored.
  assert.equal(compute('sma', bars, { length: 5, nope: 1 }).params.length, 5);
});

test('Brightolio Script: plots, several results, history, alerts, backtest and clear errors', () => {
  const r = run('[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(m, "MACD")\nup = close > close[1] ? 1 : 0\nplot(up)\nk = ind("keltner", "Upper", length=20)\nplot(k)\nhline(0)\nalertcondition(close > 0, "Always")', bars);
  assert.deepEqual(r.plots.map(p => p.title), ['MACD', 'Plot 2', 'Plot 3']);
  assert.ok(r.plots.every(p => p.values.length === bars.length));
  assert.deepEqual(firing(r), ['Always']);
  const ex = run(EXAMPLE, bars);
  assert.equal(ex.strategy, true); assert.equal(ex.inputs[0].title, 'RSI length');
  const bt = backtest(run('strategy("x")\nf = ta.ema(close, 10)\ns = ta.ema(close, 30)\nstrategy.entry("L", strategy.long, when=ta.crossover(f, s))\nstrategy.close("L", when=ta.crossunder(f, s))', bars), bars);
  assert.ok(bt.trades.length > 0); assert.equal(bt.equity.length, bars.length); assert.ok(bt.maxDrawdown <= 0);
  // Inputs can be changed without editing the script.
  assert.equal(run('x = input(14, "Length")', bars, { inputs: { Length: 21 } }).inputs[0].value, 21);
  for (const [src, msg] of [['x = foo(1)', /Unknown function foo/], ['plot(close +)', /Unexpected/], ['y = zzz', /"zzz" is not defined/], ['[a, b] = ta.sma(close, 5)', /one result/]]) assert.throws(() => run(src, bars), msg);
});

test('saved scripts: checked before saving, listed, deleted', async () => {
  assert.equal((await call('/scripts', { name: 'Broken', symbol: 'SPY', source: 'plot(nope)' })).status, 400);
  const ok = await call('/scripts', { name: 'Trend', symbol: 'SPY', source: EXAMPLE, alert: true });
  assert.equal(ok.status, 200);
  const list = (await call('/scripts')).body;
  assert.equal(list[0].name, 'Trend'); assert.equal(list[0].alert, true);
  assert.equal((await call('/scripts/' + ok.body.id, null, 'DELETE')).status, 200);
  assert.equal((await call('/scripts')).body.length, 0);
});
