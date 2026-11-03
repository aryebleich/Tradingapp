// Finishing the Stripe setup from the secret key: prices, webhook and billing portal are created
// once (a second run changes nothing), the webhook secret is saved and then verifies real events,
// and checkout uses the saved prices. Stripe is a local fake.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const db = { products: [], prices: [], hooks: [], portals: [], sessions: [] }, calls = [];
let n = 0; const id = p => `${p}_${++n}`;
const stripe = http.createServer((req, res) => {
  let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
    const u = new URL(req.url, 'http://x'), q = Object.fromEntries(new URLSearchParams(req.method === 'GET' ? u.search : b));
    calls.push(`${req.method} ${u.pathname}`);
    const send = (o, s = 200) => { res.statusCode = s; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== 'Bearer sk_test_fake') return send({ error: { message: 'Invalid API Key' } }, 401);
    const p = u.pathname;
    if (p === '/v1/account') return send({ id: 'acct_1', charges_enabled: true, details_submitted: true, settings: { dashboard: { display_name: 'Brightfolio' } } });
    if (p === '/v1/products' && req.method === 'GET') return send({ data: db.products });
    if (p === '/v1/products') { const x = { id: id('prod'), name: q.name, metadata: { brightfolio_plan: q['metadata[brightfolio_plan]'] } }; db.products.push(x); return send(x); }
    if (p.startsWith('/v1/products/')) return send(db.products.find(x => x.id === p.split('/')[3]));
    if (p === '/v1/prices' && req.method === 'GET') return send({ data: db.prices.filter(x => x.active && x.lookup_key === q['lookup_keys[0]']) });
    if (p === '/v1/prices') { const x = { id: id('price'), product: q.product, currency: q.currency, unit_amount: +q.unit_amount, lookup_key: q.lookup_key, active: true, recurring: { interval: q['recurring[interval]'] } }; db.prices.forEach(o => { if (o.lookup_key === x.lookup_key) o.lookup_key = null; }); db.prices.push(x); return send(x); }
    if (p.startsWith('/v1/prices/')) { const x = db.prices.find(o => o.id === p.split('/')[3]); if (req.method === 'POST' && q.active === 'false') x.active = false; return send(x); }
    if (p === '/v1/webhook_endpoints' && req.method === 'GET') return send({ data: db.hooks });
    if (p === '/v1/webhook_endpoints') { const events = Object.entries(q).filter(([k]) => k.startsWith('enabled_events')).map(([, v]) => v); const x = { id: id('we'), url: q.url, enabled_events: events, status: 'enabled', secret: 'whsec_' + crypto.randomBytes(8).toString('hex') }; db.hooks.push(x); return send(x); }
    if (p.startsWith('/v1/webhook_endpoints/')) { const wid = p.split('/')[3]; if (req.method === 'DELETE') { db.hooks = db.hooks.filter(x => x.id !== wid); return send({ deleted: true }); } const x = db.hooks.find(o => o.id === wid); return x ? send({ ...x, secret: undefined }) : send({ error: { message: 'No such webhook' } }, 404); }
    if (p === '/v1/billing_portal/configurations' && req.method === 'GET') return send({ data: db.portals });
    if (p.startsWith('/v1/billing_portal/configurations')) { let x = db.portals.find(o => o.id === p.split('/')[4]); if (!x) { x = { id: id('bpc'), metadata: { brightfolio: q['metadata[brightfolio]'] } }; db.portals.push(x); } x.body = q; return send(x); }
    if (p === '/v1/checkout/sessions') { db.sessions.push(q); return send({ id: id('cs'), url: 'https://checkout.stripe.example/pay' }); }
    if (p === '/v1/billing_portal/sessions') { db.sessions.push(q); return send({ url: 'https://billing.stripe.example/p' }); }
    send({ error: { message: 'unknown ' + p } }, 404);
  });
});
await new Promise(r => stripe.listen(0, '127.0.0.1', r));
Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_API_URL: `http://127.0.0.1:${stripe.address().port}`, PUBLIC_URL: 'https://pay.example' });
for (const k of Object.keys(process.env)) if (/^STRIPE_(PRICE|WEBHOOK|PORTAL)/.test(k)) delete process.env[k];

const { app } = await import('../server.js');
const { one } = await import('../src/db.js');
let server, base;
const client = () => {
  let cookie = '';
  return async (path, body, method) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
};
const owner = client(), user = client();
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  await owner('/auth/register', { email: 'owner@example.com', password: 'Str0ngPassword1', agree: true });
  await user('/auth/register', { email: 'payer@example.com', password: 'Str0ngPassword1', agree: true });
});
after(() => { server.close(); stripe.close(); });

test('before setup: checkout says the owner must finish Stripe, status lists what is missing', async () => {
  const c = await user('/billing/checkout', { plan: 'pro' });
  assert.equal(c.status, 503); assert.match(c.body.error, /finish the Stripe setup/);
  const s = (await owner('/admin/site/stripe')).body;
  assert.equal(s.keySet, true); assert.equal(s.mode, 'test'); assert.equal(s.ready, false);
  assert.equal(s.webhookUrl, 'https://pay.example/webhooks/stripe');
  assert.equal(s.prices.STRIPE_PRICE_PRO, false);
  assert.equal((await user('/admin/site/stripe')).status, 403);
});

test('setup creates prices, webhook and portal once; a second run changes nothing', async () => {
  const r = await owner('/admin/site/stripe/setup', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(db.products.length, 3); assert.equal(db.prices.length, 6); assert.equal(db.hooks.length, 1); assert.equal(db.portals.length, 1);
  const pro = db.prices.find(p => p.lookup_key === 'brightfolio_pro_month');
  assert.equal(pro.unit_amount, 5300); assert.equal(pro.recurring.interval, 'month');
  assert.equal(db.prices.find(p => p.lookup_key === 'brightfolio_ultimate_year').unit_amount, 320000);
  assert.equal(db.hooks[0].url, 'https://pay.example/webhooks/stripe');
  assert.ok(db.hooks[0].enabled_events.includes('checkout.session.completed') && db.hooks[0].enabled_events.includes('invoice.paid'));
  assert.ok(r.body.saved.includes('STRIPE_WEBHOOK_SECRET') && r.body.saved.includes('STRIPE_PRICE_PRO_YEARLY') && r.body.saved.includes('STRIPE_PORTAL_CONFIG'));
  assert.equal(process.env.STRIPE_PRICE_PRO, pro.id); assert.equal(process.env.STRIPE_WEBHOOK_SECRET, db.hooks[0].secret);
  const again = (await owner('/admin/site/stripe/setup', {})).body;
  assert.equal(db.prices.length, 6); assert.equal(db.hooks.length, 1); assert.deepEqual(again.saved, []);
  const s = (await owner('/admin/site/stripe')).body;
  assert.equal(s.ready, true); assert.equal(s.webhook.status, 'enabled');
});

test('a changed plan price makes a new Stripe price and retires the old one', async () => {
  const { PLANS } = await import('../src/fees.js');
  const old = PLANS.pro.monthly; PLANS.pro.monthly = 59;
  try {
    await owner('/admin/site/stripe/setup', {});
    const live = db.prices.filter(p => p.active && p.recurring.interval === 'month' && p.unit_amount === 5900);
    assert.equal(live.length, 1); assert.equal(process.env.STRIPE_PRICE_PRO, live[0].id);
    assert.equal(db.prices.find(p => p.unit_amount === 5300).active, false);
  } finally { PLANS.pro.monthly = old; await owner('/admin/site/stripe/setup', {}); }
});

test('customers can pay: checkout, then the signed webhook switches the plan on', async () => {
  const c = await user('/billing/checkout', { plan: 'pro', interval: 'year' });
  assert.equal(c.status, 200, JSON.stringify(c.body)); assert.equal(c.body.url, 'https://checkout.stripe.example/pay');
  const sess = db.sessions.at(-1);
  assert.equal(sess['line_items[0][price]'], process.env.STRIPE_PRICE_PRO_YEARLY);
  assert.equal(sess.success_url, 'https://pay.example/app#/funding?ok=1');
  const u = await one('SELECT id FROM users WHERE email = ?', 'payer@example.com');
  const ev = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', livemode: false, data: { object: { id: 'cs_1', customer: 'cus_9', client_reference_id: String(u.id), amount_total: 53000, invoice: 'in_1', metadata: { kind: 'subscription', plan: 'pro', interval: 'year' } } } });
  const t = Math.floor(Date.now() / 1000), sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${ev}`).digest('hex');
  assert.equal((await fetch(base + '/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${'0'.repeat(64)}` }, body: ev })).status, 400);
  const ok = await fetch(base + '/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body: ev });
  assert.equal(ok.status, 200);
  const after = await one('SELECT plan, plan_status, stripe_customer FROM users WHERE id = ?', u.id);
  assert.deepEqual({ ...after }, { plan: 'pro', plan_status: 'active', stripe_customer: 'cus_9' });
  for (let i = 0; i < 20 && !(await owner('/admin/site/stripe')).body.lastEvent; i++) await new Promise(r => setTimeout(r, 50));
  const s = (await owner('/admin/site/stripe')).body;
  assert.equal(s.lastEvent.type, 'checkout.session.completed'); assert.ok(s.badSignature);
  const portal = await user('/billing/portal', {});
  assert.equal(portal.status, 200); assert.equal(db.sessions.at(-1).configuration, process.env.STRIPE_PORTAL_CONFIG);
});

test('a wrong key is reported plainly', async () => {
  const k = process.env.STRIPE_SECRET_KEY; process.env.STRIPE_SECRET_KEY = 'sk_test_wrong';
  try { const r = await owner('/admin/site/stripe/setup', {}); assert.equal(r.status, 400); assert.match(r.body.error, /Invalid API Key/); }
  finally { process.env.STRIPE_SECRET_KEY = k; }
});
