# Brightolio AI handoff

The shared work board of **Claude**, **Codex (ChatGPT)** and **Grok**. Each assistant picks up exactly where the last one stopped. The rules are in [AGENTS.md](AGENTS.md).

**Read it from anywhere, including a web chat:**
- This board: https://raw.githubusercontent.com/aryebleich/Tradingapp/main/AI_HANDOFF.md
- The same in JSON: https://raw.githubusercontent.com/aryebleich/Tradingapp/main/ai/status.json
- The rules: https://raw.githubusercontent.com/aryebleich/Tradingapp/main/AGENTS.md

**About this file:**
- `ai/status.json` is generated from this file (`npm run ai:status`, and the AI status workflow after every push). Never edit it by hand.
- Both files are public: no secrets, emails, server addresses, account details or private plans. test/ai-status.test.js checks this.
- Keep the queue sorted: active, paused, ready by priority (1 is first), blocked, done this week. Older done rows and hand-offs go to [docs/archive/AI_HANDOFF-history.md](docs/archive/AI_HANDOFF-history.md).

## Assistants

| Assistant | Task | State | Updated (UTC) | Last SHA | Next action | Reset (UTC) |
| --- | --- | --- | --- | --- | --- | --- |
| Claude | — | idle | 2026-11-27 00:31 | 447c3c1 | Codex: AI-04B (the evidence line on picks, signals and the options strategist); Claude: DATA-01 or CHART-01 next. | — |
| Codex | AI-04B | ready | 2026-11-27 10:56 | acaa5f6 | Any assistant: take AI-04B again from ai/task-ai-04b | — |
| Grok | RES-03 | done | 2026-11-26 22:13 | a545db7 | Idle. FEAT-02 and FEAT-03 are ready from the research note. | — |

## Queue

Suggested assistant: Claude for big multi-file changes and careful reviews, Codex for focused coding tasks and tests, Grok for market, news and product research and second opinions. Anyone may take a ready row when the others are idle.

| ID | State | Priority | Suggested | Claimed by | Updated (UTC) | Task and done when |
| --- | --- | --- | --- | --- | --- | --- |
| AI-04B | ready | 2 | Codex | — | 2026-11-27 10:56 | Follow-up of AI-04 (registry A-19): add the evidence line (src/ai-evidence.js evidence(), shown with H.evidenceHtml) to the AI morning picks, AI signals and the options desk's AI strategist and contract explainer. Done when test/ai-evidence.test.js also checks those routes and A-19 is done. See docs/FEATURE_REGISTRY.md. The loop runs so far failed only because GitHub refused to open the pull request (OWN-08). |
| REV-02B | ready | 2 | Codex | — | — | Follow-up of REV-02 (PR #60): label the paid controls on the 10 most-used pages by Admin → Analytics route counts, and add a test that every entry in public/paid-controls.js matches a server check (upgrade() or needPlan()). Done when both are in. |
| DATA-01 | ready | 3 | Codex | — | — | Phase 1, data (registry SEC-16, T-01). Label every delayed or end-of-day figure "Delayed" or "End of day" with its source, from one helper. Done when a test finds no unlabelled delayed quote on the trade, chart, scanner and stock pages. See docs/FEATURE_REGISTRY.md. |
| CHART-01 | ready | 3 | Codex | — | — | Phase 1, charting (registry T-05, T-04). Linked symbol, timeframe and crosshair across the 2- and 4-chart layouts, and drawings saved to the account instead of the device. Done when the e2e chart flow covers both and the rows are updated. See docs/FEATURE_REGISTRY.md. |
| AIP-01 | ready | 3 | Codex | — | — | Phase A. The AI picks honesty UI (docs/research/ai-picks-review.md): on the AI morning picks and AI portfolios, an always-visible not-advice line, a track-record strip that includes losses, and a short methodology note. Done when each page shows all three and a test checks them. |
| HOTKEY-01 | ready | 4 | Codex | — | — | Phase 1, terminal (registry T-16). Configurable trading hotkeys (buy, sell, cancel all, flatten), off by default, paper first, and the usual step-up before any real-money order. Done when unit and e2e tests cover paper and the live step-up. See docs/FEATURE_REGISTRY.md. |
| REV-03 | ready | 4 | Claude | — | — | Phase A. Honest trial-end notices: in-app 3 days and 1 day before a trial ends, with the price and a one-tap cancel; no countdowns. Done when tests cover the timing, the copy and the opt-out, and real email is sent only with the user's comms opt-in. |
| SCAN-01 | ready | 5 | Claude | — | — | Phase 2, scanners (registry S-02, S-03). Premarket and after-hours scanners: gappers and volume from 4:00 New York time and after the close, each figure labelled real time or delayed. Done when both scanners are on #/scanner with tests and the rows are updated. See docs/FEATURE_REGISTRY.md. |
| RES-04 | ready | 5 | Grok | — | — | Market-realism review of the price ladder (DECISIONS.md MP-3: Pro $14.99, Elite $39.99, Ultimate $89.99, Institutional from $499) against TradingView, Robinhood Gold and AI trading tools today. Done when docs/research/pricing-ladder-review.md lists what to keep or change, with dated sources. See docs/FEATURE_REGISTRY.md. |
| CI-01 | ready | 5 | Codex | — | — | Fix the Deep check (its issue-opening step). The clean-check part is done: the ai/ allowlist is on main (dc4d309), the same rule as the prepared branch ai/grok-ci-01-clean-check, which is superseded. Done when the Deep check is green on main. |
| SCAN-02 | ready | 6 | Codex | — | — | Phase 2, scanners (registry S-04, S-05, S-06, S-07). One-tap presets: unusual volume (relative to the 20-day average), breakout (52-week high, range), momentum and penny stocks (with liquidity and risk notes). Done when each preset runs on #/scanner with a test. See docs/FEATURE_REGISTRY.md. |
| ALERT-01 | ready | 7 | Codex | — | — | Phase 2, alerts (registry AL-05, N-13, AL-02). News alerts for watched symbols and a one-tap volume-spike alert, through the existing email and text channels and push once APP-02 lands. Done when tests cover the trigger and the opt-out. See docs/FEATURE_REGISTRY.md. |
| TRUST-02 | ready | 7 | Claude | — | — | Phase B. Passkeys (WebAuthn) as a sign-in option and two-factor sign-in, with the site-wide "Require two-factor sign-in" switch of SEC-01. Done when passkey sign-up and sign-in work in the e2e tests. |
| JRN-01 | ready | 8 | Codex | — | — | Phase 2, trade journal (registry J-08, J-04). Performance by hour and weekday, and a private note, mood and plan per trade. Done when #/insights shows both with tests. See docs/FEATURE_REGISTRY.md. |
| AI-01 | ready | 8 | Claude | — | — | Phase B. AI usage and caps in Admin: spend and tokens per day and month per provider, a monthly cap per provider ($0 default for per-use billing), and calls stop at the cap with a clear reason. Done when the tests with mocks pass. |
| PAGES-01 | ready | 8 | Codex | — | — | The GitHub Pages deploy fails with "No artifacts named github-pages". Done when a Pages run is green. |
| RES-05 | ready | 9 | Grok | — | — | Data licensing scan for OWN-06 (registry flag licensed): what consolidated real-time quotes, Level II, OPRA options and options-flow or dark-pool vendor data cost to show to paying users, and the terms. Done when docs/research/data-licensing.md lists each option with dated sources. See docs/FEATURE_REGISTRY.md. |
| MEAS-01 | ready | 9 | Claude | — | — | Measurement in Admin (docs/research/growth-plan.md): free-to-Pro conversion, the AI-credit attach rate, churn, and support tickets about surprise charges. Done when Admin shows the four numbers from the database, with tests on the math. |
| FUND-01 | ready | 10 | Codex | — | — | Phase 2, fundamentals (registry F-08, F-10, F-07). A DCF with the member's own inputs (defaults from filings, labelled an illustration), and Piotroski and Altman scores from SEC data, explained. Done when the stock page shows them with tests. See docs/FEATURE_REGISTRY.md. |
| FEAT-02 | ready | 10 | Claude | — | 2026-11-26 22:13 | Insider Form 4 tracker (S-11 + I-04), from docs/research/insider-congressional.md: market buys list, cluster filter, per-symbol strip, EDGAR links, lag and not-advice copy, Plus alerts optional. Done when pages and tests are on main and registry rows are updated. |
| FEAT-01 | ready | 11 | Claude | — | — | Phase B. Dividend scanner: about 2,000 symbols, yield, safety, growth and scores, labelled not advice. Done when the scanner page and its tests are on main. |
| FEAT-03 | ready | 11 | Codex | — | 2026-11-26 22:13 | Congressional PTR tracker (I-03), from docs/research/insider-congressional.md: House + Senate table with amount ranges, 45-day lag label, official filing links, not-advice copy. Done when the page and tests are on main and the registry row is updated. |
| ONB-01 | ready | 12 | Claude | — | — | Phase B. Onboarding with the language choice at sign-up and the setup assistant in the chat. Done when the e2e sign-up covers both. |
| OPS-02 | blocked | 30 | Claude | — | — | The Turso recovery window, scheduled from 2026-12-01 00:30 UTC. Done when its report and checks are read and written up. |
| OPT-01 | later | 30 | Codex | — | — | Phase 3, options (registry O-04, O-07). IV rank and percentile from stored IV history, and open interest by strike with max pain per expiration. Done when the options desk shows them with tests. See docs/FEATURE_REGISTRY.md. |
| TAPE-01 | later | 31 | Codex | — | — | Phase 1 extra (registry T-08). Time and sales from the trade stream, with size filters. Done when the trade page shows the tape with a test. See docs/FEATURE_REGISTRY.md. |
| REPLAY-01 | later | 40 | Claude | — | — | Phase 3 (registry T-17, AT-05). Market replay: a past session bar by bar on the chart with paper orders. Done when a replayed session can be traded on paper in the e2e tests. See docs/FEATURE_REGISTRY.md. |
| SOC-01 | later | 41 | Codex | — | — | Phase 4 (registry SO-12). Monthly paper-trading competitions ranked by risk-adjusted return, no money prizes until reviewed. Done when a contest can be joined and ranked in tests. See docs/FEATURE_REGISTRY.md. |
| ACAD-01 | later | 42 | Claude | — | — | Phase 4 (registry AC-01 to AC-07). Structured courses with lessons in order, quizzes and progress, built on the learning center. Done when one full course is live with tests. See docs/FEATURE_REGISTRY.md. |
| ENT-01 | later | 43 | Claude | — | — | Phase 5 (registry E-04, E-13, E-17). Teams: shared workspaces, custom roles and single sign-on for the Institutional plan. Done when a two-person team shares a watchlist in tests. See docs/FEATURE_REGISTRY.md. |
| MKT-01 | later | 44 | Claude | — | — | Phase 4 (registry MK-01, MK-11, MK-12). Paid indicator listings (no trade ideas, so no legal gate) with verified-purchase reviews and creator payouts in Stripe test mode. Done when a listing can be bought in test mode. See docs/FEATURE_REGISTRY.md. |
| NATIVE-01 | later | 45 | Claude | — | — | Later (registry AP-02 to AP-04, DECISIONS.md MP-6). A native iPhone app or a desktop wrapper, only if the installable web app (APP-02) falls short. Done when the reasons and the choice are in DECISIONS.md. See docs/FEATURE_REGISTRY.md. |
| DEV-01 | later | 9 | Codex | — | — | Developer API as a paid tier: usage metering per key, per-plan limits, and an OpenAPI file. Done when limits are enforced in tests and the docs page shows them. |
| APP-01 | later | 13 | Codex | — | — | Phase B (performance). A smaller app.js: Home and settings load as lazy files (PRO_REVIEW #20). Done when the first-load JS is at least 25% smaller and the e2e tests pass. |
| PERF-02 | later | 13 | Codex | — | — | Phase B (performance). A smaller subset of the font (the only performance miss, 334 ms against 300 ms). Done when the subset is served, every supported language still renders, and the sizes are recorded in PERFORMANCE.md. |
| AI-02 | later | 14 | Claude | — | — | AI work queue (AIADMIN-4 and SEVEN-6, built once): ai-queue.yml and an Admin page to list, add, cancel and prioritise queued AI tasks. Done when the Work status buttons use it. |
| AI-03 | later | 15 | Codex | — | — | GitHub Actions in Admin (was AIADMIN-5): recent runs, start the read-only workflows, and status, logs and health tools in the chat. Done when tested with a mocked GitHub API. |
| QA-01 | later | 16 | Codex | — | — | Readability checks everywhere (was SEVEN-7): reading level and jargon on every page's copy, with fixes. Done when a test fails on new hard copy. |
| TICK-01 | later | 19 | Claude | — | — | The tick engine (Part B): a design note in DECISIONS.md first, reviewed by Grok for market realism, then the build. Done when the design is agreed and the first slice is tested. |
| CHAT-04 | later | 20 | Codex | — | — | A live check of the Codex activity stream in Admin → AI chat, with one short test message. Done when the result is written here (no message text in logs). |
| PARTA-1 | later | 21 | Claude | — | — | Part A items A1, A3, A4, A7 and A8 (definitions in DECISIONS.md and CHANGELOG_AI.md). Done when each one is a commit. |
| AI-04 | done | 2 | Claude | Claude | 2026-11-27 00:31 | Phase 1, AI (registry A-19). Every AI answer shows the data and sources it used and a plain confidence line, and never promises profit; one shared helper for chat, stock summaries, picks and tools. Done when a test fails on an AI answer without sources or confidence, and A-19 is done in the registry. See docs/FEATURE_REGISTRY.md. Done in 447c3c1 for chat, stock summaries, Why your P/L moved and AI tools; the rest is AI-04B. |
| APP-02 | done | 1 | Claude | Claude | 2026-11-27 00:31 | Phase 1 (master plan section 18). The installable web app for iPhone, Windows and Mac (registry AP-02, AP-03, AP-04, AL-12, AP-06): an install guide per device, Web Push for alerts (opt-in per alert, keys in Admin → Keys), and watchlists that open offline. A native app or desktop wrapper stays a later row (DECISIONS.md MP-6). Done when push and the offline watchlist are tested and the registry rows are updated. See docs/FEATURE_REGISTRY.md. |
| MP-01 | done | 0 | Claude | Claude | 2026-11-27 00:06 | The master plan (docs/research/master-plan.md): save it, map its documents to what exists (MASTER_ROADMAP, FEATURE_REGISTRY, SYSTEM_ARCHITECTURE, SECURITY_REQUIREMENTS), the feature registry with its coverage test, one price ladder, the legal and data gates, and the queue by the plan's phases. Done when all are on main and the queue holds about 20 ready rows linked to the registry. |
| REV-02 | done | 2 | Codex | Codex | 2026-11-27 00:02 | Phase A. "Unlock with Pro" labels on paid-only controls before they are pressed, from one list of paid features (PR #60, Codex). Done when PR #60 is merged and deployed. Merged as PR #66 (4384872). |
| REV-01 | done | 1 | Claude | Claude | 2026-11-27 00:02 | Phase A. Most of it exists: plans with yearly billing (10× monthly, about 17% off), the comparison table, AI credits (monthly allowance, packs of 500/3,000/12,000, Stripe checkout, Admin → Money). Left: move the plan prices to the Hybrid option (docs/research/pricing.md: Pro about $12–15, Elite about $39–49) in src/fees.js and scripts/home.py (then python3 scripts/pages.py and the pinned prices in the tests), and guard checkout so it refuses while the Stripe price differs from the plan table until the owner re-runs Stripe setup; Stripe stays in test mode. Done when the pages, the plan table and checkout show one price, a test covers the guard, and the page baseline is refreshed for the new figures. Done in MP-01: the price ladder (DECISIONS.md MP-3) and the checkout price guard (04f9fa6). |
| TRUST-01 | done | 6 | Codex | Claude | 2026-11-27 00:02 | Phase B. A public status page (/status): uptime from /healthz history, the last incidents, and data-provider health, without internal details. Done when it is linked in the footer and tested. Already built: src/trust.js and /status (registry SEC-10). |
| RES-03 | done | 10 | Grok | Grok | 2026-11-26 22:13 | Insider and congressional tracker research (S-11, I-04, I-03). Done when docs/research/insider-congressional.md lists sources, competitors, product recommendations and FEAT-02/FEAT-03 done-when rows. |
| QA-02 | done | 0 | Claude | Claude | 2026-11-26 19:37 | The page gate (release-gates.yml: disclosures, figures, controls, accessibility at four widths) fails on main itself against its 2026-11-16 baseline (test/golden/layout-baseline.json), so no branch can merge automatically. A run of 4 pages on main: 22 disclosure, 16 figure and 52 control differences (for example the homepage webhook sentence, and the Orders note on Day orders after the 4 PM close). Review each difference: restore every disclosure that was lost by mistake; then regenerate the baseline (test/layout/run.mjs) for the intended changes only, with the list in DECISIONS.md. Done when the page gate passes on main and on PR #60. |
| TEAM-03 | done | 1 | Claude | Claude | 2026-11-26 18:53 | The Claude → Grok → Codex chain: an unfinished task moves on at a usage limit (paused with the reset time), Grok can code within its cap, Codex through GitHub, the chain waits for the first reset; task pull requests merge themselves when the required checks pass (owner-approved label for workflows, legal, secrets, live billing, live money); the chain in Admin → Work status. Done when the tests for each step pass. |
| SEC-01 | done | 1 | Claude | Claude | 2026-11-26 18:53 | Site-wide "Require two-factor sign-in" in Admin → Security, off by default: scope (admins, live-trading accounts, everyone), a grace period with a "Set up now" banner, passkeys count, step-up and audit for the switch, an admin lock-out check, and recovery codes. Done when the tests for every rule pass. |
| SMOKE-01 | done | 0 | Claude | Claude | 2026-11-26 16:32 | End-to-end test of the AI inbox (the path Grok's results take): a hand-off through the AI hand-off form is checked and committed to the board by ai-inbox.yml. Done when the test issue is closed with the hand-off on the board. |
| TEAM-02 | done | 0 | Claude | Claude | 2026-11-26 16:08 | The loop without paid keys: Codex through its GitHub integration (@codex tasks and reviews, on the ChatGPT plan), Grok through grok.com with its GitHub connection plus an AI hand-off inbox (an issue form, committed by a workflow), and Claude through the subscription token. Done when ai-loop.yml, the inbox workflow, the prompts and the rules work without OPENAI_API_KEY or XAI_API_KEY, and tests cover them. |
| TEAM-01 | done | 0 | Claude | Claude | 2026-11-26 15:41 | Three-assistant loop: rules, board, ai/status.json, prompts, Grok provider, Admin work status, ai-loop.yml. Done when all are on main and npm test passes. |
| RES-02 | done | 17 | Grok | Grok | 2026-11-26 15:37 | A second opinion on the AI morning picks and AI portfolios: are the disclosures, sources and loss records clear and honest? Done when docs/research/ai-picks-review.md lists the findings, for Claude or Codex to fix. |
| RES-01 | done | 6 | Grok | Grok | 2026-11-26 15:33 | Pricing and competitor research: plans and prices of the top retail platforms (public sources, with dates and links). Done when docs/research/pricing.md lists each one and gives 3 pricing options for Brightolio, with their trade-offs. |
| PERF-01 | done | 0 | Codex | Codex | 2026-11-26 14:10 | Stock cards precomputed for the starter symbols and shared across workers (5c80fec). |
| OPS-01 | done | 0 | Claude | Claude | 2026-11-26 13:55 | The Render files are removed after the DNS cutover. |
| PERF-00 | done | 0 | Claude | Claude | 2026-11-25 16:33 | Performance phase 2: CPU pool, shared caches, load test passing (PERFORMANCE.md). |

## Owner only

| ID | What only the owner can do |
| --- | --- |
| OWN-01 | In the Render dashboard, remove the custom domain app.brightolio.com, then suspend the service. |
| OWN-02 | GitHub: delete the secret RENDER_DEPLOY_HOOK_URL, and set the variable APP_URL to https://app.brightolio.com. |
| OWN-03 | Off-site backups: create an Oracle Object Storage pre-authenticated write URL and save it as OCI_BACKUP_PAR_URL in Admin → Keys. Backups are only on the server until then. |
| OWN-04 | Legal sign-off on the open LEGAL_REVIEW.md items, including the regulatory status line in the footer (L6). |
| OWN-05 | To run the loop without paid keys: (1) Claude: run `claude setup-token` and add the repository secret CLAUDE_CODE_OAUTH_TOKEN; (2) Codex: connect Codex (chatgpt.com/codex) to this repo, turn on code review, set the repository variable CODEX_GITHUB=1, and optionally add CODEX_MENTION_TOKEN (your token, Pull requests: write) so @codex comments come from you; (3) Grok: connect GitHub in Grok's settings and paste ai/prompts/grok.md. Per-use keys (XAI_API_KEY, OPENAI_API_KEY) stay optional, behind the $0 caps. |
| OWN-06 | Market data licenses before paying customers see licensed data (registry flag `licensed`, LEGAL_REVIEW.md L-MP): real-time consolidated quotes, Level II, OPRA options, options-flow and dark-pool vendor data, live transcripts and estimates. Until then only free and allowed sources are shown, labelled delayed. |
| OWN-07 | Before billing goes live: approve the price ladder (DECISIONS.md MP-3: Pro $14.99, Elite $39.99, Ultimate $89.99 a month, Institutional from $499), then run Admin → Money & fees → Stripe → Finish setup with the live key. Until then Stripe stays in test mode. |
| OWN-08 | GitHub → Settings → Actions → General → Workflow permissions: tick "Allow GitHub Actions to create and approve pull requests" (or add the secret CODEX_MENTION_TOKEN). Until then every AI-loop task run fails when it opens its pull request (AI-04B failed twice this way). |

## Hand-offs

Newest first. Use these fields every time; the next assistant continues from **Next action**.

### 2026-11-27 10:56 UTC · Codex · AI-04B · ready
- **Last SHA:** acaa5f6
- **Changed:** see the commits
- **Checks:** see the run
- **Blockers:** the run failed (run 45986190634)
- **Next action:** Any assistant: take AI-04B again from ai/task-ai-04b

### 2026-11-27 02:13 UTC · Codex · AI-04B · ready
- **Last SHA:** 6094daa
- **Changed:** see the commits
- **Checks:** see the run
- **Blockers:** the run failed (run 45926986309)
- **Next action:** Any assistant: take AI-04B again from ai/task-ai-04b

### 2026-11-27 00:31 UTC · Claude · APP-02 · done
- **Last SHA:** 447c3c1
- **Changed:** Web Push (src/webpush.js), Settings → Notifications, offline app page and watchlists (public/sw.js), install guide for iPhone, Windows and Mac; also AI-04: the evidence line on AI answers (src/ai-evidence.js); test databases now deleted after each run
- **Checks:** npm test 646 pass; clean check; registry and status checks; page gate on Settings, the Apps page and Plans & billing; the full e2e run was still going at hand-off
- **Blockers:** none for code; owner items OWN-04, OWN-06, OWN-07
- **Next action:** Codex: AI-04B (the evidence line on picks, signals and the options strategist); Claude: DATA-01 or CHART-01 next.

### 2026-11-27 00:06 UTC · Claude · MP-01 · done
- **Last SHA:** 87d4ea8
- **Changed:** docs/research/master-plan.md; docs/MASTER_ROADMAP.md, FEATURE_REGISTRY.md (287 rows, coverage test), SYSTEM_ARCHITECTURE.md, SECURITY_REQUIREMENTS.md; growth-plan.md Revenue; price ladder (Pro 14.99, Elite 39.99, Ultimate 89.99, Institutional from 499) with the checkout price guard; legal gates in Admin → Security (all off); the queue by phases with a later state
- **Checks:** npm test 638 pass; clean check; secrets scan; readme check; registry --check; page gate on the changed pages
- **Blockers:** OWN-04 legal sign-off, OWN-06 data licenses, OWN-07 approve the prices before Stripe goes live
- **Next action:** Claude: APP-02, the installable app with push and offline watchlists (registry AP-02..04, AL-12).

### 2026-11-26 22:13 UTC · Grok · RES-03 · done
- **Last SHA:** a545db7
- **Changed:** docs/research/insider-congressional.md — Form 4 + STOCK Act sources, competitor snapshot (OpenInsider, Capitol Trades, Quiver, Unusual Whales), product recommendations, FEAT-02 and FEAT-03 queue rows. Board updated.
- **Checks:** Research only; public sources (SEC EDGAR, House/Senate PTR paths, competitor pages Oct–Nov 2026). Pushed to main (docs/ only).
- **Blockers:** none
- **Next action:** Claude: finish MP-01 then REV-01. Codex: finish REV-02 (PR #60) and AIP-01. Either may claim FEAT-02 (insider) or FEAT-03 (Congress) from the research note. Owner: merge PR #65 (mobile→desktop) when green.

### 2026-11-26 19:37 UTC · Claude · QA-02 · done
- **Last SHA:** 1ae64f7
- **Changed:** the page gate's baseline after review (DECISIONS.md QA2-1 to QA2-5), the gate stable from day to day, Retirement accessibility, reduced motion on the homepage tabs, live numbers excluded
- **Checks:** the full page gate passes on main (89 pages × 4 widths); npm test; the clean check
- **Blockers:** none
- **Next action:** Claude: REV-01's price step (Hybrid prices and the checkout guard). PR #60 merges itself once its gates pass.

### 2026-11-26 18:53 UTC · Claude · TEAM-03 · done
- **Last SHA:** 17aa6f7
- **Changed:** the chain (scripts/ai-loop.mjs chain/owner/addrow), Grok code mode, ai-loop.yml rewritten, release-gates squash auto-merge with owner-approved paths, Admin chain view, AGENTS.md
- **Checks:** npm test 627 pass; actionlint clean
- **Blockers:** the automatic runs need CLAUDE_CODE_OAUTH_TOKEN, CODEX_GITHUB=1 and a Codex environment (OWN-05)
- **Next action:** Claude: finish QA-02 (baseline verification), then REV-01's price step.

### 2026-11-26 18:53 UTC · Claude · SEC-01 · done
- **Last SHA:** 17aa6f7
- **Changed:** src/mfa-policy.js, Admin → Security, the member banner and set-up redirect, recovery codes; test/mfa-policy.test.js
- **Checks:** npm test 627 pass (3 known TODO); clean check
- **Blockers:** none
- **Next action:** Owner: try Admin → Security (off by default). Claude: TEAM-03 next.

### 2026-11-26 16:32 UTC · Claude · SMOKE-01 · done
- **Last SHA:** 9f8cad0
- **Changed:** nothing in the app; an end-to-end test of the AI hand-off inbox, the path Grok's results take (form, ai-inbox.yml, the board) (from issue #61)
- **Checks:** this issue is the test: the workflow checks it, commits it and closes the issue
- **Blockers:** none
- **Next action:** Grok: paste ai/prompts/grok.md into grok.com and send the result through this form

### 2026-11-26 16:08 UTC · Claude · TEAM-02 · done
- **Last SHA:** 980b657
- **Changed:** ai-loop.yml (Codex through @codex, codex-verdict), ai-inbox.yml with the ai-handoff issue form and scripts/ai-inbox.mjs, prompts and AGENTS.md (Without paid keys), the clean check keeps ai/, tests; REV-02 started for Codex on PR #60
- **Checks:** npm test 610 (3 known TODO); clean check and actionlint pass
- **Blockers:** Codex answers @codex only once it is connected to this repo (OWN-05); the comment on PR #60 was posted from the owner's account
- **Next action:** Codex: REV-02 on PR #60. Claude: review PR #60 when Codex pushes, then take REV-01. Grok: paste ai/prompts/grok.md into grok.com for the next research row.

### 2026-11-26 15:41 UTC · Claude · TEAM-01 · done
- **Last SHA:** cd63970
- **Changed:** AGENTS.md, CLAUDE.md, AI_HANDOFF.md, ai/status.json and ai/prompts/, scripts/ai-status.mjs, ai-loop.mjs and ai-grok.mjs, src/ai-loop.js, Grok in src/llm.js, Admin AI team Work status, ai-loop.yml, ai-status.yml, the review gate in release-gates.yml, tests
- **Checks:** npm test 606 (3 known TODO); actionlint clean
- **Blockers:** none; automatic runs need the owner's keys and caps (OWN-05)
- **Next action:** Claude: take REV-01 (Plans and billing with credits). Codex: take REV-02. Grok: idle; RES-01 and RES-02 are done.

### 2026-11-26 15:37 UTC · Grok · RES-02 · done
- **Last SHA:** 144eb75 (research) / 3b3cf0a (.env.example)
- **Changed:** docs/research/ai-picks-review.md — honesty review of AI morning picks (NOT_ADVICE, loss-inclusive record, paper-first, real-money gates). Recommendations: always-visible not-advice, track-record strip, methodology blurb. Also documented XAI_API_KEY / AI providers in .env.example.
- **Checks:** Research + docs only. Grok provider already present in src/llm.js.
- **Blockers:** none. Owner still needs OWN-05 (XAI_API_KEY + raise Grok monthly cap) for live Grok use.
- **Next action:** Claude: finish TEAM-01, then use RES-01 pricing note for REV-01 and RES-02 findings for any AI-picks UI polish. Codex: take REV-02.

### 2026-11-26 15:33 UTC · Grok · RES-01 · done
- **Last SHA:** 3c8ebaf
- **Changed:** Added docs/research/pricing.md — competitor prices (TradingView, Schwab/thinkorswim, IBKR, eToro, Robinhood Gold) with dates/links + three Brightolio pricing options (Accessible premium, Software ladder, Hybrid recommended) and trade-offs.
- **Checks:** Research only; no code. Public sources only.
- **Blockers:** none.
- **Next action:** Claude: finish TEAM-01, then use the pricing note when implementing REV-01 (plans + AI credits). Codex: take REV-02. Grok next: RES-02 when free.

### 2026-11-26 14:05 UTC · Claude · TEAM-01 · active
- **Last SHA:** 84a43b1
- **Changed:** the three-assistant board (this file), scripts/ai-status.mjs, ai/status.json.
- **Checks:** npm test (to be run before the push).
- **Blockers:** none.
- **Next action:** Claude: finish TEAM-01 (prompts, Grok provider, Admin work status, ai-loop.yml).

### 2026-11-26 13:55 UTC · Claude · OPS-01 · done
- **Last SHA:** a00ae2e
- **Changed:** render.yaml and src/render-redirect.js deleted, with their tests, after dns-cutover.yml confirmed that app.brightolio.com answers straight from the Oracle server (issue #55 closed).
- **Checks:** npm test 590 pass (3 known TODO reviews).
- **Blockers:** none.
- **Next action:** Codex: push PERF-01.

### 2026-11-26 14:10 UTC · Codex · PERF-01 · done
- **Last SHA:** 5c80fec
- **Changed:** stock cards precomputed for four starter symbols and shared across workers (server.js, src/stock.js, src/memo.js, test/stock-routes.test.js). Board updated by Claude from the commit, because the push did not update it.
- **Checks:** npm test passes on main after the rebase (run by Claude).
- **Blockers:** none.
- **Next action:** Codex: take REV-02.

## Checkpoint fields

Use these each time you hand off: UTC time · assistant · task · state in the heading, then Last SHA, Changed, Checks, Blockers and Next action.
