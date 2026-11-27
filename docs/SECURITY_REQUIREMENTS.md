# Security requirements

The master plan's section 19 (docs/research/master-plan.md), mapped to what is in place. Each line points at its registry row (docs/FEATURE_REGISTRY.md, IDs SEC-01 to SEC-18), where the status is kept current. Nothing private here: no addresses, keys or account details.

| Requirement | Registry | In place | Still to do |
| --- | --- | --- | --- |
| Two-factor authentication and passkeys | SEC-01 | TOTP and recovery codes (src/auth.js), passkeys (src/security.js, WebAuthn), the site-wide "Require two-factor sign-in" switch with an admin lock-out check (src/mfa-policy.js), sign-in lockout and rate limits | — |
| Encrypted financial information | SEC-02 | Broker keys and the key store encrypted with AES-256-GCM (src/crypto.js, src/keystore.js); passwords hashed with scrypt; HTTPS only | — |
| Secure brokerage connections | SEC-03 | OAuth for Schwab, tastytrade, Tradier, TradeStation, Alpaca; keys never shown again after saving | — |
| Fraud detection | SEC-04 | Stripe's own checks, sign-in lockout, rate limits, step-up before money moves | Alerts on unusual sign-ins and withdrawals, with a review queue |
| Account activity monitoring | SEC-05 | Sessions and sign-in history, sign out elsewhere (#/security) | — |
| DDoS protection | SEC-06 | Rate limits, load shedding and circuit breakers (src/reliability.js), the optional Cloudflare edge | Switch the edge on for the main address (owner) |
| Automated backups | SEC-07 | Daily copies of the database off the server (src/backup.js) | — |
| Disaster recovery | SEC-08 | A restore path (oracle-migrate.yml, MIGRATION_ORACLE.md) | A restore drill on a schedule, with the result recorded |
| High-availability infrastructure | SEC-09 | One process per CPU core, a leader for background work, post-deploy rollback | A second server and failover |
| Real-time system monitoring | SEC-10 | The public status page (src/trust.js), /healthz, the deep check and live-site workflows | — |
| Market data validation | SEC-11 | Every quote carries its source and age; stale data is flagged (src/desk.js, src/datasources.js) | Cross-checks between two sources with an alert on a bad print |
| Duplicate order prevention | SEC-12 | Idempotency keys on broker calls, the durable order queue claims each order once (src/orderqueue.js), one claim per scheduled run | — |
| Automated security testing | SEC-13 | release-gates.yml: npm audit, the secrets scan, the full test suite on every push; security.yml | — |
| User permission management | SEC-14 | Admin and member roles; owner-only pages refused by the server | Custom roles per team (E-13) |
| Regulatory reporting infrastructure | SEC-15 | Not needed while Brightolio is software only | Only with registration (Phase 6, L-MP3) |
| Market data licensing and access controls | SEC-16 | Data delay by plan (end of day, 15-minute delay, real time) in src/aiplans.js; the data-source table in the registry | "Delayed" on every delayed figure; licenses before paying customers see licensed data (OWN-06) |
| Subscription and billing management | SEC-17 | Plans, yearly billing, credits, Stripe Checkout and the billing portal, webhook safety (src/stripe-events.js), all in test mode | Live billing waits for the owner |
| Customer support administration | SEC-18 | The support inbox and calls, texts and email in Admin | — |

## Rules every change follows

- Real money:
  - paper is the default;
  - real-money orders need step-up confirmation;
  - risk limits and the kill switch apply to every order, manual or automatic.
- Owner switches: the legal gates (LEGAL_REVIEW.md L-MP1 to L-MP4) stay off until the owner signs off. Turning one on asks for the owner's password and is recorded in the audit log.
- Secrets:
  - never printed, logged or committed;
  - checked only by their prefix and length.
- Per-use AI billing has a $0 cap until the owner raises it.
- The repository is public: nothing private goes into it.
