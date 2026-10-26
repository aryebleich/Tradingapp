// Deposits with the cheapest ways to take money, plus the owner's service fee.
//
//   stripe_ach   bank transfer through Stripe: 0.8%, capped at $5        (STRIPE_SECRET_KEY)
//   helcim       cards at interchange-plus pricing: debit cards cost a fraction of a flat 2.9%,
//                because US debit interchange is capped by law            (HELCIM_API_TOKEN)
//   stripe_card  debit card through Stripe: 2.9% + 30¢                    (STRIPE_SECRET_KEY)
//
// The owner's fee (DEPOSIT_FEE_PERCENT, DEPOSIT_FEE_FIXED) is shown before paying and added on top,
// so the user's account is credited the full amount they chose.
import crypto from 'node:crypto';

const env = k => process.env[k];
export const PROVIDERS = {
  stripe_ach: { id: 'stripe_ach', name: 'Bank account (ACH)', via: 'Stripe', cost: '0.8%, at most $5', note: 'Lowest cost. Takes 3-5 business days to clear.', enabled: () => !!env('STRIPE_SECRET_KEY') && env('STRIPE_ACH') !== 'off', costOf: a => Math.min(5, a * 0.008) },
  helcim: { id: 'helcim', name: 'Debit card', via: 'Helcim', cost: 'interchange + 0.5% + 25¢', note: 'Low-cost card processing at the real network cost.', enabled: () => !!env('HELCIM_API_TOKEN'), costOf: a => a * 0.0005 + 0.22 + a * 0.005 + 0.25 },
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
