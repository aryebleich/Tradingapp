// Finishes the Stripe setup from the secret key alone (Admin → Money & fees → Stripe):
//   prices   a product per paid plan with a monthly and a yearly price (found again by lookup key,
//            so pressing the button twice changes nothing; a new plan price moves the key over)
//   webhook  an endpoint at <site>/webhooks/stripe for the events the server handles; its signing
//            secret is saved as STRIPE_WEBHOOK_SECRET (Stripe shows it only when it is created)
//   portal   a customer billing portal (change card, switch plan, invoices, cancel) when the
//            account has none yet
// Returns the settings to save (price ids, webhook secret, portal id) and a plain report.
import { PLANS, PAID } from './fees.js';

const API = () => (process.env.STRIPE_API_URL || 'https://api.stripe.com').replace(/\/$/, '');
export const WEBHOOK_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'invoice.paid', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'];
export const STRIPE_VERSION = '2024-06-20';
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

// Stripe's form encoding, nested: { a: { b: [1, 2] } } → a[b][0]=1&a[b][1]=2
export function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') form(Array.isArray(v) ? Object.fromEntries(v.map((x, i) => [i, x])) : v, key, out);
    else out.append(key, String(v));
  }
  return out;
}
export async function stripeApi(method, path, params) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw bad('Add STRIPE_SECRET_KEY first');
  const q = method === 'GET' && params ? '?' + form(params) : '';
  const r = await fetch(API() + '/v1' + path + q, { method, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': STRIPE_VERSION }, body: method === 'GET' ? undefined : form(params || {}), signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw bad(`Stripe: ${d.error?.message || r.status}`, r.status === 401 ? 400 : 502);
  return d;
}
export const keyMode = (k = process.env.STRIPE_SECRET_KEY || '') => (/^(sk|rk)_live_/.test(k) ? 'live' : /^(sk|rk)_test_/.test(k) ? 'test' : 'unknown');
const lookupKey = (plan, interval) => `brightfolio_${plan}_${interval}`;
export const priceEnv = (plan, interval) => `STRIPE_PRICE_${plan.toUpperCase()}${interval === 'year' ? '_YEARLY' : ''}`;

async function ensurePrices() {
  const report = [], changes = {};
  const products = (await stripeApi('GET', '/products', { active: true, limit: 100 })).data || [];
  for (const plan of PAID) {
    const p = PLANS[plan];
    let prod = products.find(x => x.metadata?.brightfolio_plan === plan);
    if (!prod) { prod = await stripeApi('POST', '/products', { name: `Brightolio ${p.name}`, description: p.tagline, metadata: { brightfolio_plan: plan } }); report.push(`Created the product "Brightolio ${p.name}"`); }
    else if (prod.name !== `Brightolio ${p.name}`) await stripeApi('POST', `/products/${prod.id}`, { name: `Brightolio ${p.name}` });
    for (const [interval, amount] of [['month', p.monthly], ['year', p.yearly]]) {
      const lk = lookupKey(plan, interval), cents = Math.round(amount * 100);
      const found = ((await stripeApi('GET', '/prices', { lookup_keys: [lk], active: true, limit: 1 })).data || [])[0];
      let price = found;
      if (!found || found.unit_amount !== cents || found.currency !== 'usd' || found.product !== prod.id) {
        price = await stripeApi('POST', '/prices', { product: prod.id, currency: 'usd', unit_amount: cents, recurring: { interval }, lookup_key: lk, transfer_lookup_key: true, nickname: `${p.name} ${interval === 'year' ? 'yearly' : 'monthly'}`, metadata: { brightfolio_plan: plan } });
        if (found) await stripeApi('POST', `/prices/${found.id}`, { active: false });
        report.push(`${found ? 'Updated' : 'Created'} the ${p.name} ${interval === 'year' ? 'yearly' : 'monthly'} price: $${amount}`);
      }
      if (process.env[priceEnv(plan, interval)] !== price.id) changes[priceEnv(plan, interval)] = price.id;
    }
  }
  if (!report.length) report.push('Plan prices already match the site');
  return { changes, report };
}

async function ensureWebhook(siteUrl, savedId) {
  const url = `${siteUrl}/webhooks/stripe`;
  if (!/^https:\/\//.test(url)) throw bad(`Stripe can only send events to an https address; set PUBLIC_URL to your site's address (now ${siteUrl})`);
  const all = ((await stripeApi('GET', '/webhook_endpoints', { limit: 100 })).data || []).filter(w => w.url === url);
  const ours = all.find(w => w.id === savedId);
  if (ours && process.env.STRIPE_WEBHOOK_SECRET) {
    const missing = WEBHOOK_EVENTS.filter(e => !ours.enabled_events?.includes(e) && !ours.enabled_events?.includes('*'));
    if (missing.length || ours.status !== 'enabled') await stripeApi('POST', `/webhook_endpoints/${ours.id}`, { enabled_events: WEBHOOK_EVENTS, disabled: false });
    return { changes: {}, id: ours.id, report: [missing.length || ours.status !== 'enabled' ? 'Updated the webhook\'s events' : `Webhook already set up: ${url}`] };
  }
  // Stripe shows a signing secret only once, when the endpoint is made: make a fresh one, then
  // remove any older endpoints for this same address (their secrets are unknown here).
  // Pinned API version: events arrive in the shape the webhook handler reads (e.g. a subscription's
  // current_period_end, which later versions moved onto its items).
  const w = await stripeApi('POST', '/webhook_endpoints', { url, enabled_events: WEBHOOK_EVENTS, api_version: STRIPE_VERSION, description: 'Brightolio: plans, credits and deposits' });
  for (const old of all) await stripeApi('DELETE', `/webhook_endpoints/${old.id}`).catch(() => {});
  return { changes: { STRIPE_WEBHOOK_SECRET: w.secret }, id: w.id, report: [`Created the webhook ${url}${all.length ? ` (replaced ${all.length} older one${all.length > 1 ? 's' : ''} for the same address)` : ''}`] };
}

async function ensurePortal(priceIds, siteUrl) {
  const list = ((await stripeApi('GET', '/billing_portal/configurations', { active: true, limit: 10 })).data || []);
  const mine = list.find(c => c.metadata?.brightfolio === '1');
  const products = {};
  for (const [k, id] of Object.entries(priceIds)) { const plan = k.replace('STRIPE_PRICE_', '').replace('_YEARLY', '').toLowerCase(); (products[plan] ||= []).push(id); }
  const prodIds = await Promise.all(Object.entries(products).map(async ([, prices]) => ({ product: (await stripeApi('GET', `/prices/${prices[0]}`)).product, prices })));
  const body = {
    business_profile: { headline: 'Manage your Brightolio plan', privacy_policy_url: `${siteUrl}/privacy.html`, terms_of_service_url: `${siteUrl}/terms.html` },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address'] }, invoice_history: { enabled: true }, payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end', cancellation_reason: { enabled: true, options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other'] } },
      subscription_update: { enabled: true, default_allowed_updates: ['price'], proration_behavior: 'create_prorations', products: prodIds },
    },
    default_return_url: `${siteUrl}/app#/funding`, metadata: { brightfolio: '1' },
  };
  if (!/^https:\/\//.test(siteUrl)) { delete body.business_profile.privacy_policy_url; delete body.business_profile.terms_of_service_url; delete body.default_return_url; }
  const c = mine ? await stripeApi('POST', `/billing_portal/configurations/${mine.id}`, body) : await stripeApi('POST', '/billing_portal/configurations', body);
  return { changes: process.env.STRIPE_PORTAL_CONFIG === c.id ? {} : { STRIPE_PORTAL_CONFIG: c.id }, report: [mine ? 'Billing portal kept up to date (change card, switch plan, invoices, cancel)' : 'Created the billing portal (change card, switch plan, invoices, cancel)'] };
}

// Everything at once. siteUrl: the public https address; savedWebhookId: from an earlier run.
export async function setupStripe({ siteUrl, savedWebhookId }) {
  const acct = await stripeApi('GET', '/account');
  const prices = await ensurePrices();
  const allPrices = Object.fromEntries(PAID.flatMap(plan => ['month', 'year'].map(i => [priceEnv(plan, i), prices.changes[priceEnv(plan, i)] || process.env[priceEnv(plan, i)]])));
  const hook = await ensureWebhook(siteUrl, savedWebhookId);
  const portal = await ensurePortal(allPrices, siteUrl);
  return {
    mode: keyMode(), account: { id: acct.id, name: acct.settings?.dashboard?.display_name || acct.business_profile?.name || null, chargesEnabled: acct.charges_enabled !== false, detailsSubmitted: acct.details_submitted !== false },
    webhookId: hook.id, changes: { ...prices.changes, ...hook.changes, ...portal.changes }, report: [...prices.report, ...hook.report, ...portal.report],
  };
}

// What is set and what is missing, for the admin card.
export async function stripeStatus({ siteUrl, lastEvent, savedWebhookId }) {
  const base = { keySet: !!process.env.STRIPE_SECRET_KEY, mode: keyMode(), siteUrl, webhookUrl: `${siteUrl}/webhooks/stripe`, webhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET, events: WEBHOOK_EVENTS, lastEvent: lastEvent || null,
    prices: Object.fromEntries(PAID.flatMap(plan => ['month', 'year'].map(i => [priceEnv(plan, i), !!process.env[priceEnv(plan, i)]]))), portal: !!process.env.STRIPE_PORTAL_CONFIG };
  if (!base.keySet) return { ...base, ready: false };
  let account = null, webhook = null, error = null;
  try {
    const a = await stripeApi('GET', '/account');
    account = { id: a.id, name: a.settings?.dashboard?.display_name || a.business_profile?.name || null, chargesEnabled: a.charges_enabled !== false, detailsSubmitted: a.details_submitted !== false };
    if (savedWebhookId) { const w = await stripeApi('GET', `/webhook_endpoints/${savedWebhookId}`).catch(() => null); webhook = w ? { status: w.status, url: w.url } : { missing: true }; }
  } catch (e) { error = e.message; }
  const ready = !error && base.webhookSecret && Object.values(base.prices).every(Boolean) && !!account?.chargesEnabled && !webhook?.missing;
  return { ...base, account, webhook, error, ready };
}
