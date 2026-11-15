# Stripe sandbox test plan

Run this in Stripe **test mode** against a local or staging server before any go-live. It has not been
run yet (no test keys in the build environment). Card numbers and CLI commands are the ones Stripe
documents at <https://docs.stripe.com/testing> and <https://docs.stripe.com/stripe-cli>; confirm each on
the page, because Stripe changes its test data from time to time. Where a result depends on a number
that is easy to mistype, the plan says what to expect so a wrong card is noticed.

**Never use a live key.** The server refuses `sk_live_` keys outside production; set
`STRIPE_TEST_ONLY=1` as well on any shared sandbox.

## 0. Setup

1. In the Stripe dashboard switch to **Test mode**. Copy the secret key (`sk_test_…`).
2. `cp .env.example .env`, then set `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_TEST_ONLY=1`,
   `PUBLIC_URL=https://<your tunnel>` (Checkout and the webhook need https; see the tunnel steps in
   `docs/COMMS_SETUP.md`, or use `stripe listen` below for the webhook only), and run `npm start`
   (port 3000 unless `PORT` is set).
3. Sign in as the owner. Admin → Money & fees → Stripe → **Finish setup**. Expected: the report says it
   created the plan prices, the webhook and the portal; the card shows "Test mode", the webhook with
   all 13 events and no "missing events".
4. For local webhooks without a public address: `stripe login`, then
   `stripe listen --forward-to localhost:3000/webhooks/stripe`. The command prints
   `whsec_…`: put it in `STRIPE_WEBHOOK_SECRET` and restart the server.
5. Create two users: `buyer@example.com` (free plan) and the owner. Keep Admin open in another tab.

How to read results: **Stripe** = what the Stripe dashboard (Test mode → Payments, Customers, Events)
shows. **App** = Funding page, Admin → Money & fees, and the database:
`sqlite3 data/quantpocket.db "select id,kind,amount,status,ref,memo,livemode from ledger order by id desc limit 5;"`
and `"select id,type,status from stripe_events order by received_at desc limit 5;"` (use `DB_FILE` if set).
Every event must end as `done` in `stripe_events`; `failed` means Stripe will retry it.

## 1. Payments

| # | Test | Steps | Expected |
|---|---|---|---|
| 1.1 | Successful subscription | As `buyer`, Funding → choose Pro → Checkout. Card `4242 4242 4242 4242`, any future expiry, any 3-digit CVC, any ZIP. | Stripe: subscription active (or trialing, if a trial applies). App: plan shows Pro; for a paid first period, a `subscription` ledger row with status `paid` and `livemode` 0; events `checkout.session.completed`, `invoice.paid`, `customer.subscription.created` are `done`. The redirect page alone changes nothing: confirm by stopping `stripe listen` first, paying, and seeing the plan stay Free until the event arrives. |
| 1.2 | Generic decline | New checkout, card `4000 0000 0000 0002`. | Checkout shows Stripe's decline message and lets you retry; nothing changes in the app. |
| 1.3 | Insufficient funds | Card `4000 0000 0000 9995`. | Same; in a **deposit** test (1.8) the ledger memo gains "last attempt declined: Your card has insufficient funds. Please try another card." and the status stays `pending`. |
| 1.4 | Incorrect CVC | Card `4000 0000 0000 0127`. | Decline for the security code; deposit memo says "The security code (CVC) doesn't match…". |
| 1.5 | Expired card | Card `4000 0000 0000 0069`. | Decline for expiry; memo says "Your card has expired…". |
| 1.6 | 3-D Secure required, passed | Card `4000 0025 0000 3155`. In the test authentication window choose **Complete**. | Payment succeeds exactly like 1.1. |
| 1.7 | 3-D Secure required, failed | Same card; choose **Fail**. | Checkout shows an authentication error and lets you retry; nothing changes in the app. A deposit memo says "We couldn't verify the payment with your bank…". |
| 1.8 | Debit-card deposit | Live account view (or a test user with a live account): Funding → Deposit $25 → card `4242 4242 4242 4242`. | `4242…` is a **credit** card in Stripe's data, so the server **refunds it automatically**: ledger status `refunded`, memo "Only debit cards or bank transfers are accepted", Stripe shows the refund. To test acceptance use Stripe's debit test card (see the testing page, "debit" under cards by brand): status `received`. |
| 1.9 | Credit pack | Funding → buy a credit pack with `4242…`. | Credits added once; Stripe shows one payment. Resend the event (3.3): credits do not change. |
| 1.10 | Double click | Click "Choose Pro" twice quickly. | Both clicks open the same Checkout session (same URL) and Stripe shows one session (idempotency key). |

## 2. Refunds, disputes

| # | Test | Steps | Expected |
|---|---|---|---|
| 2.1 | Full refund | Stripe → the deposit or subscription payment → Refund → full. | Event `charge.refunded` is `done`; the ledger row becomes `refunded` (a deposit's fee row too); audit log has `stripe_refund`. |
| 2.2 | Partial refund | Refund $5 of a $25 deposit. | Row status unchanged; memo ends "partly refunded $5.00"; audit log has `stripe_partial_refund`. |
| 2.3 | Dispute | Pay with the dispute test card listed on the testing page ("Disputes", fraudulent), or `stripe trigger charge.dispute.created`. | Ledger row (found by payment intent, or by invoice through the charge) becomes `disputed`; audit log `stripe_dispute`; each admin address gets the "A payment was disputed" e-mail with the due date (logged as `[email disabled]` when no e-mail key is set). No money moves, no account is locked (decision D4). `stripe trigger` data has no matching ledger row: the event is `done`, and the alert says "No matching ledger row". |

## 3. Webhooks

| # | Test | Steps | Expected |
|---|---|---|---|
| 3.1 | Delivery | With `stripe listen` running: `stripe trigger payment_intent.succeeded`, `payment_intent.payment_failed`, `invoice.payment_failed`, `checkout.session.completed`. | Each shows `[200]` in the CLI; `stripe_events` has each id as `done`; Admin → Money & fees → Stripe shows the last event. |
| 3.2 | Bad signature | `curl -i -X POST localhost:3000/webhooks/stripe -H 'stripe-signature: t=1,v1=00' -d '{}'` | `400 bad signature`. |
| 3.3 | Duplicate | `stripe events resend <evt_id>` for an event already `done` (add `--webhook-endpoint=<we_id>` for a dashboard endpoint). | Response `{"received":true,"duplicate":true}`; no second ledger row, no second credit. |
| 3.4 | Out of order | In test mode, cancel a subscription immediately (Dashboard → Customers → Subscription → Cancel). Then resend an earlier `customer.subscription.updated` for it. | The resend returns `{"ignored":"stale"}`; the user stays on Free / `canceled`. |
| 3.5 | Failed processing is retried | Stop the database or make a handler throw (for example rename the `ledger` table in a scratch copy). Send an event. | HTTP 500; `stripe_events.status` = `failed`; Stripe retries; after fixing, the retry is processed once. |
| 3.6 | Wrong account mode | With a test key, deliver an event whose `livemode` is true (replay a captured live payload only in a scratch environment). | `{"ignored":"mode"}`; nothing changes. |

## 4. Subscriptions (Billing test clocks)

Test clocks: <https://docs.stripe.com/billing/testing/test-clocks>. Checkout creates its own customer, which cannot
be attached to a clock, so create these in the dashboard and link them to a test user:

1. Dashboard → Billing → Test clocks → New. Create a customer on that clock, add card `4242…` (payment
   method `pm_card_visa`), create a subscription to the same **Pro monthly** price id as `STRIPE_PRICE_PRO`.
2. `update users set stripe_customer = '<cus_…>', plan='pro', plan_status='active' where email='buyer@example.com';`

| # | Test | Steps | Expected |
|---|---|---|---|
| 4.1 | Renewal | Advance the clock by one month plus a day. | `invoice.paid` (reason `subscription_cycle`) → ledger `subscription` row "…renewal", `plan_renews` moves forward, plan stays Pro. |
| 4.2 | Failed renewal | Replace the payment method with the always-declining test method (the testing page lists one for "charge customer fails"), advance the clock. | `invoice.payment_failed` → `plan_status` = `past_due`, the customer gets the "We could not charge your card" e-mail (logged when e-mail is off), audit `plan_payment_failed`; plan name unchanged. Stripe retries per its Smart Retries settings. |
| 4.3 | Recovery | Put a good card on the customer, pay the open invoice. | `invoice.paid` → `active` again. Resend the old `invoice.payment_failed`: ignored as stale, still `active`. |
| 4.4 | Cancel | Customer portal (Funding → Manage billing) → cancel at period end; then advance the clock past the period end. | `customer.subscription.updated` (cancel at period end) keeps the plan until the end; `customer.subscription.deleted` → Free / `canceled`. |

## 5. Invalid and duplicate requests

| # | Test | Steps | Expected |
|---|---|---|---|
| 5.1 | Unknown plan | `POST /api/billing/checkout {"plan":"nope"}` signed in. | 400 "Pick a paid plan". |
| 5.2 | Price tampering | `POST /api/billing/checkout` with `{"plan":"pro","price":1}`; deposit with `{"amount":0.01}`. | The extra field is ignored (price comes from the server); the deposit is refused ("Deposits are $10 - $10,000"). |
| 5.3 | Missing price id | Unset `STRIPE_PRICE_PRO`, start checkout. | 503 with "Paid plans are almost ready…"; no Stripe request. |
| 5.4 | Stripe error text | Set `STRIPE_PRICE_PRO=price_doesnotexist`, start checkout. | The customer sees "We could not complete the payment request…" and not "No such price"; the log has one JSON line `request_failed` with `rid`, Stripe's `requestId` and code. |
| 5.5 | Live key refused | Set `STRIPE_SECRET_KEY=sk_live_x` (any text) and start checkout, with `NODE_ENV` not `production`. | 503 "Payments are not available right now."; log line `live_key_refused`; no request reaches Stripe. |

## 6. Mobile and wallets

Checkout is Stripe-hosted. On an iPhone (Safari) and an Android phone (Chrome): open the site, pay with a
test card. If Apple Pay, Google Pay or Link is turned on in Stripe → Settings → Payment methods (and the
domain is verified for Apple Pay), confirm each opens and completes with a test card from the wallet.
Expected: the Checkout page is usable at phone width, returns to `/app#/funding?ok=1`, and the plan
updates within seconds through the webhook. The content-security policy already allows form posts to
`checkout.stripe.com`.

## 7. Admin checks

| # | Check | Expected |
|---|---|---|
| 7.1 | Order, customer and payment status after each test above | Admin → Users shows the plan and status; Funding's history shows each ledger row with its status (`pending`, `received`, `refunded`, `failed`, `disputed`). |
| 7.2 | Refunds and cancellations made in Stripe | Sync through `charge.refunded` and `customer.subscription.deleted` (tests 2.1, 2.2, 4.4). |
| 7.3 | Refunds made in the admin | **There is no refund or cancel button in the admin** (decision D2): refund in the Stripe dashboard. |
| 7.4 | Test data excluded from reports | After tests 1.1 to 2.3, Admin → Analytics (profit and loss), Admin → Money & fees (deposit fees, revenue last 30 days) show **$0** from test payments: their ledger rows have `livemode` 0. Credit-pack sales are not tagged (D5). |
| 7.5 | Stripe card in Admin | Shows "Test mode", the last event, and no bad-signature warning after the tests. |
