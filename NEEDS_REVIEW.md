# Needs review: layout v2

These are items I skipped or left unchanged on purpose, to protect trading, payment and sign-in flows or because they need a decision only you can make. Nothing here blocks the release. Each item is safe as it is.

## Skipped to protect trading and payment flows

| # | Item | Why it was left | Suggested next step |
|---|---|---|---|
| N-1 | **The order ticket, Buy bar, options leg bar and every confirmation dialog** (Review order, Review options order, Confirm transfer, Close ALL positions?, Cancel all open orders?, Exercise option?, Modify order, Remove bank account?, Submit application?) | `layout.js` never touches forms, dialogs, `#tk`, `.ticket` or `#tradeBar`. Only the page spacing around them changes, plus phone target sizes on full-size buttons (44px). Their internal layout and the order of steps are as before. | If you want the ticket itself redesigned, do it as its own change, with the e2e order flows as the gate. |
| N-2 | **Tables are not reflowed into cards** (positions, orders, ledger, payroll, option chains) | Reflowing changes the reading order of figures on money pages. They scroll inside a named box instead. The ones already built to stack on phones (`table.stack`) keep stacking. | Decide per table whether a card view is wanted on phones. |
| N-3 | **BUG-005: options orders use the plain browser confirm** (from BUG_REPORT.md) | Order-entry logic; it changes a confirmation step. | Say "fix BUG-005" to have it replaced with the app's review dialog, with tests. |
| N-4 | **Three sign-in screens have no visible `h1`** (Create account, Forgot password, Sign in by phone) | Adding a heading changes copy on authentication screens. Their card title acts as the heading visually. | Approve one heading per screen (for example the existing card title, promoted to `h1`). |
| N-5 | **Retirement page scrolls sideways at 768 and 1280px** in the old layout | The planner's input grid; its numbers feed projections. See the final report for whether the new layout's table box removes it. | Check the planner on a tablet. |
| N-6 | **Contrast inside the order ticket's Buy/Sell segment and the dark-mode chart** | Not flagged by axe in the runs. The ticket's colours are left exactly as they are. | none |

## Needs a decision or setup

| # | Item | Detail |
|---|---|---|
| N-7 | **No real staging service** | Gate 3 asks for staging. There is one Render web service (production) and no staging in `render.yaml`. I used the merged code in production mode on the test machine, against the Alpaca mock (`test/layout/staging.sh`). A Render staging service with its own database and paper-only keys would make this exact. |
| N-8 | **Client-side error rate is not part of the automatic rollback** | The rollback compares server errors (5xx) and failed order and payment attempts between old and new visitors. The old layout has no browser error reporting, so a browser-side comparison isn't possible without changing the old layout. |
| N-9 | **Support signals are not monitored automatically** | Phase 6 lists "support signals". The support inbox is e-mail and SMS, and there is no ticket metric to compare. Watch Admin → Support during the first hour. |
| N-10 | **Production critical-flow tests** | "Any critical flow test fails in production" means live orders and payments can't be exercised against real accounts. The automatic check fetches the live pages every 5 minutes as a new-layout visitor and checks their disclosures and that the layout is served. The full order flows run only against the mock. |
| N-11 | **Pre-existing contrast failures in dark mode were not measured** | The tests ran in light mode, the default. Dark-mode colours were left unchanged. |
| N-12 | **Lighthouse performance numbers are from a local machine** | Use them to compare old and new on the same machine, not as absolute scores. |
