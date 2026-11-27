// Prices come only from Admin → Prices (src/prices.js, DECISIONS.md PR-1): no plan or credit price is
// written in the code or the homepage; a price takes effect on its date, in its currency; a plan without a
// price can't be bought; only an admin who passed the password step-up can set one, with an audit record.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { serve } from './client.js';

const P = await import('../src/prices.js');
const { PLANS, INSTITUTIONAL } = await import('../src/fees.js');
const { run, one } = await import('../src/db.js');
const { requiredPlan } = await import('../public/paid-controls.js');
let srv;
before(async () => { srv = await serve(); await run('DELETE FROM prices'); await P.loadPrices(true); });
after(async () => { await run('DELETE FROM prices'); await P.loadPrices(true); srv?.close(); });
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('prices: none is written in the code or the static homepage', () => {
  const fees = read('src/fees.js');
  assert.doesNotMatch(fees.slice(fees.indexOf('export const PLANS'), fees.indexOf('export const COMPARE')), /(monthly|yearly|from):\s*[1-9]|get from\(\) \{ return \d/, 'src/fees.js has no price');
  assert.doesNotMatch(read('src/credits.js'), /price:\s*\d/, 'credit packs have no price in the code');
  for (const f of ['public/index.html', 'public/yi.html']) {
    const plans = /<section[^>]*id="pricing"[\s\S]*?<\/section>/.exec(read(f))?.[0] || read(f);
    assert.doesNotMatch(plans, /class="price"[^>]*>\$[1-9]/, `${f}: plan cards carry no price`);
  }
});

test('prices: none set means none shown; a price takes effect on its date, in its currency', async () => {
  assert.equal(PLANS.pro.monthly, null); assert.equal(INSTITUTIONAL.from, null);
  const admin = { email: 'owner@example.com' }, now = Date.now();
  await P.setPrice(admin, { item: 'plan:pro:month', amount: 12.5, currency: 'EUR', effectiveAt: now - 1000 });
  await P.setPrice(admin, { item: 'plan:pro:month', amount: 13.5, currency: 'EUR', effectiveAt: now + 864e5 });
  assert.equal(PLANS.pro.monthly, 12.5); assert.equal(PLANS.pro.currency, 'EUR');
  assert.equal(P.amountOf('plan:pro:month', now + 2 * 864e5), 13.5, 'the later price from its date');
  assert.deepEqual(P.upcoming('plan:pro:month').map(u => u.amount), [13.5]);
  await assert.rejects(P.setPrice(admin, { item: 'plan:pro:month', amount: 0 }), /above 0/);
  await assert.rejects(P.setPrice(admin, { item: 'plan:pro:month', amount: 5, currency: 'XYZ' }), /Currency/);
  await assert.rejects(P.setPrice(admin, { item: 'plan:free:month', amount: 5 }), /Unknown price/);
  await run('DELETE FROM prices'); await P.loadPrices(true);
});

test('prices: Admin → Prices needs admin and the step-up, is audited, and an unpriced plan cannot be bought', async () => {
  const c = srv.client(); const a = await c.signup('prices-admin@example.com');
  await run("UPDATE users SET role = 'admin' WHERE id = ?", a.id);
  const member = srv.client(); await member.signup('prices-member@example.com');
  assert.equal((await member('/admin/prices', { item: 'plan:pro:month', amount: 1 })).status, 403);
  const locked = await c('/admin/prices', { item: 'plan:pro:month', amount: 9.99, currency: 'USD' });
  assert.equal(locked.status, 403); assert.equal(locked.body.adminUnlock, true);
  assert.equal((await c('/admin/server/unlock', { password: 'Str0ngPassword' })).status, 200);
  assert.equal((await c('/admin/prices', { item: 'credits:nope', amount: 3 })).status, 400, 'only packs that exist');
  const ok = await c('/admin/prices', { item: 'plan:elite:month', amount: 30, currency: 'USD' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await one("SELECT COUNT(*) n FROM audit_log WHERE event = 'price_set' AND user_id = ?", a.id)).n, 1);
  const pub = (await (await fetch(srv.base + '/api/public/prices')).json());
  assert.equal(pub.plans.elite.month.amount, 30); assert.equal(pub.plans.pro.month, null);
  const r = await member('/billing/checkout', { plan: 'pro', interval: 'month' });
  assert.ok(r.status >= 400, 'a plan without a price is not for sale');
  await run('DELETE FROM prices'); await P.loadPrices(true);
});

test('prices: "Unlock with" labels and monthly credits use the plans that exist', async () => {
  const names = new Set(Object.values(PLANS).map(p => p.name));
  for (const [feature, plan] of Object.entries(requiredPlan)) assert.ok(names.has(plan), `${feature}: "${plan}" is a plan`);
  const { config } = await import('../src/credits.js');
  assert.deepEqual(Object.keys(config().monthly).sort(), Object.keys(PLANS).sort());
  assert.ok(config().packs.every(p => p.price === null), 'a pack has no price until the owner enters one');
});
