// Twilio (SMS + voice hotline) and Stripe (plans + debit card deposits) over plain HTTPS.
import crypto from 'node:crypto';

const env = k => process.env[k];
export const twilioEnabled = () => !!(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_FROM'));
export const stripeEnabled = () => !!env('STRIPE_SECRET_KEY');

export async function sendSms(to, body) {
  if (!twilioEnabled()) { console.log(`[sms disabled] to ${to}: ${body}`); return { simulated: true }; }
  const sid = env('TWILIO_ACCOUNT_SID');
  const r = await fetch(`${(env('TWILIO_API_URL') || 'https://api.twilio.com').replace(/\/$/, '')}/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: env('TWILIO_FROM'), Body: body.slice(0, 1500) }),
  });
  if (!r.ok) throw new Error('Twilio ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

// An outbound call; Twilio fetches `url` for what to say when it is answered.
export async function placeCall(to, url) {
  if (!twilioEnabled()) { console.log(`[call disabled] to ${to}: ${url}`); return { simulated: true }; }
  const sid = env('TWILIO_ACCOUNT_SID');
  const r = await fetch(`${(env('TWILIO_API_URL') || 'https://api.twilio.com').replace(/\/$/, '')}/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: env('TWILIO_FROM'), Url: url, Method: 'POST', Timeout: '30' }),
  });
  if (!r.ok) throw new Error('Twilio ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

// https://www.twilio.com/docs/usage/webhooks/webhooks-security
export function validTwilioSignature(url, params, signature) {
  if (!env('TWILIO_AUTH_TOKEN')) return process.env.NODE_ENV !== 'production';
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const want = crypto.createHmac('sha1', env('TWILIO_AUTH_TOKEN')).update(data).digest('base64');
  return !!signature && signature.length === want.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(want));
}

export const xml = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

async function stripe(path, params) {
  const r = await fetch((env('STRIPE_API_URL') || 'https://api.stripe.com') + '/v1' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env('STRIPE_SECRET_KEY'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Stripe: ' + (d.error?.message || r.status));
  return d;
}

// A one-time credit pack payment; the webhook adds the credits (metadata.kind = 'credits').
export const checkoutCredits = ({ pack, email, userId, baseUrl }) => stripe('/checkout/sessions', {
  mode: 'payment', customer_email: email, client_reference_id: String(userId),
  'metadata[kind]': 'credits', 'metadata[credits]': String(pack.credits), 'metadata[pack]': pack.id,
  'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][product_data][name]': `${pack.credits.toLocaleString('en-US')} Brightolio credits`,
  'line_items[0][price_data][unit_amount]': String(Math.round(pack.price * 100)), 'line_items[0][quantity]': '1',
  success_url: `${baseUrl}/app#/funding?credits=1`, cancel_url: `${baseUrl}/app#/funding`,
});

// interval: 'month' or 'year' (STRIPE_PRICE_PRO / STRIPE_PRICE_PRO_YEARLY ...). trialDays > 0 adds a free trial.
export function checkoutSubscription({ plan, interval = 'month', trialDays = 0, email, customer, userId, baseUrl }) {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}${interval === 'year' ? '_YEARLY' : ''}`;
  const price = env(key);
  if (!price) throw Object.assign(new Error('Paid plans are almost ready: the site owner needs to finish the Stripe setup (Admin → Money & fees → Stripe).'), { status: 503 });
    // Which payment methods appear (card, Link, bank...) is set in the Stripe dashboard (Settings →
  // Payment methods); Stripe no longer accepts payment_method_types on Checkout Sessions.
  return stripe('/checkout/sessions', {
    mode: 'subscription', ...(customer ? { customer } : { customer_email: email }), client_reference_id: String(userId),
    'metadata[plan]': plan, 'metadata[kind]': 'subscription', 'metadata[interval]': interval,
    'subscription_data[metadata][plan]': plan, 'subscription_data[metadata][user_id]': String(userId),
    ...(trialDays > 0 ? { 'subscription_data[trial_period_days]': String(trialDays) } : {}),
    allow_promotion_codes: 'true',
    'line_items[0][price]': price, 'line_items[0][quantity]': '1',
    success_url: `${baseUrl}/app#/funding?ok=1`, cancel_url: `${baseUrl}/app#/funding`,
  });
}

// Stripe-hosted page where customers update cards, switch plans, download invoices or cancel.
export const billingPortal = ({ customer, baseUrl }) => stripe('/billing_portal/sessions', { customer, return_url: `${baseUrl}/app#/funding`, ...(env('STRIPE_PORTAL_CONFIG') ? { configuration: env('STRIPE_PORTAL_CONFIG') } : {}) });

// Account credit applied to the customer's next invoice (negative amount = credit).
export const creditCustomer = (customer, dollars, description) =>
  stripe(`/customers/${encodeURIComponent(customer)}/balance_transactions`, { amount: String(-Math.round(dollars * 100)), currency: 'usd', description });

// Card deposit. The methods offered come from the Stripe dashboard; the webhook accepts a debit
// card (Stripe reports card.funding = 'debit') or a bank transfer, and refunds anything else.
export function checkoutDeposit({ amount, email, userId, ledgerId, baseUrl }) {
  return stripe('/checkout/sessions', {
    mode: 'payment', customer_email: email, client_reference_id: String(userId),
    'metadata[kind]': 'deposit', 'metadata[ledger_id]': String(ledgerId),
    'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][product_data][name]': 'Account deposit',
    'line_items[0][price_data][unit_amount]': String(Math.round(amount * 100)), 'line_items[0][quantity]': '1',
    'payment_intent_data[metadata][ledger_id]': String(ledgerId),
    success_url: `${baseUrl}/app#/funding?ok=1`, cancel_url: `${baseUrl}/app#/funding`,
  });
}

export async function cardFunding(paymentIntentId) {
  const r = await fetch(`${env('STRIPE_API_URL') || 'https://api.stripe.com'}/v1/payment_intents/${paymentIntentId}?expand[]=latest_charge`, { headers: { Authorization: 'Bearer ' + env('STRIPE_SECRET_KEY') } });
  const d = await r.json();
  return d.latest_charge?.payment_method_details?.card?.funding;
}

export const refund = paymentIntent => stripe('/refunds', { payment_intent: paymentIntent });

// https://docs.stripe.com/webhooks#verify-manually
export function verifyStripe(raw, header) {
  const secret = env('STRIPE_WEBHOOK_SECRET');
  if (!secret || !header) return false;
  const kv = header.split(',').map(p => p.trim().split('=')), t = kv.find(([k]) => k === 't')?.[1];
  if (!t || !(Math.abs(Date.now() / 1000 - +t) <= 300)) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  // Stripe sends one v1 signature per active secret (two for a while after the secret is rolled).
  return kv.some(([k, v]) => k === 'v1' && v?.length === want.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(want)));
}

// Transactional email through Resend (free tier: 3,000/month). Without a key the message is
// logged, which is enough for local development.
export const emailEnabled = () => !!env('RESEND_API_KEY');
export async function sendEmail(to, subject, text) {
  // Accounts opened by phone have a placeholder address until the user adds a real one.
  if (/\.invalid$/i.test(String(to))) return { skipped: true };
  if (!emailEnabled()) { console.log(`[email disabled] to ${to}: ${subject}\n${text}`); return { simulated: true }; }
  const r = await fetch(`${(env('RESEND_API_URL') || 'https://api.resend.com').replace(/\/$/, '')}/emails`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env('RESEND_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('EMAIL_FROM') || 'Brightolio <onboarding@resend.dev>', to: [to], subject, text }),
  });
  if (!r.ok) throw new Error('Email ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
