# ASSUMPTIONS.md

Choices made without asking, with the reason. Project A (Stripe) first; Project B (SMS and voice) is
appended in its own section when that branch is built.

## Project A: Stripe

| # | Assumption | Reason |
|---|---|---|
| A-1 | The framework is **Express 5 on Node 22 with libSQL** (plain SQL, no ORM), not Next.js with Prisma. New code is ES modules in `src/`, schema changes go in `src/db.js` `MIGRATIONS`. | `package.json` and the code say so; the brief says to detect the stack and use the defaults only when the code is unclear. |
| A-2 | The Stripe features audited are the ones the code uses: Checkout (subscriptions, credit packs, deposits), Billing Portal, customer balance credits, refunds, and `POST /webhooks/stripe`. | Found by reading `src/notify.js`, `src/payments.js`, `src/stripesetup.js` and `server.js`. |
| A-3 | **Stripe's documentation could not be read in this session.** `docs.stripe.com` was added to the environment's allowed hosts (with your approval), but the web-fetch tool still could not resolve it, and a command-line download was refused by the sandbox's safety check, which I did not work around. | Everything that depends on a doc page (API version names, header names, retention of idempotency keys, test card numbers, 3-D Secure test flow, event payloads) is written from memory and is listed in `docs/STRIPE_AUDIT.md` → References as "confirm on the page". I did not invent behavior: where I was not sure of a value (the debit and dispute test cards), the test plan points to the testing page instead of quoting a number. |
| A-4 | **No sandbox run against Stripe was possible.** There are no test keys in the build environment and no outbound access to the Stripe API. Fixes are verified against a local fake of the API; `docs/STRIPE_TEST_PLAN.md` is the manual run for test mode. | Rule 1 (test keys only) and rule 2 (no secrets in code); asking for keys in chat is not allowed. |
| A-5 | The pinned API version stays `2024-06-20`, the value already used for the webhook endpoint, now sent on every request and overridable with `STRIPE_API_VERSION`. | Changing the version changes what Stripe sends and returns; that needs a test-mode regression run (decision D1). I did not pick a newer version name I could not check. |
| A-6 | A live key (`sk_live_`, `rk_live_`) is refused when `NODE_ENV` is not `production`, and always when `STRIPE_TEST_ONLY=1`. | Rule 1. The default keeps production working with no new setting; `STRIPE_TEST_ONLY` is empty in `.env.example` so copying the file cannot switch off live payments by surprise. |
| A-7 | A declined card attempt on a deposit is **a note on the ledger row, not a final state**. `payment_intent.payment_failed` keeps the row `pending`; `checkout.session.expired` is what ends it (`failed`). | Checkout lets the customer try another card on the same session; marking the row failed on the first decline would make the later successful payment be ignored. |
| A-8 | Fulfilment stays on `checkout.session.*` and `invoice.paid`. `payment_intent.succeeded` is recorded, not acted on. | One source of truth, so a payment can never be credited twice. |
| A-9 | A dispute only flags the ledger row `disputed`, writes the audit log, and e-mails the admins. A refund made in Stripe updates the ledger. Nothing moves money, locks an account, or takes back credits. | Hard rule: no change to funds movement, balances or auth logic. These policies are decisions D2 to D4 in the audit. |
| A-10 | Idempotency keys for sessions are hashes of user, plan, interval, trial, price and a **one-minute window**. | A double click gives one session; a retry after a minute gets a fresh session. Stripe refuses the same key with different parameters, so every parameter that matters is in the hash. |
| A-11 | Test-mode rows are marked by a new nullable `ledger.livemode` column; `NULL` (older rows, non-Stripe providers) counts as live. | No change to existing rows or the user model, and reports keep their numbers. Credit-pack purchases (`credit_ledger`) are not tagged (D5). |
| A-12 | Work is on branch `feature/stripe-audit`; nothing is merged or deployed. | Hard rule 6. This overrides the earlier standing instruction to push to main. |
| A-13 | No new dependency was added. | Hard rule 7: the Stripe client is plain `fetch`, as before. |
| A-14 | Jurisdiction: US. Receipts, tax and refund-policy wording for UK/EU are listed for legal review in the go-live checklist, not changed. | Brief default. |
