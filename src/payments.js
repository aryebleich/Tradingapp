// Deposits with the cheapest ways to take money, plus the owner's service fee.
//
//   stripe_ach   bank transfer through Stripe: 0.8%, capped at $5        (STRIPE_SECRET_KEY)
//   helcim       cards at interchange-plus pricing: debit cards cost a fraction of a flat 2.9%,
//                because US debit interchange is capped by law            (HELCIM_API_TOKEN)
//   square       card through Square's hosted checkout: 2.9% + 30¢         (SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID)
//   authorizenet card through Authorize.net's hosted page: 2.9% + 30¢,
//                plus its $25 monthly gateway fee                         (ANET_LOGIN_ID, ANET_TRANSACTION_KEY)
//   stripe_card  debit card through Stripe: 2.9% + 30¢                    (STRIPE_SECRET_KEY)
//
// Every card option costs under 3.5%. Square and Authorize.net confirm payments by signed webhooks
// (SQUARE_WEBHOOK_SIGNATURE_KEY, ANET_SIGNATURE_KEY); a deposit counts only after that.
//
// The owner's fee (DEPOSIT_FEE_PERCENT, DEPOSIT_FEE_FIXED) is shown before paying and added on top,
// so the user's account is credited the full amount they chose.
import crypto from 'node:crypto';

const env = k => process.env[k];
export const PROVIDERS = {
  stripe_ach: { id: 'stripe_ach', name: 'Bank account (ACH)', via: 'Stripe', cost: '0.8%, at most $5', note: 'Lowest cost. Takes 3-5 business days to clear.', enabled: () => !!env('STRIPE_SECRET_KEY') && env('STRIPE_ACH') !== 'off', costOf: a => Math.min(5, a * 0.008) },
  helcim: { id: 'helcim', name: 'Debit card', via: 'Helcim', cost: 'interchange + 0.5% + 25¢', note: 'Low-cost card processing at the real network cost.', enabled: () => !!env('HELCIM_API_TOKEN'), costOf: a => a * 0.0005 + 0.22 + a * 0.005 + 0.25 },
  square: { id: 'square', name: 'Debit card', via: 'Square', cost: '2.9% + 30¢', note: 'Secure checkout page by Square.', enabled: () => !!(env('SQUARE_ACCESS_TOKEN') && env('SQUARE_LOCATION_ID') && env('SQUARE_WEBHOOK_SIGNATURE_KEY')), costOf: a => a * 0.029 + 0.3 },
  authorizenet: { id: 'authorizenet', name: 'Debit card', via: 'Authorize.net', cost: '2.9% + 30¢', note: 'Secure payment page by Authorize.net.', enabled: () => !!(env('ANET_LOGIN_ID') && env('ANET_TRANSACTION_KEY') && env('ANET_SIGNATURE_KEY')), costOf: a => a * 0.029 + 0.3 },
  stripe_card: { id: 'stripe_card', name: 'Debit card', via: 'Stripe', cost: '2.9% + 30¢', note: 'Instant. Credit cards are refunded automatically.', enabled: () => !!env('STRIPE_SECRET_KEY'), costOf: a => a * 0.029 + 0.3 },
};

// The owner's service fee on a deposit (set in Admin → Business mode).
export { serviceFee, feeTerms } from './revenue.js';

export const methods = () => Object.values(PROVIDERS).filter(p => p.enabled()).map(({ id, name, via, cost, note }) => ({ id, name, via, cost, note }));

// ---------- Stripe (card or bank) ----------
async function stripe(path, params) {
  const r = await fetch((env('STRIPE_API_URL') || 'https://api.stripe.com') + '/v1' + path, {
    method: 'POST', headers: { Authorization: 'Bearer ' + env('STRIPE_SECRET_KEY'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Stripe: ' + (d.error?.message || r.status));
  return d;
}
export function stripeDeposit({ method, amount, fee, email, userId, ledgerId, baseUrl }) {
  const p = {
    mode: 'payment', customer_email: email, client_reference_id: String(userId),
    'payment_method_types[0]': method === 'stripe_ach' ? 'us_bank_account' : 'card',
    'metadata[kind]': 'deposit', 'metadata[ledger_id]': String(ledgerId), 'metadata[method]': method,
    'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][product_data][name]': 'Account deposit',
    'line_items[0][price_data][unit_amount]': String(Math.round(amount * 100)), 'line_items[0][quantity]': '1',
    'payment_intent_data[metadata][ledger_id]': String(ledgerId),
    success_url: `${baseUrl}/app#/funding?ok=1`, cancel_url: `${baseUrl}/app#/funding`,
  };
  if (fee > 0) Object.assign(p, { 'line_items[1][price_data][currency]': 'usd', 'line_items[1][price_data][product_data][name]': 'Service fee', 'line_items[1][price_data][unit_amount]': String(Math.round(fee * 100)), 'line_items[1][quantity]': '1' });
  return stripe('/checkout/sessions', p);
}

// ---------- Helcim (HelcimPay.js) ----------
// The server starts a checkout session; the page opens Helcim's secure payment window with the
// checkoutToken; the result comes back to the server, which checks its hash with the secretToken.
export async function helcimStart({ total, ledgerId }) {
  const r = await fetch((env('HELCIM_API_URL') || 'https://api.helcim.com') + '/v2/helcim-pay/initialize', {
    method: 'POST', headers: { 'api-token': env('HELCIM_API_TOKEN'), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ paymentType: 'purchase', amount: +total.toFixed(2), currency: 'USD', paymentMethod: 'cc', invoiceNumber: `QP-${ledgerId}` }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.checkoutToken) throw new Error('Helcim: ' + (d.errors ? JSON.stringify(d.errors).slice(0, 200) : r.status));
  return d; // { checkoutToken, secretToken }
}
// Helcim signs the transaction data: sha256(JSON of the data + secretToken).
export function helcimValid(data, hash, secretToken) {
  if (!data || !hash || !secretToken) return false;
  const want = crypto.createHash('sha256').update(JSON.stringify(data) + secretToken).digest('hex');
  return want.length === String(hash).length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(hash)));
}

// ---------- Square (Checkout API payment link) ----------
const sandbox = k => /sandbox|test/i.test(env(k) || '');
const squareBase = () => env('SQUARE_API_URL') || (sandbox('SQUARE_ENV') ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com');
export async function squareStart({ total, ledgerId, baseUrl }) {
  const r = await fetch(squareBase() + '/v2/online-checkout/payment-links', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env('SQUARE_ACCESS_TOKEN'), 'Square-Version': '2025-01-23', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotency_key: `qp-deposit-${ledgerId}`,
      quick_pay: { name: 'Account deposit', price_money: { amount: Math.round(total * 100), currency: 'USD' }, location_id: env('SQUARE_LOCATION_ID') },
      checkout_options: { redirect_url: `${baseUrl}/app#/funding?ok=1` }, payment_note: `QP-${ledgerId}`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.payment_link?.url) throw new Error('Square: ' + (d.errors?.[0]?.detail || r.status));
  return { url: d.payment_link.url, orderId: d.payment_link.order_id };
}
// Square signs notificationUrl + raw body with the subscription's signature key (HMAC-SHA256, base64).
export function squareValid(notificationUrl, raw, signature) {
  const key = env('SQUARE_WEBHOOK_SIGNATURE_KEY');
  if (!key || !signature) return false;
  const want = crypto.createHmac('sha256', key).update(notificationUrl + raw).digest('base64');
  return want.length === String(signature).length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(signature)));
}

// ---------- Authorize.net (Accept Hosted payment page) ----------
const anetApi = () => env('ANET_API_URL') || (sandbox('ANET_ENV') ? 'https://apitest.authorize.net/xml/v1/request.api' : 'https://api.authorize.net/xml/v1/request.api');
export const anetPayUrl = () => (sandbox('ANET_ENV') ? 'https://test.authorize.net/payment/payment' : 'https://accept.authorize.net/payment/payment');
export async function anetStart({ total, ledgerId, baseUrl }) {
  const setting = (settingName, v) => ({ settingName, settingValue: JSON.stringify(v) });
  const r = await fetch(anetApi(), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ getHostedPaymentPageRequest: {
      merchantAuthentication: { name: env('ANET_LOGIN_ID'), transactionKey: env('ANET_TRANSACTION_KEY') },
      transactionRequest: { transactionType: 'authCaptureTransaction', amount: total.toFixed(2), order: { invoiceNumber: `QP-${ledgerId}`, description: 'Account deposit' } },
      hostedPaymentSettings: { setting: [
        setting('hostedPaymentReturnOptions', { showReceipt: false, url: `${baseUrl}/app#/funding?ok=1`, urlText: 'Continue', cancelUrl: `${baseUrl}/app#/funding`, cancelUrlText: 'Cancel' }),
        setting('hostedPaymentButtonOptions', { text: 'Pay' }),
        setting('hostedPaymentPaymentOptions', { cardCodeRequired: true, showCreditCard: true, showBankAccount: false }),
      ] },
    } }),
    signal: AbortSignal.timeout(15000),
  });
  // Authorize.net's JSON starts with a byte-order mark.
  const d = JSON.parse((await r.text()).replace(/^﻿/, '') || '{}');
  if (d.messages?.resultCode !== 'Ok' || !d.token) throw new Error('Authorize.net: ' + (d.messages?.message?.[0]?.text || r.status));
  return { token: d.token };
}
// Webhooks carry X-ANET-Signature: sha512=<HMAC-SHA512 of the raw body with the signature key, hex>.
export function anetValid(raw, header) {
  const key = env('ANET_SIGNATURE_KEY'), got = String(header || '').replace(/^sha512=/i, '').toUpperCase();
  if (!key || !got) return false;
  const want = crypto.createHmac('sha512', key).update(raw).digest('hex').toUpperCase();
  return want.length === got.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
}
