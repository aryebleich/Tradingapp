# Brightolio growth plan

Owner's plan, saved 2026-11-26. It builds on docs/research/pricing.md (Option C, Hybrid) and docs/research/ai-picks-review.md. The work is in the AI_HANDOFF.md queue (Phase A and B rows, plus the measurement row).

## Positioning

Brightolio is the professional software layer on top of the user's own broker. It is **not a broker and not an adviser**. What it offers:
- research;
- paper practice;
- risk rules;
- automation;
- AI help.

Live trading is only ever an explicit, gated opt-in.

## Revenue: from software, not from commissions or payment for order flow

| Plan | Price (about) | What it is for |
| --- | --- | --- |
| Starter | $0 | Acquisition and trust: research, paper trading, the basics |
| Pro | $12–15 / month | The main conversion tier: automation, more AI, scanners |
| Elite | $39–49 / month | Power users: several accounts, real automation, higher limits |
| AI credits | per pack | Usage beyond the plan's quota |
| Developer API | later | Builders and integrations |
| Yearly | about 15–20% off | A discount for paying yearly |

This is the Hybrid option (Option C) in docs/research/pricing.md. We compete on automation, honesty and the AI workflow, not on being a "free platform".

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
