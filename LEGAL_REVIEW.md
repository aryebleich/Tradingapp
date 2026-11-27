# LEGAL_REVIEW.md

> **Update 2026-11-16:** the flag `home_v2` is gone and the audited-order homepage (L9 to L12) was **not** released: the previous homepage stays live and the new version's code was removed (recoverable from git history, commit 1d9efaf).

Items found in the audit that need legal or compliance sign-off. L1 to L8: nothing was changed. L9 to L12: new copy in homepage v2 (flag `home_v2`, off); it must be signed off before the flag is turned on.

| # | Where | Text or issue | Question for Legal |
|---|---|---|---|
| L1 | Homepage hero | "open a commission-free account (we suggest Alpaca)" | Is there a referral or compensation arrangement? If so, it must be disclosed. [PLACEHOLDER: verified relationship] |
| L2 | Homepage hero | Live dashboard with simulated rising figures, caption "Illustrative paper-trading account" | Is the caption enough, or should it say "simulated" next to the numbers? |
| L3 | Reality Check | "a strategy with a 922% a year backtest returned −27% in its first three live months" | Source required, or label it as a hypothetical example. [PLACEHOLDER: source] |
| L4 | S&P 500 section | "averaged roughly 10% a year since 1957 with dividends reinvested"; calculator at 6/8/10% | Cite the source; confirm the calculator's "assumed rates, not a forecast" wording. |
| L5 | Strategies, live demo | Backtest figures shown in cards | Is a "hypothetical" label needed beside each figure (not only in the footer)? |
| L6 | Footer | No regulatory or registration line besides "not a broker-dealer" | Confirm the status statement and any required broker (Alpaca) disclosures. [PLACEHOLDER: verified regulatory status] |
| L7 | Yiddish homepage | Translated disclaimer | Confirm the Yiddish risk text is an accepted equivalent. |
| L8 | Options desk | In-app options risk disclosure and the link to the OCC Options Disclosure Document | Confirm the wording and whether the ODD must be acknowledged before the first options order. |
| L9 | Homepage v2 hero | Main button "Start free with $100,000 in practice money" | Confirm "practice money" is clear that it is not real money and that no deposit is required for practice. |
| L10 | Homepage v2 | "Trading involves risk. Read the risk disclosure →" beside the hero, pricing and final sign-up buttons | Confirm the wording and placement. |
| L11 | Homepage v2, Trust & compliance block | Heading "Risks, and how Brightolio works with your broker", then the existing footer disclosure word for word, and links to Risk disclosure, Terms, Privacy, Security, Insurance and protection | No new claims; confirm the block may repeat the footer disclosure. Regulatory status still per L6. |
| L12 | Yiddish homepage v2 | Hand translations of L9 to L11 | Confirm the Yiddish wording, as in L7. |
| L13 | Homepage, final sign-up box (2026-11-20) | The footer's first sentence, word for word: "Investing involves risk, including possible loss of principal." plus a link to the Risk Disclosure | No new claim; confirm the placement (same idea as L10, using already-approved wording). |
| L14 | App sign-up panel (2026-11-20) | "What you get, free": $100,000 in practice money with real market prices; No card needed for the free plan; Paid plans start with a 14-day free trial; cancel anytime; Two-factor login and passkeys. Then "Brightolio is software, not a broker. Orders go to the brokerage account you choose. Trading involves risk of loss." with links to the Risk Disclosure and Security pages | Facts from the plan data and the Security page; confirm the wording, as for L9. |
| L15 | Upgrade window and Plans & billing (2026-11-20) | "You won't be charged until the trial ends. Cancel anytime from Manage billing." and the plan comparison table (the homepage's existing matrix) | Confirm the trial and cancellation wording matches the Terms and the Stripe settings. |
| L16 | AI morning picks and AI intraday pages (2026-11-22) | Names "AI morning picks", "AI intraday trading", "AI long/short portfolios"; the notes "AI picks are an experiment, not investment advice. They can and do lose money; the record on this page includes every loss." and "Slow and rule-based, not high-frequency trading." | Product pages, not marketing; confirm the names and the not-advice notes before these features are promoted anywhere. |
| L17 | Diversification, dividends and passive pages (2026-11-22) | Suggestions with "why" and a preview (never an order); example fund mixes ("examples to learn from, not advice for your situation"); dividend safety labels "Looks well covered / Watch it / At risk of a cut" | Confirm that example mixes and safety labels read as education, not as personalised advice. |
| L18 | Homepage plan table (2026-11-22) | The app's new "Research and AI" rows and the Free / Pro / Premium labels (src/fees.js GROWTH_COMPARE, TIERS) | Not on the homepage yet. After sign-off, add the rows to scripts/home.py MATRIX and src/fees.js COMPARE together (test/pricing.test.js keeps them equal). |
| L19 | Live ratio pairs and Order flow (OFI) lab (2026-11-22) | "Experimental and educational: this model has not been shown to make money, and it is not investment advice. Do not use it with real money before backtesting it, running it on paper and reviewing the risks." and "Academic exercise. Simulated results; not investment advice. Real high-frequency trading needs exchange co-location and direct market data, which this app doesn't provide." | Confirm the wording, and that an automated real-money pair bot (opt-in, after paper days and step-up) is acceptable under the Terms. |

Open questions L1, L3, L4, L6 and the bug decisions are recorded in Admin → SEO → Open questions, with status, answer and the source for each. Nothing from them is shown to visitors.

## L-MP: master plan items that need legal review (2026-11-26)

The master plan (docs/research/master-plan.md) lists products that can make Brightolio a broker, an adviser or a seller of trade ideas. Each one is marked **needs-legal-review** in docs/FEATURE_REGISTRY.md (flag `legal`) and is built only behind its switch in Admin → Security → Legal gates, **off until the owner signs off (OWN-04)**. Turning a gate on asks for the owner's password and is recorded in the audit log.

| # | Gate | What it covers (registry rows) | Question for Legal |
|---|---|---|---|
| L-MP1 | Copy trading with real money | Following another member's trades automatically in a real account (SO-11; src/fleet.js, src/playbooks.js, src/rotation copies). Paper copies and copies the member approves trade by trade stay available. | Does automatic real-money copying make Brightolio (or the leader) an investment adviser or require broker-dealer registration? Under which arrangement is it allowed? |
| L-MP2 | Paid trade ideas | The paid strategy and bot marketplace and paid creator memberships, research, newsletters and livestreams that give trade ideas (AT-18, MK-02, MK-03, MK-04, MK-08, SO-08, SO-13, SO-14). Free sharing stays available. | Is selling or revenue-sharing on trade ideas, strategies or bots investment advice or a publisher's exclusion? Which disclosures and creator vetting are needed? |
| L-MP3 | Personalized advice and a cut of trades | Personalized investment advice, adviser portals and client management (E-02, E-05), the performance fee on profits (src/fees.js assessFee) and regulatory reporting (SEC-15). | Registration (RIA or broker-dealer) and the disclosures before any personalized advice or transaction-based or performance-based pay. |
| L-MP4 | Brokerage partnerships paid per trade | The commission on orders in brokerage accounts opened through Brightolio (src/revenue.js commission, Alpaca Broker API partner commission) and any per-trade referral pay (see L1). | Is per-trade compensation from a broker allowed for a software company, and how must it be disclosed? |

Market data that needs a license before paying customers see it (registry flag `licensed`, Data sources table): real-time consolidated exchange data beyond the member's own broker feed, Level II depth for stocks, options flow and dark-pool data from paid vendors, live earnings-call transcripts and licensed estimates. Until a license is signed (OWN-06), only free and allowed sources are shown, and delayed data is labelled delayed.
