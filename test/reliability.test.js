// Reliability, execution transparency, account protection and the newer risk rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from './client.js';
const R = await import('../src/reliability.js');
const { drain } = await import('../src/orderqueue.js');
const { placeOrder } = await import('../src/brokers.js');
const { run } = await import('../src/db.js');
const { verifyChain, scoreVenues, improvementBps } = await import('../src/execution.js');
const { anomaly, updateProfile } = await import('../src/security.js');
const { forecast, stress } = await import('../src/margin.js');
const { riskStats, diversification } = await import('../src/longterm.js');
const { volTier } = await import('../src/risk.js');

let srv; before(async () => { srv = await serve(); }); after(() => { R.forceLoad(null); srv.close(); });

test('load shedding keeps trading up; capacity planner and metrics', async () => {
  await srv.client().signup('owner-first@example.com');
  const c = srv.client(); await c.signup('shed@example.com');
  process.env.SHED_AT = '0.85'; R.forceLoad(0.9);
  try {
    const shed = await c('/insights?account=paper');
    assert.equal(shed.status, 503); assert.equal(shed.body.shed, true);
    assert.equal((await c('/orders', { account: 'paper', symbol: 'SPY', side: 'buy', notional: 100 })).status, 200); // orders are never shed
    assert.equal((await c('/risk')).status, 200);
  } finally { R.forceLoad(null); process.env.SHED_AT = '1.01'; }
  assert.equal((await c('/insights?account=paper')).status, 200);
  const m = await (await fetch(srv.base + '/metrics')).text();
  assert.match(m, /qp_load_ratio \d/); assert.match(m, /qp_recommended_replicas \d+/); assert.match(m, /qp_shed_total [1-9]/);
  // Market open on a Wednesday in New York is a scale-up moment; a macro event day as well.
  const open = Date.parse('2026-10-21T13:35:00Z'); // 9:35 New York
  assert.ok(R.recommendedReplicas(open, { base: 2 }).replicas >= 6);
  assert.deepEqual(R.recommendedReplicas(Date.parse('2026-10-24T18:00:00Z'), { base: 2 }).reasons, ['normal']); // Saturday
  assert.equal((await fetch(srv.base + '/readyz')).status, 200);
});

test('circuit breaker queues automated orders during an outage, then the queue sends them', async () => {
  const c = srv.client(); const u = await c.signup('queue@example.com');
  const br = new R.Breaker('t', { failures: 2, coolDownMs: 50 });
  const boom = () => Promise.reject(Object.assign(new Error('down'), { status: 503 }));
  await assert.rejects(br.run(boom)); await assert.rejects(br.run(boom));
  assert.equal(br.info().state, 'open');
  await assert.rejects(br.run(async () => 1), /not responding/);
  await new Promise(r => setTimeout(r, 60));
  assert.equal(await br.run(async () => 7), 7); assert.equal(br.info().state, 'closed');
  // A rejected order (bad request) does not trip the breaker.
  await assert.rejects(br.run(() => Promise.reject(Object.assign(new Error('no cash'), { status: 400 }))));
  assert.equal(br.info().recentFailures, 0);

  process.env.CHAOS_FAIL_RATE = '1';
  try {
    const q = await placeOrder(u.id, 'paper', { symbol: 'SPY', side: 'buy', notional: 200 }, 'bot');
    assert.equal(q.status, 'queued');
    await assert.rejects(placeOrder(u.id, 'paper', { symbol: 'SPY', side: 'buy', notional: 200 }, 'web')); // manual orders are never queued
  } finally { delete process.env.CHAOS_FAIL_RATE; }
  R.breaker('paper').success();
  assert.equal(await drain(placeOrder), 1);
  const mine = (await c('/queue')).body;
  assert.equal(mine[0].status, 'sent');
  // A stale queued order expires instead of going out late.
  await run("INSERT INTO order_queue (user_id, account, payload, source, status, expires_at, created_at, updated_at) VALUES (?, 'paper', '{\"symbol\":\"SPY\",\"side\":\"buy\",\"notional\":5}', 'bot', 'pending', 1, 1, 1)", u.id);
  await drain(placeOrder);
  assert.equal((await c('/queue')).body[0].status, 'expired');
});

test('execution log: quote at send, fills, hash chain that cannot be edited; routing settings', async () => {
  const c = srv.client(); await c.signup('exec@example.com');
  assert.equal((await c('/orders', { account: 'paper', symbol: 'AAPL', side: 'buy', notional: 300 })).status, 200);
  const d = (await c('/exec')).body;
  const sent = d.log.find(x => x.data.event === 'sent'), filled = d.log.find(x => x.data.event === 'filled');
  assert.ok(sent.data.quote.capturedAt); assert.equal(filled.data.venue, 'paper'); assert.equal(filled.data.orderRef, sent.data.orderRef);
  assert.equal(filled.prev_hash, sent.hash);
  assert.deepEqual((await c('/exec/verify')).body.ok, true);
  await assert.rejects(run('UPDATE exec_audit SET data = ? WHERE id = ?', '{}', sent.id), /append-only/);
  await assert.rejects(run('DELETE FROM exec_audit WHERE id = ?', sent.id), /append-only/);
  const p = (await c('/exec/routing', { directOnly: true, weights: { price: 2, fillRate: 1, speed: 1 } }, 'PUT')).body;
  assert.equal(p.directOnly, true); assert.equal(p.weights.price, 0.5);
  assert.match((await c('/orders', { account: 'smart', symbol: 'AAPL', side: 'buy', notional: 50 })).body.error, /Pro plan/); // smart routing uses real brokerages
  assert.equal(improvementBps('buy', { ask: 100 }, 99.9), 10);
  const sc = scoreVenues(['alpaca', 'tradier'], [{ venue: 'alpaca', sent: 10, fillRate: 100, avgImprovementBps: 2, medianFillMs: 300 }]);
  assert.equal(sc[0].venue, 'alpaca');
});

test('account lock freezes orders; speed bumps, quotas and graduated limits', async () => {
  const c = srv.client(); const u = await c.signup('lock@example.com');
  assert.equal((await c('/security/lock', { reason: 'test' })).body.locked, true);
  const blocked = await c('/orders', { account: 'paper', symbol: 'SPY', side: 'sell', qty: 1 });
  assert.equal(blocked.status, 409); assert.equal(blocked.body.locked, true);
  assert.equal((await c('/security/unlock', { password: 'wrong' })).status, 401);
  assert.equal((await c('/security/unlock', { password: 'Str0ngPassword' })).body.locked, false);
  await c('/risk/kill', { on: false });
  // Capital deployment quota per day.
  await c('/risk', { maxBuyUsdDay: 1000 }, 'PUT');
  assert.equal((await c('/orders', { account: 'paper', symbol: 'SPY', side: 'buy', notional: 700 })).status, 200);
  assert.match((await c('/orders', { account: 'paper', symbol: 'QQQ', side: 'buy', notional: 400 })).body.error, /quota \(\$300\.00 left\)/);
  // Lessons are checked on the server.
  const L = (await c('/learn')).body;
  assert.ok(L.lessons.find(l => l.id === 'options').quiz.every(q => !('correct' in q)));
  assert.equal((await c('/learn/margin', { answers: [2, 0] })).status, 200);
  assert.equal(volTier(30).name, 'normal'); assert.equal(volTier(200).maxPct, 10);
  assert.ok(u.id);
});

test('behavior profile, support agent escalation, passkey options', async () => {
  let p = null; for (let i = 0; i < 8; i++) p = updateProfile(p, { flightMean: 150 + i, flightSd: 40, dwellMean: 90, dwellSd: 20 });
  assert.ok(anomaly(p, { flightMean: 152, flightSd: 41, dwellMean: 91, dwellSd: 21 }) < 1);
  assert.ok(anomaly(p, { flightMean: 600, flightSd: 300, dwellMean: 300, dwellSd: 150 }) > 3);
  const c = srv.client(); await c.signup('help@example.com');
  const a = (await c('/security/support', { messages: [{ role: 'user', content: 'How do I add a passkey?' }] })).body;
  assert.match(a.reply, /passkey/i);
  const e = (await c('/security/support', { messages: [{ role: 'user', content: 'My account was hacked, I did not make these trades' }] })).body;
  assert.deepEqual(e.actions, ['security_escalation']);
  assert.equal((await c('/security')).body.lock.on, true);
  const o = (await c('/security/passkeys/options', {})).body;
  assert.ok(o.challenge); assert.equal(o.rp.name, 'QuantPocket');
  assert.equal((await c('/auth/passkey/options', {})).status, 200);
});

test('margin forecast and stress, long-term stats and diversification', async () => {
  const f = forecast([{ equity: 10000, maintenance: 4000 }, { equity: 9500, maintenance: 4000 }, { equity: 9000, maintenance: 4000 }], { equity: 8500, maintenance: 4000 });
  assert.equal(f.trendPerDay, -500); assert.equal(f.daysToCall, 9);
  const s = stress({ equity: 10000, maintenance: 5000, gross: 20000, positions: [{ symbol: 'X', value: 20000 }] });
  assert.equal(s.dropToCallPct, 33.3); assert.equal(s.shocks.find(x => x.shock === -30).call, false);
  const r = riskStats(Array.from({ length: 300 }, (_, i) => 100 * 1.0005 ** i));
  assert.ok(r.cagr > 10 && r.maxDrawdown === 0);
  const d = diversification([{ symbol: 'A', value: 900 }, { symbol: 'B', value: 100 }], {});
  assert.match(d.verdict, /Concentrated/);
  const c = srv.client(); await c.signup('long@example.com');
  await c('/orders', { account: 'paper', symbol: 'SPY', side: 'buy', notional: 1000 });
  const lt = (await c('/longterm?account=paper')).body;
  assert.ok(lt.sp500); assert.equal(lt.diversification.positions, 1);
  const st = (await c('/longterm/stress?account=paper')).body;
  assert.equal(st.scenarios.length, 5); assert.ok(st.scenarios[0].estimatedLoss < 0);
});
