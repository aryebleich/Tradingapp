# Brightolio growth plan

Owner's plan, saved 2026-11-26; since MP-01 it is also Brightolio's revenue strategy (the master plan's revenue section is merged into "Revenue" below). It builds on docs/research/pricing.md (Option C, Hybrid), docs/research/master-plan.md and docs/research/ai-picks-review.md. The work is in the AI_HANDOFF.md queue (Phase A and B rows, plus the measurement row).

## Positioning

Brightolio is the professional software layer on top of the user's own broker. It is **not a broker and not an adviser**. What it offers:
- research;
- paper practice;
- risk rules;
- automation;
- AI help.

Live trading is only ever an explicit, gated opt-in.

## Revenue

This is Brightolio's one revenue strategy: the plan below plus the master plan's revenue section (docs/research/master-plan.md, "How Brightolio could make serious money"). Revenue comes from software, not from commissions or payment for order flow.

### The price ladder (a proposal; the owner sets the real prices in Admin → Prices)

No AI sets or changes prices (DECISIONS.md PR-1). The owner enters each plan and credit price, its currency and its effective date in Admin → Prices, and the app shows only those. The table below is the proposal from MP-3, for the owner to use or change.


| Plan | Monthly | Yearly | What it is for |
| --- | --- | --- | --- |
| Free | $0 | $0 | Acquisition and trust: paper trading, charts, watchlists, research basics, delayed data |
| Pro | $14.99 | $149 | The main conversion tier: real-account automation, scanners every 5 minutes, alerts by text, more AI |
| Elite | $39.99 | $399 | Active traders: options income bots, multi-leg orders, tax-loss harvesting, 4-chart layouts, more AI |
| Ultimate | $89.99 | $899 | Power users: 100 strategies and webhooks, unlimited scanners and agents, the most AI, priority support |
| Institutional | from $499 a month | annual contract | Teams: workspaces, APIs, SSO, reporting (sales-led; no self-serve checkout yet) |
| AI credits | per pack | — | Usage beyond the plan's allowance (packs of 500, 3,000 and 12,000) |

Free is the Starter plan. The names are the app's (Pro, Elite, Ultimate), which members, Stripe and the translations already use; the master plan's Plus, Pro and Elite map to them. The yearly price is about 17% off (ten months for twelve). Both the master plan and the research call these prices a starting point to test. Revisit them every 6 months against TradingView, Robinhood Gold and new AI tools (docs/research/pricing.md).

### Revenue streams

| Stream (master plan) | Model | Status |
| --- | --- | --- |
| Premium subscriptions | Monthly and yearly plans | Built, Stripe test mode |
| AI financial tools | Plan allowances plus credit packs | Built, Stripe test mode |
| Trading automation | Included per tier (limits by plan) | Built |
| Marketplace | 15–30% commission on eligible sales | Later. Paid trade ideas wait for legal sign-off (LEGAL_REVIEW.md L-MP2); indicators and dashboards don't need it |
| Financial data | Premium data packages | Later, only after data licenses (OWN-06) |
| Developer APIs | Usage-based billing | Queue row DEV-01 |
| Trading education | Paid courses | Later (Academy) |
| Creator memberships | Revenue sharing | Waits for legal sign-off (L-MP2) |
| Enterprise software | Annual contracts (Institutional) | Later (Phase 5) |
| White-label platforms | Licensing fees | Later (Phase 5) |
| Brokerage partnerships | Compliant commercial arrangements | Waits for legal sign-off (L-MP4) |

The master plan's revenue calculator is illustrative, not a forecast. It is never shown to members as a promise, and no figure here is a return to anyone.

## Five pillars

1. **The trust layer:**
   - paper trading by default;
   - Reality Check;
   - AI records that include the losses;
   - "Unlock with Pro" shown before the click;
   - honest trial endings;
   - a public /status page.
2. **Automation that can't blow up:**
   - Playbooks;
   - risk limits;
   - step-up confirmation before live;
   - pattern-day-trader awareness;
   - the kill switch.
3. **AI that earns its keep:**
   - credits and caps;
   - several models;
   - picks shown with their methodology and the full loss record, never "guaranteed picks".
4. **Multi-broker depth**, with clear "orders go to your broker" messaging.
5. **Distribution:**
   - SEO and learning content;
   - shareable paper results, with the losses shown;
   - Android;
   - an API for builders.

## Phases

### A (0–3 months): monetize what exists

| Row | Work |
| --- | --- |
| REV-01 | Plans and billing plus AI credits, in Stripe test mode until the owner switches it live |
| REV-02 | "Unlock with Pro" labels everywhere |
| AIP-01 | The AI picks honesty UI: not advice, the track record, the methodology |
| REV-03 | Honest trial-end notices |

### B (3–9 months): retention and daily use

- the dividend scanner;
- onboarding with the language choice and the setup assistant;
- the public status page;
- passkeys and two-factor sign-in, with the admin switch;
- AI usage caps and visibility in Admin (AI-01);
- performance: smaller scripts and a font subset.

### C (9–24 months): scale and higher revenue per user

- Elite depth: several accounts and higher limits;
- the Developer API;
- more brokers;
- distribution at scale.

### Measurement, shown in Admin

- free-to-Pro conversion;
- the AI-credit attach rate;
- churn;
- support tickets about surprise charges (the target is zero).

## Never

- Promise returns or sell "signals that print".
- Make live trading the default.
- Hide the cancel button or the trial end.
- Run AI without caps.
- Build broker infrastructure ourselves.
