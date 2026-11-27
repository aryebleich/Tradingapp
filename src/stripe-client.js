// One place for every call the server makes to Stripe (Checkout, the billing portal, refunds, balance
// credits). Before this file notify.js and payments.js each had their own copy that sent no API
// version, no idempotency key and no timeout, and showed Stripe's raw error text to customers.
//
//   Stripe-Version     every request pins the API version (STRIPE_API_VERSION, default below), so an
//                      upgrade of the account's default version in the dashboard cannot change the
//                      shape of what the webhook handler reads.
//   Idempotency-Key    every create request carries one; a retry or a double click returns the first
//                      result instead of making a second charge, session or refund.
//   Request-Id         Stripe's request id is kept on the error and logged, never the request body.
//   test keys          a live key (sk_live_ / rk_live_) is refused outside production, and anywhere
//                      when STRIPE_TEST_ONLY=1, so a sandbox or CI run can never touch live mode.
//
// Reference (verify against the current pages before changing anything here):
//   https://docs.stripe.com/api/versioning       https://docs.stripe.com/api/idempotent_requests
//   https://docs.stripe.com/error-codes          https://docs.stripe.com/declines/codes
import crypto from 'node:crypto';
import { siteGet } from './site.js';

export const DEFAULT_STRIPE_VERSION = '2024-06-20';
export const stripeVersion = () => process.env.STRIPE_API_VERSION || DEFAULT_STRIPE_VERSION;
export const keyMode = (k = process.env.STRIPE_SECRET_KEY || '') => (/^(sk|rk)_live_/.test(k) ? 'live' : /^(sk|rk)_test_/.test(k) ? 'test' : 'unknown');
const apiBase = () => (process.env.STRIPE_API_URL || 'https://api.stripe.com').replace(/\/$/, '');

// Plain-language text for the card errors a customer can act on. Reasons that hint at fraud or a
// stolen card are never spelled out: the customer is told to contact their bank.
const BANK = 'Your card was declined. Please try another card or contact your bank.';
const DECLINES = {
  insufficient_funds: 'Your card has insufficient funds. Please try another card.',
  expired_card: 'Your card has expired. Please use a card that has not expired.',
  incorrect_cvc: "The security code (CVC) doesn't match. Please check it and try again.",
  invalid_cvc: "The security code (CVC) isn't valid. Please check it and try again.",
  incorrect_number: "The card number isn't correct. Please check it and try again.",
  invalid_number: "The card number isn't correct. Please check it and try again.",
  invalid_expiry_month: "The card's expiry date isn't valid. Please check it and try again.",
  invalid_expiry_year: "The card's expiry date isn't valid. Please check it and try again.",
  card_not_supported: "This card doesn't support this kind of payment. Please try another card.",
  currency_not_supported: "This card doesn't support payments in this currency. Please try another card.",
  processing_error: 'There was a problem processing your card. Please try again in a moment.',
  try_again_later: 'Your bank could not approve the payment right now. Please try again in a moment.',
  issuer_not_available: 'Your bank could not be reached. Please try again in a moment.',
  reenter_transaction: 'Your bank could not process the payment. Please try again.',
  authentication_required: 'Your bank needs you to confirm this payment. Please try again and complete the verification step.',
  authentication_failure: "We couldn't verify the payment with your bank. Please try again or use another card.",
  payment_intent_authentication_failure: "We couldn't verify the payment with your bank. Please try again or use another card.",
  card_velocity_exceeded: 'Your card has been used too many times recently. Please try again later or use another card.',
  withdrawal_count_limit_exceeded: 'Your card has reached its limit for now. Please try another card.',
  // These say nothing about why:
  generic_decline: BANK, card_declined: BANK, do_not_honor: BANK, call_issuer: BANK, lost_card: BANK, stolen_card: BANK,
  pickup_card: BANK, fraudulent: BANK, restricted_card: BANK, security_violation: BANK, service_not_allowed: BANK, transaction_not_allowed: BANK,
};
// decline_code is the most specific; code (e.g. card_declined, expired_card) is the fallback.
export const declineMessage = (code, declineCode) => DECLINES[declineCode] || DECLINES[code] || BANK;

export class StripeError extends Error {
  // `message` is safe to show to a customer; `detail` is Stripe's own text, for the log and the owner.
  constructor({ status = 502, type, code, declineCode, requestId, detail, param } = {}) {
    super(type === 'card_error' ? declineMessage(code, declineCode) : status === 429 ? 'Payments are busy right now. Please try again in a moment.' : status === 503 ? 'We could not reach the payment service. Please try again in a moment.' : 'We could not complete the payment request. Please try again, or contact support if it keeps happening.');
    this.name = 'StripeError';
    this.status = type === 'card_error' ? 402 : status >= 500 || status === 401 || status === 403 ? 502 : status === 429 ? 429 : 400;
    Object.assign(this, { type, code, declineCode, requestId, detail: String(detail || '').slice(0, 300), param, stripeStatus: status });
  }
}

// One JSON line, only fields that cannot hold card data, names, e-mail addresses or message text.
export function logStripe(level, event, meta = {}) {
  const safe = {};
  for (const k of ['rid', 'method', 'path', 'status', 'type', 'code', 'declineCode', 'requestId', 'eventId', 'eventType', 'livemode', 'attempt', 'reason']) if (meta[k] !== undefined) safe[k] = meta[k];
  (console[level] || console.log)(JSON.stringify({ at: new Date().toISOString(), src: 'stripe', event, ...safe }));
}

// A key for a create request. The same inputs give the same key, so a retry or a double click
// within the window (default one minute) is one request; Stripe keeps keys for 24 hours and refuses
// the same key with different parameters, which is why every parameter that matters is in the hash.
export const idemKey = (...parts) => 'qp-' + crypto.createHash('sha256').update(parts.map(String).join('|')).digest('hex').slice(0, 40);
export const idemWindow = (ms = 60e3) => Math.floor(Date.now() / ms);

// Stripe live mode (Admin → Prices, "Stripe live"): off by default, so a live key is refused until the
// owner switches it on; test keys always work.
export const stripeLiveOn = () => siteGet('stripeLive', false) === true;
export function assertKeyAllowed(key = process.env.STRIPE_SECRET_KEY || '') {
  if (keyMode(key) === 'live' && (process.env.NODE_ENV !== 'production' || process.env.STRIPE_TEST_ONLY === '1')) {
    logStripe('error', 'live_key_refused', { reason: process.env.STRIPE_TEST_ONLY === '1' ? 'STRIPE_TEST_ONLY' : 'not production' });
    throw Object.assign(new Error('Payments are not available right now.'), { status: 503, detail: 'A live Stripe key is set where only test keys are allowed (NODE_ENV is not production, or STRIPE_TEST_ONLY=1). Use an sk_test_ key.' });
  }
  if (keyMode(key) === 'live' && !stripeLiveOn()) {
    logStripe('warn', 'live_key_refused', { reason: 'Stripe live is off in Admin' });
    throw Object.assign(new Error('Payments are not available right now.'), { status: 503, detail: 'A live Stripe key is set, but Stripe live is off in Admin → Prices. Switch it on there when you are ready to charge real money.' });
  }
}

const RETRY = new Set([408, 409, 429, 500, 502, 503, 504]);
// method GET or POST; params a flat object (Stripe's bracket names, e.g. 'metadata[kind]'). A retry
// (network error, 429 or 5xx, once) is only made when it is safe: a GET, or a POST with an idempotency key.
export async function stripeRequest(method, path, params = {}, { idempotencyKey, version, timeoutMs = 20000 } = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw Object.assign(new Error('Payments are not set up yet.'), { status: 503, detail: 'STRIPE_SECRET_KEY is not set' });
  assertKeyAllowed(key);
  const get = method === 'GET', qs = get && Object.keys(params).length ? '?' + new URLSearchParams(params) : '';
  const headers = { Authorization: 'Bearer ' + key, 'Stripe-Version': version || stripeVersion() };
  if (!get) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey; }
  const canRetry = get || !!idempotencyKey;
  for (let attempt = 1; ; attempt++) {
    let r, d, requestId;
    try {
      r = await fetch(apiBase() + '/v1' + path + qs, { method, headers, body: get ? undefined : new URLSearchParams(params), signal: AbortSignal.timeout(timeoutMs) });
      requestId = r.headers.get('request-id') || undefined;
      d = await r.json().catch(() => ({}));
    } catch (e) {
      logStripe('warn', 'network_error', { path, reason: e.name, attempt });
      if (canRetry && attempt < 2) continue;
      throw new StripeError({ status: 503, type: 'network', detail: e.name });
    }
    if (r.ok) return d;
    const er = d.error || {};
    logStripe(r.status >= 500 ? 'error' : 'warn', 'api_error', { path, status: r.status, type: er.type, code: er.code, declineCode: er.decline_code, requestId, attempt });
    if (canRetry && attempt < 2 && RETRY.has(r.status)) continue;
    throw new StripeError({ status: r.status, type: er.type, code: er.code, declineCode: er.decline_code, requestId, detail: er.message, param: er.param });
  }
}
export const stripePost = (path, params, opts) => stripeRequest('POST', path, params, opts);
export const stripeGet = (path, params, opts) => stripeRequest('GET', path, params, opts);
