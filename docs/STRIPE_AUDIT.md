# Stripe audit (Project A)

Branch: `feature/stripe-audit` (not merged, not deployed). Test mode only: no live key was used and no
request was sent to Stripe; the fixes are covered by tests against a local fake of the Stripe API
(`test/stripe-hardening.test.js`, 18 tests). The sandbox run with real test-mode keys is a manual step,
written out in [STRIPE_TEST_PLAN.md](STRIPE_TEST_PLAN.md), and has **not** been run.

What the code uses (found by reading it, see ASSUMPTIONS.md): Stripe Checkout for plan subscriptions
(`mode=subscription`, price ids from env), one-time credit packs and card/bank deposits (`mode=payment`),
the Billing Portal, balance credits for referrals, refunds of non-debit deposits, and one webhook,
`POST /webhooks/stripe`. There is no Stripe SDK: calls are plain HTTPS.

## Issues

| ID | Severity | Location | Issue | Status |
|---|---|---|---|---|
| S-01 | High | `src/notify.js`, `src/payments.js` (the two `stripe()` helpers) | Checkout, portal, refund and credit calls sent no `Stripe-Version`, so they used the account's default API version while the webhook endpoint is pinned to `2024-06-20`. Changing the default in the dashboard could change response shapes under the handler. | **Fixed**: one client, `src/stripe-client.js`, pins every request (`STRIPE_API_VERSION`, default `2024-06-20`). |
| S-02 | High | same | No idempotency key on any create request. A double click or a retry could make two Checkout sessions, two refunds, or two referral credits. | **Fixed**: `Idempotency-Key` on every create. Deposit session = `qp-deposit-<ledger id>`, refund = `qp-refund-<payment intent>`, referral credit = hash of referrer, friend and memo, sessions = hash of user, plan, interval, trial and a 1-minute window. Retried once with the same key on network errors, 429 and 5xx. |
| S-03 | High | `server.js` `/webhooks/stripe` | Duplicates and out-of-order delivery. Only ledger inserts were idempotent. A late `customer.subscription.updated` arriving after `…deleted` put a cancelled customer back on a paid plan. | **Fixed**: each event id is claimed once (`stripe_events`); a failed or abandoned claim is retried; subscription events are ordered per subscription and `deleted` is final; `invoice.paid` / `invoice.payment_failed` are ordered per customer (`stripe_object_state`). |
| S-04 | High | `server.js` | Events not handled: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `invoice.payment_failed`, `checkout.session.expired`. A refund or dispute in Stripe never reached the ledger. | **Fixed** in `src/stripe-events.js` (see D2 to D4 for what is deliberately not automated). The webhook the Admin button creates now subscribes to all of them. An existing webhook is updated the next time the button is pressed. |
| S-05 | Medium | `src/fees.js`, `src/admin-site.js`, `src/analytics.js`, `server.js` revenue figures | Test-mode payments were counted in revenue. The ledger had no mode. | **Fixed** for ledger rows: `ledger.livemode` is set from each event, and revenue queries count only `livemode = 1` or `NULL` (rows from before the column). See D5 for what is not covered. |
| S-06 | Medium | `src/notify.js` | A live key could be used from any environment, including a laptop or CI. | **Fixed**: a `sk_live_` / `rk_live_` key is refused unless `NODE_ENV=production`, and always when `STRIPE_TEST_ONLY=1`. The refusal is logged and customers see "Payments are not available right now." |
| S-07 | Medium | both `stripe()` helpers | Stripe's raw message was shown to customers ("Stripe: No such price: …"). | **Fixed**: `StripeError`. Card errors show plain language mapped from the decline code; every other error shows a generic message; Stripe's text stays in the log and on `err.detail`. Fraud-type declines (stolen, lost, fraudulent, pickup) say only "declined, contact your bank". |
| S-08 | Medium | both helpers | No timeout: a hung Stripe call hung the customer's request. | **Fixed**: 20 s timeout. |
| S-09 | Low | `server.js` | A signed payload that was not JSON, or lacked `data.object`, threw outside the `try`. A failure logged the whole error object. | **Fixed**: 400 for a bad payload; failures log event id, type and error name only. |
| S-10 | Low | `server.js` | No request id on server errors. | **Fixed**: every response carries `X-Request-Id` (a plain id from a proxy is kept); payment errors are logged as one line with that id and Stripe's `Request-Id`, never a body. |
| S-11 | Low | `server.js` | A live event delivered to a test-key server (or the reverse) was processed. | **Fixed**: acknowledged and ignored. |
| S-12 | Medium | `src/stripe-client.js` | The pinned API version, `2024-06-20`, is old. | **Open** (D1). Not changed: moving it needs a test-mode regression run. |
| S-13 | Medium | admin | There is no refund or cancel action in the admin. | **Open** (D2). Refunds and cancellations made in the Stripe dashboard now sync to the ledger and plan. |
| S-14 | Low | `stripe_events` | The claim table would grow without limit. | **Fixed**: done claims older than 30 days are trimmed. |
| S-15 | Info | dependencies | No Stripe SDK, so "SDK is current" does not apply. | **Accepted**: rule 7 (no new dependency unless necessary); a hand-written client with a pinned version works, and the SDK would not remove the need for the fixes above. |

### Checked, no change needed

| Check | Result |
|---|---|
| Test keys only, from environment variables, none in version control | Keys are read from `process.env`. All 238 commits were searched for `sk_`/`rk_`/`whsec_` values: none. `.env` is ignored; `.env.example` holds placeholders only. |
| Secret key used only on the server | Read only by `src/notify.js`, `src/payments.js`, `src/stripesetup.js`, `src/stripe-client.js` and admin setup code. No key, publishable key or Stripe.js in `public/` (hosted Checkout is used). |
| Prices, amounts, currency and product ids set on the server | Plans: price ids from env, plan from the server's list. Credit packs: looked up by id in the server's config. Deposits: the customer chooses the amount, validated server-side ($10 to $10,000); the fee is computed server-side; currency is fixed to `usd`. No price or product id comes from the browser. |
| Signature verification on the raw body | `express.raw` is mounted before the JSON parser; HMAC-SHA256 of `t.body`, timing-safe compare, 5-minute tolerance, several `v1` signatures accepted (secret rotation). Tested: bad, old, altered, wrong secret, unsigned. |
| Fulfilment depends on webhook events, not the redirect | `success_url` only returns to `/app#/funding`; plans, credits and deposits are granted by `checkout.session.*` / `invoice.paid` events. |
| Existing handlers | `checkout.session.completed` (subscription, credits, deposit), `…async_payment_succeeded/failed`, `invoice.paid`, `customer.subscription.created/updated/deleted`: ledger writes are unique on `(kind, ref)` and credit grants on `stripe:<session id>`. |

## Decisions for the owner

| ID | Decision | Why it is open |
|---|---|---|
| D1 | Move the pinned API version forward. | Needs a test-mode run of the test plan on the new version. The code already reads `current_period_end` from the subscription or its first item. Changelog: <https://docs.stripe.com/changelog>. |
| D2 | Add a refund or cancel button to the admin. | It would be new money-moving code. A deposit that was already received and sent on to the broker also needs to be unwound on the broker side. |
| D3 | A refunded credit pack: take the credits back? | Today `charge.refunded` marks the ledger and logs it; credits are kept. |
| D4 | A dispute: lock withdrawals or the account? | Today a dispute marks the ledger row `disputed`, writes the audit log and e-mails the admins with the due date. Nothing else changes (rule: funds movement is not touched). |
| D5 | Test and live data in one database. | `credit_ledger` purchases are not tagged by mode. The reliable fix is a separate database for test and live. |

## Go-live checklist

| # | Check | Result |
|---|---|---|
| 1 | Only `sk_test_` keys used for every test run | Pass (guard + tests) |
| 2 | No secrets in the repository or its history | Pass |
| 3 | Secret key server-side only | Pass |
| 4 | API version pinned on every request and on the webhook endpoint | Pass (version itself: D1) |
| 5 | Amounts, prices and currency decided on the server | Pass |
| 6 | Idempotency keys on every create | Pass |
| 7 | Webhook signature verified on the raw body | Pass |
| 8 | Duplicate, late and out-of-order events handled | Pass (tests) |
| 9 | The six required events plus `invoice.paid` and `customer.subscription.deleted` handled | Pass (tests) |
| 10 | Fulfilment from webhooks only | Pass |
| 11 | Customer-friendly card errors; no Stripe text or card data in logs | Pass (tests) |
| 12 | Test data excluded from revenue reports | Pass for the ledger (D5) |
| 13 | Full sandbox run of [STRIPE_TEST_PLAN.md](STRIPE_TEST_PLAN.md) in Stripe test mode | **Not run** |
| 14 | Webhook endpoint shows all events in Admin → Money & fees → Stripe, "ready" | **Not run** |
| 15 | Decisions D1 to D5 made | Open |
| 16 | Someone owns dispute replies (the alert e-mail names the due date) | Open |
| 17 | In production: live keys set only in the host's environment (or Admin → Keys), a live-mode webhook with its own secret, `NODE_ENV=production`, `STRIPE_TEST_ONLY` empty | Open |
| 18 | Terms, refund policy and receipts reviewed by legal (US; UK/EU rules differ) | Open |

## Tests added (`test/stripe-hardening.test.js`)

Client: version pin and idempotency keys (S-01, S-02); live key refused (S-06); error text, decline
mapping, request id (S-07); retry rules (S-08); log contents. Webhook: signatures (S-09); duplicates
and claims (S-03, S-14); ordering (S-03); `invoice.payment_failed`, declined attempts, expired
sessions, refunds, disputes (S-04); mode mismatch (S-11); revenue reports (S-05); request ids (S-10).

## References

Checked against Stripe's documentation from memory only. Fetching docs.stripe.com from this session
failed (see ASSUMPTIONS.md, A-3), so each point below should be confirmed on the page before go-live.

- API versioning and the `Stripe-Version` header: <https://docs.stripe.com/api/versioning>
- Idempotent requests (`Idempotency-Key`, 24-hour keys): <https://docs.stripe.com/api/idempotent_requests>
- Webhooks: signatures, retries, duplicate and out-of-order events: <https://docs.stripe.com/webhooks>
- Event types: <https://docs.stripe.com/api/events/types>
- Decline codes and error codes: <https://docs.stripe.com/declines/codes>, <https://docs.stripe.com/error-codes>
- Test cards, test clocks: <https://docs.stripe.com/testing>, <https://docs.stripe.com/billing/testing/test-clocks>
- Disputes: <https://docs.stripe.com/disputes>
