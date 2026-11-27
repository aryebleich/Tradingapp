# Master roadmap

The phases of the master plan (docs/research/master-plan.md, "Recommended development roadmap") and where each one stands. Feature-level status is in docs/FEATURE_REGISTRY.md; the work itself is in the AI_HANDOFF.md queue, whose rows link to registry IDs. Updated 2026-11-26 (MP-01).

**The rule from the plan:** don't build everything at once. Win first on five capabilities:
1. AI financial intelligence;
2. stock and options scanners;
3. professional charting;
4. strategy development and backtesting;
5. universal portfolio management.

Brightolio stays a software company on top of the member's own broker. It is not a broker or an adviser (Phase 6 is the owner's decision).

## How the documents fit

| The plan's document | In this repository |
| --- | --- |
| MASTER_ROADMAP.md | this file |
| FEATURE_REGISTRY.md | docs/FEATURE_REGISTRY.md |
| SYSTEM_ARCHITECTURE.md | docs/SYSTEM_ARCHITECTURE.md |
| REVENUE_STRATEGY.md | docs/research/growth-plan.md, section "Revenue" (one revenue strategy, no copy) |
| SECURITY_REQUIREMENTS.md | docs/SECURITY_REQUIREMENTS.md |
| AI_HANDOFF.md | AI_HANDOFF.md (root), the shared board |
| DEVELOPMENT_RULES.md | AGENTS.md (root) |
| CURRENT_STATUS.md | ai/status.json, generated from AI_HANDOFF.md |

## Phases

| Phase | Scope | Status | Biggest gaps (registry) |
| --- | --- | --- | --- |
| 1. Foundation | Authentication, market data, database, dashboard, charting, watchlists, paper trading, security | **Mostly done.** Auth with 2FA and passkeys, the database with backups, the dashboard, watchlists, paper trading and security are in place. | Real-time data for paying users needs a license (T-01). Charting depth: indicators (T-03), drawings saved to the account (T-04), synchronized charts (T-05). Hotkeys (T-16), time and sales (T-08), push notifications (AL-12), the installable app on iPhone, Windows and Mac (AP-02..04) |
| 2. Revenue | Subscriptions, scanners, alerts, AI research, trade journal, portfolio analytics | **In progress.** Plans, credits and Stripe checkout work in test mode with one price ladder (DECISIONS.md MP-3). AI research and portfolio analytics are done. | Scanner presets: premarket, after hours, volume, breakout, dividends (S-02..S-05, S-13). Insider and congressional trades (I-03, I-04, S-11). News alerts (AL-05, N-13). Journal: time of day, psychology, mistakes (J-04, J-06, J-08). AI answers always with confidence (A-19) |
| 3. Professional trading | Brokerage integrations, options analytics, backtesting, strategy builder, risk management | **Mostly done.** Five brokers, the options desk and lab, backtesting with walk-forward, Playbooks and the kill switch are in place. | IV rank (O-04), expiration analytics (O-07), gamma exposure (O-08), market replay (T-17, AT-05) |
| 4. Ecosystem | Social, marketplace, developer APIs, education, mobile apps | **Partly there.** Profiles, verified results, free strategy sharing, the developer API, the Android app and the learning center exist. | Paid marketplace and creator memberships wait for legal sign-off (L-MP2). API metering and paid API plans (D-07, D-08, DEV-01). Structured courses (AC-01..AC-07). Paper competitions (SO-12) |
| 5. Institutional | Enterprise software, hedge fund tools, white label, international markets | **Later.** Pieces exist (consolidation, smart routing, the order queue, the audit log). | Teams and roles (E-04, E-13), SSO (E-17), firm-wide risk (E-09), white label (E-14), non-US companies (F-14, licensed) |
| 6. Financial infrastructure | Regulated brokerage, institutional execution | **Not started; the owner's decision.** | Registration and regulatory reporting (SEC-15, L-MP3) |

## Order of work

The AI_HANDOFF.md queue follows this order:
1. Phase 1 gaps.
2. Phase 2.
3. Phase 3.
4. Later phases, as "later" rows (state `ready`, low priority).

Within a phase, the five capabilities above come first, then the best value for the effort (V/E in the registry). The queue keeps about 20 ready rows. Legal rows (flag `legal`) and licensed data (flag `licensed`) are not queued for building until the owner signs off (OWN-04) or arranges the license (OWN-06).

## The queue now (2026-11-27)

| Phase | Rows (AI_HANDOFF.md) |
| --- | --- |
| 1. Foundation | APP-02 installable app with push and offline watchlists, AI-04 sources and confidence on every AI answer, DATA-01 delayed labels, CHART-01 synchronized charts and saved drawings, HOTKEY-01 trading hotkeys |
| 2. Revenue | SCAN-01 premarket and after-hours scanners, SCAN-02 scanner presets, FEAT-02 insider Form 4 tracker, FEAT-03 congressional trades, FEAT-01 dividend scanner, ALERT-01 news and volume alerts, JRN-01 journal by hour and notes, FUND-01 DCF and health scores, MEAS-01 measurement; plus the Phase A rows (AIP-01, REV-03, REV-02B) |
| Research (Grok) | RES-04 market-realism review of the price ladder, RES-05 data licensing scan |
| Later (state `later`) | OPT-01, TAPE-01, REPLAY-01, SOC-01, ACAD-01, ENT-01, MKT-01, NATIVE-01, DEV-01 and older internal rows |

## Apps (section 18)

The installable web app (PWA) comes first, because one build works on iPhone, Windows and Mac (DECISIONS.md MP-6). It brings push notifications and offline watchlists. A native iPhone app and a desktop wrapper are later rows.
