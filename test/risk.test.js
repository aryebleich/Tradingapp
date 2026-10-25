// Risk guardrails: limits on every order source, daily order cap, kill switch, guardian.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from './client.js';
const { run } = await import('../src/db.js');
const { runGuardian } = await import('../src/risk.js');
const { accountSummary, placeOrder } = await import('../src/brokers.js');

let srv; before(async () => { srv = await serve(); }); after(() => srv.close());

test('limits, lists, daily cap, kill switch and guardian', async () => {
  const c = srv.client(); const u = await c.signup('risk@example.com');
  const order = body => c('/orders', { account: 'paper', side: 'buy', ...body });
  assert.equal((await order({ symbol: 'SPY', notional: 5000 })).status, 200); // 5% of $100k

  const s = (await c('/risk', { maxOrderUsd: 1000, maxPositionPct: 5.5, denySymbols: 'tsla, gme', maxOrdersPerDay: 5 }, 'PUT')).body.settings;
  assert.deepEqual(s.denySymbols, ['TSLA', 'GME']);
  assert.match((await order({ symbol: 'AAPL', notional: 1500 })).body.error, /over your \$1000 limit/);
  assert.match((await order({ symbol: 'TSLA', notional: 100 })).body.error, /blocked list/);
  assert.match((await order({ symbol: 'SPY', notional: 900 })).body.error, /of the account \(limit 5.5%\)/);
  // Automations hit the same rules.
  await assert.rejects(placeOrder(u.id, 'paper', { symbol: 'GME', side: 'buy', notional: 50 }, 'bot'), /blocked list/);
  assert.equal((await order({ symbol: 'AAPL', notional: 500 })).status, 200);

  // Kill switch: buys and automated sells blocked, a manual sell still works.
  assert.equal((await c('/risk/kill', { on: true })).body.kill, true);
  assert.match((await order({ symbol: 'AAPL', notional: 10 })).body.error, /Kill switch/);
  await assert.rejects(placeOrder(u.id, 'paper', { symbol: 'AAPL', side: 'sell', qty: 0.01 }, 'bot'), /Kill switch/);
  assert.equal((await c('/orders', { account: 'paper', symbol: 'AAPL', side: 'sell', qty: 0.01 })).status, 200);
  await c('/risk/kill', { on: false });

  // Daily order cap counts every buy of the day (2 so far).
  for (let i = 0; i < 3; i++) assert.equal((await order({ symbol: 'AAPL', notional: 10 })).status, 200);
  assert.match((await order({ symbol: 'AAPL', notional: 10 })).body.error, /Daily order limit/);

  // Guardian: SPY bought at a price far above today's sells at the stop-loss, once.
  await c('/risk', { guardStopPct: 10, guardAccounts: ['paper'] }, 'PUT');
  await run("UPDATE positions SET avg_price = avg_price * 2 WHERE user_id = ? AND symbol = 'SPY'", u.id);
  const t = Date.parse('2026-10-23T15:00:00Z'); // a Friday, 11:00 in New York
  const sold = await runGuardian({ summarize: accountSummary, place: placeOrder, t });
  assert.equal(sold.length, 1); assert.match(sold[0].result, /sold .* SPY \(stop-loss -5\d/);
  assert.equal((await runGuardian({ summarize: accountSummary, place: placeOrder, t })).length, 0);
  const r = (await c('/risk')).body;
  assert.equal(r.guardRecent.length, 1); assert.equal(r.guardRecent[0].symbol, 'SPY'); assert.ok(r.ordersToday >= 5);
});
