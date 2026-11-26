// Stripe audit fixes (STRIPE_AUDIT.md). Stripe is a local fake; no real key or network is used.
//   client    pinned API version, idempotency keys, retries, customer-safe errors, live keys refused
//   webhook   signature on the raw body, duplicates, out-of-order events, the events the old handler
//             skipped, test-mode data kept out of revenue reports
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const reqs = [], failQueue = [];
const stripe = http.createServer((req, res) => {
  let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
    const u = new URL(req.url, 'http://x'), q = Object.fromEntries(new URLSearchParams(req.method === 'GET' ? u.search : b));
    reqs.push({ method: req.method, path: u.pathname, headers: req.headers, q });
    const send = (o, s = 200) => { res.statusCode = s; res.setHeader('Content-Type', 'application/json'); res.setHeader('Request-Id', 'req_test_123'); res.end(JSON.stringify(o)); };
    const f = failQueue.shift();
    if (f) return send(f.body, f.status);
    if (u.pathname === '/v1/checkout/sessions') return send({ id: 'cs_test_1', url: 'https://checkout.stripe.example/pay' });
    if (u.pathname === '/v1/refunds') return send({ id: 're_1' });
    if (u.pathname === '/v1/billing_portal/sessions') return send({ url: 'https://billing.stripe.example/p' });
    if (u.pathname.startsWith('/v1/payment_intents/')) return send({ id: u.pathname.split('/')[3], latest_charge: { payment_method_details: { card: { funding: 'debit' } } } });
    if (u.pathname.startsWith('/v1/charges/')) return send({ id: u.pathname.split('/')[3], invoice: 'in_disputed_1' });
    send({ error: { message: 'unknown ' + u.pathname } }, 404);
  });
});
await new Promise(r => stripe.listen(0, '127.0.0.1', r));
const SECRET = 'whsec_test_hardening';
Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_API_URL: `http://127.0.0.1:${stripe.address().port}`, STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_PRO: 'price_pro_m', PUBLIC_URL: 'https://pay.example' });
delete process.env.STRIPE_API_VERSION; delete process.env.STRIPE_TEST_ONLY;

const { app } = await import('../server.js');
const { one, all, run } = await import('../src/db.js');
const C = await import('../src/stripe-client.js');
const N = await import('../src/notify.js');
const SE = await import('../src/stripe-events.js');
const { revenueSummary } = await import('../src/fees.js');
const { WEBHOOK_EVENTS } = await import('../src/stripesetup.js');

let server, base;
const client = () => {
  let cookie = '';
  return async (path, body, method) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
};
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  await client()('/auth/register', { email: 'h-owner@example.com', password: 'Str0ngPassword1', agree: true });
});
after(() => { server.close(); stripe.close(); });

const mkUser = async (email, customer, plan = 'pro', status = 'active') => {
  // Straight into the database: the sign-up route is rate limited, and these tests are about payments.
  const r = await run("INSERT INTO users (email, pass_hash, plan, stripe_customer, created_at) VALUES (?, 'x', ?, ?, ?)", email, plan, customer, Date.now());
  const id = Number(r.lastInsertRowid);
  await run('UPDATE users SET plan_status = ? WHERE id = ?', status, id);
  return id;
};
const sign = (body, t = Math.floor(Date.now() / 1000), secret = SECRET) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const hook = async (ev, o = {}) => {
  const body = o.body ?? JSON.stringify(ev);
  const r = await fetch(base + '/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': o.sig ?? sign(body, o.t, o.secret) }, body });
  return { status: r.status, body: await r.json().catch(() => null) };
};
let n = 0;
const ev = (type, object, extra = {}) => ({ id: `evt_h_${++n}`, type, created: Math.floor(Date.now() / 1000), livemode: false, data: { object }, ...extra });
const user = id => one('SELECT plan, plan_status FROM users WHERE id = ?', id);

// ---------------------------------------------------------------- client
test('client: every request pins the API version and creates carry an idempotency key', async () => {
  reqs.length = 0; process.env.STRIPE_PRICE_PRO = 'price_pro_m'; process.env.STRIPE_PRICE_PRO_YEARLY = 'price_pro_y';
  const base = { plan: 'pro', interval: 'month', trialDays: 0, email: 'a@example.com', userId: 7, baseUrl: 'https://pay.example' };
  await N.checkoutSubscription(base);
  await N.checkoutSubscription(base); // a double click
  await N.checkoutSubscription({ ...base, interval: 'year' });
  await N.refund('pi_abc');
  await N.checkoutDeposit({ amount: 25, email: 'a@example.com', userId: 7, ledgerId: 77, baseUrl: 'https://pay.example' });
  await N.cardFunding('pi_abc');
  for (const r of reqs) assert.equal(r.headers['stripe-version'], '2024-06-20', r.path);
  const keys = reqs.filter(r => r.method === 'POST').map(r => r.headers['idempotency-key']);
  assert.ok(keys.every(k => /^qp-/.test(k)), keys.join());
  assert.equal(keys[0], keys[1], 'the same click twice is one request');
  assert.notEqual(keys[0], keys[2], 'a different plan interval is a different request');
  assert.equal(keys[3], 'qp-refund-pi_abc');
  assert.equal(keys[4], 'qp-deposit-77');
  assert.equal(reqs.at(-1).method, 'GET');
  process.env.STRIPE_API_VERSION = '2099-01-01.test';
  reqs.length = 0; await N.refund('pi_x'); assert.equal(reqs[0].headers['stripe-version'], '2099-01-01.test');
  delete process.env.STRIPE_API_VERSION;
});

test('client: a live key is refused outside production (and with STRIPE_TEST_ONLY) before any request', async () => {
  const key = process.env.STRIPE_SECRET_KEY;
  reqs.length = 0;
  process.env.STRIPE_SECRET_KEY = 'sk_live_fake';
  try {
    await assert.rejects(N.refund('pi_live'), e => e.status === 503 && /sk_test_/.test(e.detail));
    process.env.NODE_ENV = 'production'; process.env.STRIPE_TEST_ONLY = '1';
    await assert.rejects(N.refund('pi_live'), e => e.status === 503);
    assert.equal(reqs.length, 0, 'nothing was sent to Stripe');
    delete process.env.STRIPE_TEST_ONLY;
    await N.refund('pi_live'); // production with STRIPE_TEST_ONLY off may use a live key
    assert.equal(reqs.length, 1);
  } finally { process.env.STRIPE_SECRET_KEY = key; delete process.env.STRIPE_TEST_ONLY; process.env.NODE_ENV = 'test'; }
});

test('client: card errors become plain language; other errors never show Stripe text; request id is kept', async () => {
  failQueue.push({ status: 402, body: { error: { type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.' } } });
  await assert.rejects(N.refund('pi_1'), e => e.status === 402 && /insufficient funds/i.test(e.message) && e.requestId === 'req_test_123');
  failQueue.push({ status: 402, body: { error: { type: 'card_error', code: 'card_declined', decline_code: 'stolen_card', message: 'Your card was reported stolen.' } } });
  await assert.rejects(N.refund('pi_2'), e => !/stolen/i.test(e.message) && /contact your bank/.test(e.message));
  failQueue.push({ status: 400, body: { error: { type: 'invalid_request_error', message: "No such price: 'price_secret'" } } });
  await assert.rejects(N.refund('pi_3'), e => e.status === 400 && !/price_secret|No such/.test(e.message) && /No such price/.test(e.detail));
  assert.match(C.declineMessage('incorrect_cvc'), /security code/);
  assert.match(C.declineMessage('expired_card'), /expired/);
  assert.match(C.declineMessage('authentication_required'), /confirm this payment/);
  assert.equal(C.declineMessage('something_new'), C.declineMessage('card_declined'));
});

test('client: a failed create is retried once with the same idempotency key; a POST without a key is not retried', async () => {
  reqs.length = 0;
  failQueue.push({ status: 503, body: { error: { message: 'down' } } });
  await N.refund('pi_retry');
  const posts = reqs.filter(r => r.path === '/v1/refunds');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);
  reqs.length = 0;
  failQueue.push({ status: 503, body: { error: { message: 'down' } } });
  await assert.rejects(C.stripePost('/refunds', { payment_intent: 'pi_nokey' }), e => e.status === 502);
  assert.equal(reqs.length, 1);
});

test('client: logs carry request ids and codes, never request bodies', async () => {
  const lines = []; const orig = console.warn; console.warn = l => lines.push(String(l));
  try {
    failQueue.push({ status: 402, body: { error: { type: 'card_error', code: 'card_declined', decline_code: 'generic_decline', message: 'x' } } });
    await N.refund('pi_4242424242424242').catch(() => {});
  } finally { console.warn = orig; }
  assert.ok(lines.some(l => l.includes('req_test_123') && l.includes('card_declined')));
  assert.ok(lines.every(l => !l.includes('4242') && !l.includes('sk_test')));
});

// ---------------------------------------------------------------- webhook
test('webhook: signature is checked on the raw body (bad, old, altered, wrong secret, malformed)', async () => {
  const e = ev('payment_intent.succeeded', { id: 'pi_sig' }), body = JSON.stringify(e);
  assert.equal((await hook(e, { sig: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` })).status, 400);
  assert.equal((await hook(e, { t: Math.floor(Date.now() / 1000) - 3600 })).status, 400, 'old timestamp (replay)');
  assert.equal((await hook(e, { secret: 'whsec_other' })).status, 400);
  assert.equal((await hook(e, { sig: sign(body), body: body.replace('pi_sig', 'pi_alt') })).status, 400, 'body changed after signing');
  assert.equal((await hook(e, { sig: '' })).status, 400);
  const junk = 'not json';
  assert.equal((await hook(null, { body: junk, sig: sign(junk) })).status, 400, 'signed but not JSON');
  assert.equal((await hook(e)).status, 200);
});

test('webhook: the handled event list covers every event the integration needs', () => {
  for (const t of ['checkout.session.completed', 'payment_intent.succeeded', 'payment_intent.payment_failed', 'charge.refunded', 'charge.dispute.created', 'invoice.payment_failed', 'invoice.paid', 'customer.subscription.deleted', 'customer.subscription.updated', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired']) assert.ok(WEBHOOK_EVENTS.includes(t), t);
});

test('webhook: a duplicate delivery is acknowledged and not processed twice', async () => {
  const uid = await mkUser('h-dup@example.com', 'cus_dup', 'free', 'canceled');
  const e = ev('checkout.session.completed', { id: 'cs_dup', customer: 'cus_dup', client_reference_id: String(uid), amount_total: 2900, invoice: 'in_dup', payment_status: 'paid', metadata: { kind: 'subscription', plan: 'pro', interval: 'month' } });
  assert.deepEqual((await hook(e)).body, { received: true });
  assert.deepEqual((await hook(e)).body, { received: true, duplicate: true });
  assert.equal((await all("SELECT id FROM ledger WHERE ref = 'in_dup'")).length, 1);
  assert.equal((await user(uid)).plan, 'pro');
  assert.equal((await one('SELECT status FROM stripe_events WHERE id = ?', e.id)).status, 'done');
});

test('webhook: events are claimed once, and a failed or abandoned claim can be taken again', async () => {
  const e = { id: 'evt_claim_1', type: 'x.y', created: 1 };
  assert.equal(await SE.claimEvent(e), 'new');
  assert.equal(await SE.claimEvent(e), 'duplicate', 'still processing');
  await SE.failEvent(e);
  assert.equal(await SE.claimEvent(e), 'retry');
  await SE.finishEvent(e);
  assert.equal(await SE.claimEvent(e), 'duplicate');
  const old = { id: 'evt_claim_2', type: 'x.y' };
  await SE.claimEvent(old);
  await run('UPDATE stripe_events SET received_at = received_at - 600000 WHERE id = ?', old.id);
  assert.equal(await SE.claimEvent(old), 'retry', 'the process died mid-event');
});

test('webhook: a late event never overwrites newer state (deleted stays deleted; older update ignored)', async () => {
  const a = await mkUser('h-ord-a@example.com', 'cus_ord_a');
  const sub = { id: 'sub_ord_a', customer: 'cus_ord_a', status: 'canceled', metadata: { plan: 'pro' } };
  assert.equal((await hook(ev('customer.subscription.deleted', sub, { created: 2000 }))).status, 200);
  assert.deepEqual(await user(a), { plan: 'free', plan_status: 'canceled' });
  const late = await hook(ev('customer.subscription.updated', { ...sub, status: 'active' }, { created: 3000 }));
  assert.equal(late.body.ignored, 'stale');
  assert.deepEqual(await user(a), { plan: 'free', plan_status: 'canceled' });

  const b = await mkUser('h-ord-b@example.com', 'cus_ord_b', 'pro', 'trialing');
  const sb = { id: 'sub_ord_b', customer: 'cus_ord_b', metadata: { plan: 'pro' }, current_period_end: 4102444800 };
  await hook(ev('customer.subscription.updated', { ...sb, status: 'active' }, { created: 5000 }));
  const older = await hook(ev('customer.subscription.updated', { ...sb, status: 'past_due' }, { created: 4000 }));
  assert.equal(older.body.ignored, 'stale');
  assert.equal((await user(b)).plan_status, 'active');
});

test('webhook: invoice.payment_failed marks the plan past due, but not after a newer successful payment', async () => {
  const a = await mkUser('h-inv-a@example.com', 'cus_inv_a');
  assert.equal((await hook(ev('invoice.payment_failed', { id: 'in_f1', customer: 'cus_inv_a', attempt_count: 1 }, { created: 7000 }))).status, 200);
  assert.equal((await user(a)).plan_status, 'past_due');
  assert.equal((await user(a)).plan, 'pro', 'not downgraded by a failed attempt');
  const b = await mkUser('h-inv-b@example.com', 'cus_inv_b');
  await hook(ev('invoice.paid', { id: 'in_p2', customer: 'cus_inv_b', amount_paid: 2900, lines: { data: [{ period: { end: 4102444800 } }] } }, { created: 9000 }));
  const stale = await hook(ev('invoice.payment_failed', { id: 'in_f2', customer: 'cus_inv_b' }, { created: 8000 }));
  assert.equal(stale.body.ignored, 'stale');
  assert.equal((await user(b)).plan_status, 'active');
});

test('webhook: a declined attempt is a note on a pending deposit; the later payment completes it', async () => {
  const uid = await mkUser('h-dep@example.com', 'cus_dep');
  const l = await run("INSERT INTO ledger (user_id, kind, amount, status, memo, at) VALUES (?, 'deposit', 50, 'pending', 'Debit card deposit (Stripe)', ?)", uid, Date.now());
  const id = Number(l.lastInsertRowid);
  await hook(ev('payment_intent.payment_failed', { id: 'pi_dep', metadata: { ledger_id: String(id) }, last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' } }));
  let row = await one('SELECT status, memo FROM ledger WHERE id = ?', id);
  assert.equal(row.status, 'pending', 'the customer can still pay with another card');
  assert.match(row.memo, /Debit card deposit \(Stripe\).*insufficient funds/);
  assert.ok(await one("SELECT id FROM audit_log WHERE event = 'payment_declined' AND user_id = ?", uid));
  await hook(ev('checkout.session.completed', { id: 'cs_dep', payment_status: 'paid', payment_intent: 'pi_dep', client_reference_id: String(uid), metadata: { kind: 'deposit', ledger_id: String(id) } }));
  assert.equal((await one('SELECT status FROM ledger WHERE id = ?', id)).status, 'received');
  await hook(ev('payment_intent.succeeded', { id: 'pi_dep', metadata: { ledger_id: String(id) } }));
  row = await one('SELECT status, memo FROM ledger WHERE id = ?', id);
  assert.equal(row.memo, 'Debit card deposit (Stripe)', 'the declined note is removed once it paid');
});

test('webhook: an expired Checkout page ends a pending deposit (and only a pending one)', async () => {
  const uid = await mkUser('h-exp@example.com', 'cus_exp');
  const mk = async s => Number((await run("INSERT INTO ledger (user_id, kind, amount, status, memo, at) VALUES (?, 'deposit', 20, ?, 'Deposit', ?)", uid, s, Date.now())).lastInsertRowid);
  const p = await mk('pending'), r = await mk('received');
  for (const id of [p, r]) await hook(ev('checkout.session.expired', { id: 'cs_exp_' + id, metadata: { kind: 'deposit', ledger_id: String(id) } }));
  assert.equal((await one('SELECT status FROM ledger WHERE id = ?', p)).status, 'failed');
  assert.equal((await one('SELECT status FROM ledger WHERE id = ?', r)).status, 'received');
});

test('webhook: full and partial refunds (made in the Stripe dashboard) are reflected in the ledger', async () => {
  const uid = await mkUser('h-ref@example.com', 'cus_ref');
  const mk = async ref => Number((await run("INSERT INTO ledger (user_id, kind, amount, status, ref, memo, at) VALUES (?, 'deposit', 100, 'received', ?, 'Debit card deposit (Stripe)', ?)", uid, ref, Date.now())).lastInsertRowid);
  const part = await mk('pi_part'), full = await mk('pi_full');
  await hook(ev('charge.refunded', { id: 'ch_1', payment_intent: 'pi_part', amount: 10000, amount_refunded: 500, refunded: false }));
  assert.match((await one('SELECT status, memo FROM ledger WHERE id = ?', part)).memo, /partly refunded \$5\.00/);
  assert.equal((await one('SELECT status FROM ledger WHERE id = ?', part)).status, 'received');
  await hook(ev('charge.refunded', { id: 'ch_2', payment_intent: 'pi_full', amount: 10000, amount_refunded: 10000, refunded: true }));
  assert.equal((await one('SELECT status FROM ledger WHERE id = ?', full)).status, 'refunded');
  assert.ok(await one("SELECT id FROM audit_log WHERE event = 'stripe_refund' AND user_id = ?", uid));
  assert.equal((await hook(ev('charge.refunded', { id: 'ch_3', payment_intent: 'pi_unknown', amount: 100, amount_refunded: 100, refunded: true }))).status, 200, 'a refund with no ledger row is acknowledged');
});

test('webhook: a dispute flags the ledger row (by payment intent, or by invoice via the charge) and moves no money', async () => {
  const uid = await mkUser('h-dis@example.com', 'cus_dis');
  const dep = Number((await run("INSERT INTO ledger (user_id, kind, amount, status, ref, memo, at) VALUES (?, 'deposit', 80, 'received', 'pi_dis', 'Deposit', ?)", uid, Date.now())).lastInsertRowid);
  const sub = Number((await run("INSERT INTO ledger (user_id, kind, amount, status, ref, memo, at) VALUES (?, 'subscription', 29, 'paid', 'in_disputed_1', 'Pro plan', ?)", uid, Date.now())).lastInsertRowid);
  await hook(ev('charge.dispute.created', { id: 'dp_1', payment_intent: 'pi_dis', charge: 'ch_d1', amount: 8000, currency: 'usd', reason: 'fraudulent' }));
  assert.equal((await one('SELECT status FROM ledger WHERE id = ?', dep)).status, 'disputed');
  reqs.length = 0;
  await hook(ev('charge.dispute.created', { id: 'dp_2', payment_intent: null, charge: 'ch_d2', amount: 2900, currency: 'usd', reason: 'general' }));
  assert.equal(reqs[0]?.path, '/v1/charges/ch_d2', 'the charge is looked up to find the invoice');
  assert.equal((await one('SELECT status FROM ledger WHERE id = ?', sub)).status, 'disputed');
  assert.equal((await all("SELECT id FROM audit_log WHERE event = 'stripe_dispute' AND user_id = ?", uid)).length, 2);
});

test('webhook: an event from the other mode is acknowledged and ignored', async () => {
  const uid = await mkUser('h-mode@example.com', 'cus_mode', 'free', 'canceled');
  const r = await hook(ev('checkout.session.completed', { id: 'cs_mode', customer: 'cus_mode', client_reference_id: String(uid), amount_total: 2900, invoice: 'in_mode', metadata: { kind: 'subscription', plan: 'pro' } }, { livemode: true }));
  assert.equal(r.status, 200); assert.equal(r.body.ignored, 'mode');
  assert.equal((await user(uid)).plan, 'free');
  assert.equal(await one("SELECT id FROM ledger WHERE ref = 'in_mode'"), undefined);
});

test('reports: test-mode payments are kept out of revenue; live and older rows are counted', async () => {
  const uid = await mkUser('h-rev@example.com', 'cus_rev', 'free', 'canceled');
  const sale = (id, inv, live) => hook(ev('checkout.session.completed', { id, customer: 'cus_rev', client_reference_id: String(uid), amount_total: 1000, invoice: inv, payment_status: 'paid', metadata: { kind: 'subscription', plan: 'pro', interval: 'month' } }, { livemode: live }));
  await sale('cs_rev_t', 'in_rev_test', false);
  assert.equal((await one("SELECT livemode FROM ledger WHERE ref = 'in_rev_test'")).livemode, 0);
  const total = async () => (await revenueSummary()).byKind.filter(k => k.kind === 'subscription' && k.status === 'paid').reduce((a, k) => a + k.total, 0);
  const before = await total();
  await run("INSERT INTO ledger (user_id, kind, amount, status, ref, memo, at) VALUES (?, 'subscription', 7, 'paid', 'in_rev_legacy', 'old row', ?)", uid, Date.now());
  assert.equal(await total(), before + 7, 'a row written before the column existed counts as live');
  const key = process.env.STRIPE_SECRET_KEY; process.env.STRIPE_SECRET_KEY = 'sk_live_fake'; // a production-style key; no request is made
  try { await sale('cs_rev_l', 'in_rev_live', true); } finally { process.env.STRIPE_SECRET_KEY = key; }
  assert.equal((await one("SELECT livemode FROM ledger WHERE ref = 'in_rev_live'")).livemode, 1);
  assert.equal(await total(), before + 7 + 10, 'the live sale is counted, the test sale is not');
});

test('errors: every response has a request id; a Stripe failure reaches the customer as plain language and is logged without its body', async () => {
  const r = await fetch(base + '/api/ledger');
  assert.match(r.headers.get('x-request-id'), /^[\w-]{8,64}$/);
  const kept = await fetch(base + '/api/ledger', { headers: { 'x-request-id': 'abc12345-trace' } });
  assert.equal(kept.headers.get('x-request-id'), 'abc12345-trace');
  const bad = await fetch(base + '/api/ledger', { headers: { 'x-request-id': 'bad id with spaces' } });
  assert.notEqual(bad.headers.get('x-request-id'), 'bad id with spaces');
  // A real checkout request that Stripe rejects.
  const u = client(); await u('/auth/register', { email: 'h-err@example.com', password: 'Str0ngPassword1', agree: true });
  process.env.STRIPE_PRICE_PRO = 'price_missing';
  // Stripe refuses the price twice: the price check before checkout (src/stripesetup.js checkPlanPrice) and the checkout itself.
  for (let i = 0; i < 2; i++) failQueue.push({ status: 400, body: { error: { type: 'invalid_request_error', message: "No such price: 'price_missing'" } } });
  const lines = []; const warn = console.warn; console.warn = l => lines.push(String(l));
  let res; try { res = await u('/billing/checkout', { plan: 'pro' }); } finally { console.warn = warn; }
  assert.equal(res.status, 400);
  assert.doesNotMatch(res.body.error, /price_missing|No such price|Stripe/);
  assert.ok(lines.some(l => l.includes('request_failed') && l.includes('req_test_123') && l.includes('"rid"')), lines.join('\n'));
  process.env.STRIPE_PRICE_PRO = 'price_pro_m';
});
