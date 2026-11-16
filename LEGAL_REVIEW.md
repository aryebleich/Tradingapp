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

Open questions L1, L3, L4, L6 and the bug decisions are recorded in Admin → SEO → Open questions, with status, answer and the source for each. Nothing from them is shown to visitors.
