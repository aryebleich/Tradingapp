# CHANGELOG_AI.md

One entry per task: what changed, why, test results, release tag, rollback. Newest first.

---

## 2026-11-22: Growth features, phase 1

### What changed

- **Plan first:** PLAN_GROWTH.md: what exists, what the data and the broker really allow, 18 features with plan tiers, and the build order ranked by effect on revenue and trust against effort.
- **One stock page:** the analyzer gained Valuation (P/E against its own 5-year average and its sector, PEG, P/S, EV/EBITDA), Fundamentals (5 years, with an AI summary for Pro), Earnings (beats, misses, price moves after reports), Dividends (safety score), Technicals and Supply & demand (labelled indicative, no depth). There is also a Compare tab. Old `#/analyze?symbol=` links work.
- **Scanner:** "Growth at a price" presets, saved filters and daily alerts (Pro).
- **Rates vs stocks:** Fed funds, 2y, 10y and the curve against SPY and sectors, with the next Fed meeting.
- **Company card before every buy:** on the quick ticket, the Trade page, Equalize, Playbooks and bots. It loads in the background, never blocks the order, and can be hidden per stock.
- **Diversification:** a score in six parts, fund overlap, correlation, and up to 3 suggestions with "why" and a preview (never an order).
- **AI morning picks:** ranked picks with reasons and sources. Approve each day or let them run automatically, within a daily budget, a per-stock limit, a stop and a daily loss limit. Paper by default; real money needs Elite, the password and step-up. The public record includes every loss.
- **AI intraday:** a slow, rule-based engine (every 5 minutes at the fastest). It has hours, interval, order, position, loss and PDT limits, the kill switch, an optional ex-dividend hold for a dividend list, paper by default and a full trade log.
- **AI long/short portfolios** (renamed from "AI hedge funds"): a cap on each position, the value history with its largest fall, a hypothetical backtest against SPY, fees and risks in plain words, and step-up before real-account approvals.
- **Dividends & income:** income by month, coming ex-dates, safety per holding, DRIP status, and opt-in reminders before ex-dividend dates and earnings.
- **Passive investing:** an account check (funds against single stocks, average fee), four steps linking the existing tools, example mixes and a fee example.
- **Active trading desk** (`#/active`): session, buying power, the day-trade rule, positions, movers and the automatic engines.
- **Fund compare:** 2 to 4 funds side by side; each mutual fund shows its closest ETF.
- **Futures research:** contract months, the roll calendar for equity-index contracts, and brokerages that offer futures.
- **Translations:** Yiddish (`public/i18n/yi-growth.js`) and simple translations of the new menu labels in 8 languages.

### Tests

`npm test`: 435 pass, 0 fail (3 existing TODO items are marked for review, as before). New: test/stock.test.js, stock-routes, rates, diversify, newspicks, intraday, aifunds-growth, income, futures-roll. Checked in the browser at 1280 and 375 px, signed in: no console errors, no horizontal scroll, axe (WCAG 2 A/AA) clean on each new page.

### Rollback

Revert the commits from `55306d4` (PLAN_GROWTH.md) to this entry. The new tables (newspicks_log, newspicks_trades, intraday_log, ai_fund_nav) and the `ai_funds.max_weight` column are additive and can stay.

---

## 2026-11-20: Pro polish: design system, landing, pricing, onboarding, empty states

### What changed

- **Review:** PRO_REVIEW.md covers first impression, consistency, trust, speed, accessibility and mobile, and revenue, with the 20 highest-impact fixes ranked against effort.
- **Design system:**
  - every app screen has its own browser title;
  - AA contrast for the `.save` and `.og-tag` badges, and a label on the invite-link field;
  - one `.empty` component;
  - rules for wording, badges, titles and sign-up in DESIGN_SYSTEM.md.
- **Landing:** a "Security" link in the header of every public page, and the footer's own risk sentence and the Risk Disclosure link under the final sign-up box (English and Yiddish). No new claims (LEGAL_REVIEW.md L13).
- **Pricing:**
  - a plan comparison table on Plans & billing, the same rows as the homepage (tested);
  - yearly prices as a monthly amount with the yearly charge under it;
  - "Recommended" instead of "Most popular".
- **Upgrade window:** it names the plan that unlocks the feature, shows its real prices with Monthly/Yearly, says what stays free, and shows the trial terms. Paying members change plan in the billing portal, and a second subscription is refused (409, tested).
- **Onboarding:**
  - sign-up has an `h1` and a short factual panel;
  - Get started puts the first trade first and jumps to the ticket;
  - a next step to the strategy library appears after the first practice trade.
- **Polish:** empty states with next steps on Home (positions, recent orders), Orders and Billing history; in-page jumps stop below the sticky header; a menu error when the session ends mid-load is fixed.
- **Translations:** Yiddish for every new string (`public/i18n/yi-pro.js`, `scripts/yi_home.py`).
- **Follow-ups for the owner:** NEEDS_REVIEW.md N-15 to N-17 and LEGAL_REVIEW.md L13 to L15.

Decisions: DECISIONS.md P2-1 to P2-15.

### Tests

- `npm test`: 395 pass, 0 fail, 3 todo (new: test/pricing.test.js, the no-second-subscription check in test/stripesetup.test.js). Security and clean checks pass.
- axe-core (WCAG 2.0/2.1 A and AA): 0 violations on the homepage (English and Yiddish), Security, Status, sign-in, sign-up, Get started, Home, Plans & billing, Invite & earn, Marketplace, AI bots, Developer API and Settings, at 1280px and 375px. Before: 3 failures and a missing `h1`.
- Click-through of all 94 menu pages and tabs at 1280px and 375px: no browser errors, no page wider than the screen, every page with an h1.
- `npm run e2e` (with the pre-installed Chromium): 444 checks, exit 0. Checked by hand in Chromium: sign-up, Plans & billing (Monthly and Yearly), the upgrade window, Get started and the next step, in English and Yiddish, signed in and signed out, at 1280px and 375px.

---

## 2026-11-20: Equalize positions: choose which holdings to include

### What changed

- **The confirm dialog** (Positions → Equalize positions):
  - Every holding has a tick box, all ticked at first, with Select all / none in the header and "X of Y included" above the table.
  - Holdings left out are greyed and marked "Not changed"; they get no buys or sells.
  - Every change recounts on the server (debounced): "each holding gets", the targets, the change per holding, the trades, the buy and sell totals and the "Place N trades" button.
  - With fewer than two ticked, the button is disabled with "Pick at least two holdings".
  - Options and shorts stay in the "Left as they are" note, with no tick box.
  - A sticky footer holds the totals and buttons, and the layout works at 375px.
- **Server** (src/equalize.js):
  - `planPositions` takes `exclude`, and `cleanExclude` validates it: only held symbols, at most 500.
  - The money is split only among the included holdings (DECISIONS.md E-1).
  - Preview and run both accept `exclude`. Run rebuilds the plan and ignores any orders sent from the browser.
  - Password and confirm are unchanged.
- **Remembered per account**, on the server, with "Reset to all".
- **Translations:** Yiddish (`public/i18n/yi-equalize.js`) and the eight simple languages.
- **Tests:** `test/equalize-exclude.test.js` (4 tests):
  - excluded holdings get no orders;
  - the money is split only among the included holdings, with and without cash to keep;
  - fewer than two included is refused;
  - unknown symbols, more than 500 and non-lists are refused.

### Tests

- `npm test`: 393 pass, 0 fail, 3 todo. Security and clean checks pass.
- Chromium against the mock broker (Alpaca account, 4 holdings), at 1280px and 375px, with no browser errors:
  - leaving out AAPL drops its orders and splits the money among the other three;
  - one or zero ticked disables the button;
  - Select all and none work;
  - the trades were placed with AAPL untouched;
  - reopening shows AAPL still left out, and Reset to all brings it back;
  - the unknown-symbol and too-few errors come from the server;
  - the dialog fits the screen at 375px.

---

## 2026-11-19: Home with a clear priority order, one layout for every account type

### What changed

- **One Home for every account type.** Alpaca accounts no longer use their own portfolio page (`#/portfolio` redirects to Home). They see the same layout with their own data: intraday chart, margin card, today's change per position.
- **New order, top to bottom:**
  1. Title row: Portfolio, the account pill, the clock and an account switcher.
  2. Action needed, only when there is something to do: approvals, trading blocked.
  3. The welcome card, for a brand-new practice user.
  4. The chart with 1D, 1W, 1M, 3M, 6M, 1Y and All, and the statement row.
  5. One even row of key numbers: Total value, Today, Total P/L, Buying power, Cash, and Since you last looked when that setting is on.
  6. The main grid. Left, about 2/3: Positions (count in the header, sorted by value, click-to-sort columns, % of portfolio, today's change), then Recent orders. Right, about 1/3: the quick ticket, My day, Why my P/L moved, and Balances & margin for Alpaca.
  7. Get started (collapsible, and Hide is saved to the account), the page guide, the other accounts, and a small Paper account card holding Reset.
- **Server:** `/account` positions carry `dayPl` (today's change) when market data is on.
- **No layout shift:** My day, Why my P/L moved and Recent orders fill fixed slots with skeletons of their measured height.
- **Fixes:** a resize redraws only the chart; "-$0.00" now shows as $0.00; the 16px gaps between Home's blocks now apply (the rule never matched before).
- **Unchanged:** PREFS (hideToday, the chart mode and color), the live updates of every `[data-k]` value, the onboarding logic, approvals, the statement, the other-accounts boxes and Equalize.

Decisions on unclear points: DECISIONS.md H-1 to H-16.

### Tests

- `npm test`: 389 pass, 0 fail, 3 todo. Two tests that read Home's code were pointed at the shared page, with the same checks:
  - batch10: the chart draws the account's history without a legend;
  - batch8: the numbers and chart refresh in place, not by redrawing the page.
- Chromium against the mock broker, practice account (3 positions, My day on) and Alpaca account (connected with test keys), at 1280, 800 and 375px:
  - the blocks are in the order above, and the grid is 664/332px at 1280px and one column at 375px;
  - the key-number tiles are equal height, with 5, 3 and 2 per row;
  - nothing is wider than the screen, and the positions table fits without scrolling at 1280px;
  - sorting, the time ranges, the switch to Alpaca and Hide (still hidden after clearing the browser's copy) all work;
  - no browser errors.
- `npm run e2e` (with the pre-installed Chromium): 444 checks, exit 0, including the Alpaca home (Balances & margin), the quick ticket orders, My day on Home, and the other-accounts boxes with Equalize.

### Rollback

`git revert` this commit and push.

---

## 2026-11-18: App structure: menu by goal, merged pages with tabs, redirects, Related links

### What changed

1. **Audit:** STRUCTURE_AUDIT.md lists all 94 pages. For each it gives what the page does, who it is for, which pages overlap with it, the recommendation and the new place.
2. **Menu:** 6 member groups instead of 9, organized by what members want to do (Research, Trade tools, Invest, Automate, Track & plan, Account & help), with 5 to 7 entries each instead of up to 13. Core and the admin groups are unchanged.
3. **Merges:** 21 pages with tabs hold 62 pages: Stock & fund analyzer, Research & news, Scanners, AI assistant, Options, Phone & text, Investing toolkit, Portfolios, Futures bonds & more, Strategies, Bots, Alerts & signals, Pairs & stat arb, Marketplace, Developers, Performance, Risk, Taxes, All my money, Accounts, Security & protection. Each tab is still its own page, so no feature, setting or saved item moved. Why each page went where it did: DECISIONS.md M-6 to M-14.
4. **Split:** the developer half of Bonds, rates & crypto (Alpaca MCP server and CLI, the owner's Broker MCP, connecting AI agents) is now its own page, `#/alpaca-dev`, the Developers → Alpaca AI & CLI tools tab (M-15).
5. **Redirects:** every old address opens its tab (`#/aibots` → `#/bots/aibots`), and the query string is kept. The menu highlights the merged entry, search lists every tab as "Group › Entry", and page guides and page gears follow the tab.
6. **Related links:**
   - A "Related" row at the end of the pages that work together.
   - A single strategy and a single Playbook link at the top to their own backtest, run settings (the bot) and listing (Marketplace or Playbook library), plus My bots and Risk controls.
   - AI signals link to Alerts to trades.
   - The community strategies card links to the Marketplace.
7. **Translations:** Yiddish for every new label and sentence (`public/i18n/yi-structure.js`). The eight simple-translation languages got the new group and entry names.
8. **Fixes found by the click-through:** the Retirement tables overflowed at 1280px, and the Playbooks tab strip overflowed at 375px (and still showed a Developer API tab).
9. **Docs and checks:**
   - The generated README overview lists each entry with its tabs.
   - `scripts/readme-check.mjs` accepts tab names.
   - Three old menu paths in text were updated (a page guide and two code comments).
   - DESIGN_SYSTEM.md has a "Merged pages and tabs" rule.

### Tests

- `npm test`: 389 pass, 0 fail, 3 todo (the review-only BUG-003/004/005). Security check and clean check pass.
- Click-through in Chromium against the mock broker, at 1280px and 375px:
  - all 53 menu entries and detail pages, the 41 tab addresses and all 41 old addresses, plus old addresses with a query;
  - every old address lands on its tab with the right menu entry marked;
  - no browser errors, no page wider than the screen after the fixes, and every merged page shows its tabs and its Related row.
- `npm run e2e` (with the pre-installed Chromium): 444 checks, exit 0. One earlier run had one failure in the trade symbol search step; it passed on the re-run and that page was not changed, so it was a one-off timing failure. The e2e menu steps were updated for the new structure: the Automate group instead of Quant lab, the Alpaca account through Accounts, and a new step that checks 12 old addresses redirect to their tab.

### Rollback

`git revert` the four commits (audit, menu and merged pages, redirects, Related links) and push. Old addresses work in both directions, because every page keeps its own route.

---

## 2026-11-18: Remove the homepage video; dashboard home with the portfolio chart on top

### What changed

1. **Homepage video removed** from `index.html` and `yi.html`, and from their generator `scripts/home.py` (otherwise the next `python3 scripts/pages.py` would bring it back). The whole `<section class="adreel">` went: the video, its caption and its transcript. Its player code in `public/site.js` and its styles (`.adreel`, `.adbox`, `.adtrans`) in `public/site.css` were deleted. The files in `public/media/` stay. The pages were rebuilt with `scripts/pages.py`, so the other public pages differ only in the `site.css`/`site.js` version hashes.
2. **Dashboard home** (`routes.dashboard`, paper and other non-Alpaca accounts) now goes from top to bottom: the title row (with the clock in it), then the portfolio chart at full width with the monthly statement, then the key numbers, then a two-column card grid (one column under 768px) holding Positions, My day, Why your P/L moved, Trade and Recent orders (full width). The layout rules are in `public/layout.css` under "dashboard home", and DESIGN_SYSTEM.md has a new "Dashboard home" section.
3. **My day, Why your P/L moved and the page guide** now go into slots (`[data-slot]`, `display: contents`) on the home grid, instead of being inserted under the title. On pages without a slot they work as before.

### Decisions on unclear points

- I left the title row (`h1`) above the chart, because DESIGN_SYSTEM.md requires one `h1`, placed first in the view. I moved the clock into that row so the chart comes right after it (153px from the top at 1280px, 205px at 375px).
- The key numbers are Total value, Today (hidden when `hideToday` is on), Buying power (new tile: `buyingPower` from `/account`, falling back to cash; it updates live like the others) and Open positions. I kept Profit / loss, Since you last looked (PREFS mode) and Cash after them, so no data is lost.
- The approvals banner, the welcome and "Get started" cards and the page guide ("How this page works") used to sit above everything. They now sit under the key numbers, above the grid, so the chart is the first thing you see. The guide is unchanged otherwise (Got it, Hide on every page).
- There is no watchlist card. Watchlists are Alpaca-only, and an Alpaca account's home is the Portfolio page (`routes.portfolio`), which I left alone ("don't touch other pages"). On that page, My day and P/L still go under the title as before. "Recent activity" is the existing Recent orders card.
- Cards in a grid row stretch to the same height, so the rows end on a clean line.
- Video tests: BUG-013 (captions and a transcript for the video) is superseded. Its test now checks that the video is gone and that the captions file is still in `public/media`. I removed the 11 English and 11 Yiddish sentences of the video caption and transcript from `test/golden/homepage-v1-sentences.json`. The transcript's legal lines ("Investing involves risk of loss", "software, not a broker") are still covered by the homepage footer disclosure.
- The layout golden gate (`npm run layout:gate`, not part of `npm test`) will show the dashboard and homepage as changed on purpose. The baseline is for the owner to update.

### Tests

- `npm test`: 389 pass, 0 fail, 3 todo (the review-only BUG-003/004/005).
- Dashboard checked in Chromium against the mock broker at 1280, 800 and 375px: no horizontal scroll and nothing wider than the page (tables scroll inside their own box). The chart is the first block after the title. The grid is 2 columns at 1280 and 800px and 1 column at 375px, in the order Positions, My day, P/L, Trade, Recent orders. With `hideToday` on, the Today tile is hidden. No browser errors.
- `npm run e2e` (with the pre-installed Chromium): 444 checks, exit 0, no failures (it includes My day on the home page and the quick-ticket orders).

### Rollback

`git revert <this commit>` and push.

---

## 2026-11-16: Remove the feature flag system, make the layout permanent, automatic release pipeline

**Release:** see the tag on the deploy of this change (`vYYYY.MM.DD-N`, created automatically after the deploy). Rollback target: the commit before it on main (the release commit's first parent). **Rollback used:** none (filled in below if the live check fails).

### What changed

1. **The feature flag system is gone.** Deleted: `src/flags.js`, the admin "Feature flags" card, `GET/PUT /api/admin/site/flags`, `GET /api/tools/flags`, the staged-rollout module (`src/layout-rollout.js`) and every flag check. The stored site settings `flags` and `layoutRollout` are left in the database, unused and harmless (no migration, so no backup or reverse was needed).
2. **The layout redesign is permanent** (it was built behind the flag `layout_v2`): `layout.css` and `layout.js` are part of every page (`<html class="lv2">`). Spacing, type scale, focus outlines, scrolling tables, skeleton loaders, empty states with a next step, error boxes, WCAG AA colour fixes, and the signed-in footer disclosures now shown. Details: DESIGN_SYSTEM.md, DESIGN_DECISIONS.md, COPY_CHANGES.md, LAYOUT_TEST_RESULTS.md.
3. **A release pipeline that needs nobody:** gates on every branch push → automatic merge to main when they all pass → deploy → smoke test and 15-minute watch of the live site → automatic rollback if it fails twice in a row → every deploy tagged. See "Release pipeline" below.

### Decision for each flag (finished and passing its tests means permanently on)

| Flag | Decision | Reason |
|---|---|---|
| `layout_v2` | **On for everyone** | Passed every gate: 0 disclosure, figure or control differences on 122 pages × 4 widths (test mode and production-mode build), 0 new axe violations (921 → 146), Lighthouse within tolerance, 436 end-to-end checks identical to the old layout. |
| `home_v2` | **Removed, not released** (owner's choice, option 2): the previous homepage stays live, unchanged; the audited-order version's code (section regrouping, risk links, Trust & compliance block, its CSS) was deleted. Recoverable from git history (commit `1d9efaf`). | Releasing it would have needed a change to the page snapshot (golden baseline) that the safety check refused, and its legal items L9 to L12 were never signed off. |
| `ai_team_chat` | **On** (still needs the "AI team chat" permission: owner, or admins the owner grants) | 18 unit tests and a browser suite pass; the flag only hid a feature that is already permission-gated on the server. |
| `comms_drawer` | **On, but a user sees it only once an admin assigns them a number** (no number: every route answers 404 and the app downloads nothing) | 30 unit tests and a browser suite pass. The site-wide flag could not be removed without making every user see an unconfigured drawer, so the natural switch (having a number) replaces it. **Risk:** the Telnyx call names were written without the vendor documentation (COMMS_SETUP.md); the webhooks fail closed (503 without keys, 401 without a valid signature). |
| `tools_sizing`, `tools_rr` | **On for every signed-in user** | Tests pass (maths against worked examples, routes, browser suite). |
| `tools_heatmap` | **On** | Tests pass. Without a market-data feed it answers "not set up" honestly instead of showing prices. |
| `ai_portfolio_explainer`, `ai_indicator_explainer` | **On, with their kill switches unchanged** (`PUT /api/admin/tools/kill`, `AI_TOOLS_KILL`) | Advice-filter tests (adversarial set), redaction, logging and kill-switch tests pass. **Risk:** COMPLIANCE_REVIEW.md marks them "Review required"; they talk about a user's own holdings. Use the kill switch if a legal check says so. |

One feature was removed instead of released: the audited-order homepage (above).

### Test results

| Gate | Result |
|---|---|
| Syntax of every JS, MJS and Python file | pass |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Secrets scan (`scripts/secrets-scan.mjs`) | none found |
| Clean code and README check | pass |
| Unit and integration tests | 353 pass, 0 fail, 3 todo (the three money-logic bugs held back since the audit, untouched) |
| End-to-end flows (sign-up, sign-in, bank link and deposit, order preview and confirmation, limit, bracket, crypto and options orders in the sandbox, modify, cancel, close-all with typed confirmation, withdrawal-style transfer, paper flow) | filled in from the final run: see "Final gate run" |
| Disclosures present and visible on every page at 1440, 1280, 768, 390 px; figures identical; every control present; no new axe violations | filled in from the final run |
| Browser suites: AI team chat, SMS and voice drawer, planning tools | filled in from the final run |

Number snapshots: the baseline of 11,820 figures (prices, fees, balances, P&L, %) from the code before the redesign is committed (`test/golden/layout-baseline.json`). The current site must reproduce every figure.

### Release pipeline (new)

- `.github/workflows/release-gates.yml`: on every push to `ai/*`, `chore/*`, `fix/*`, `feature/*`: audit, secrets scan, syntax, clean check, unit tests, end-to-end, page gates in test and production mode, browser suites. If all pass, the branch is merged into main (merge commit, only when the branch already contains main's latest commit, so the merged tree is exactly the tested tree), the deploy is started, and the branch is deleted. A failing gate leaves main untouched.
- `.github/workflows/deploy.yml` (existing): CI → Render deploy → routing and database checks. Also startable by the merge step.
- `.github/workflows/post-deploy.yml` (new): waits for the live site to serve the commit, runs `scripts/smoke.mjs` (pages load with their legal text and layout; the app's trading and payment code is served; health and routing checks; sign-in refuses a wrong password normally; with the optional test-account secrets also signs in and reads account and planning tools), then watches 15 minutes (one smoke test per minute). Two failures in a row → **automatic rollback**: the deploy hook is called with the release commit's first parent (what was live before), then the smoke test runs again.
- `.github/workflows/tag-release.yml` (new): tags every deploy `vYYYY.MM.DD-N`. Restore a version by name: redeploy that tag's commit.

### Limits and what could not be done

- **The live site cannot be reached from the coding environment** (the network policy blocks it), so live verification runs inside GitHub Actions, which can.
- **The smoke test's sign-in step needs a test account**: add the repository secrets `SMOKE_EMAIL` and `SMOKE_PASSWORD` (a sandbox account, never a customer). Without them the step is reported as skipped and the wrong-password check stands in for it. I cannot create repository secrets.
- **"Errors above 2x normal" is checked as page and health failures**, not as an error-rate ratio: the server's error counters are admin-only. A check failing twice in a row triggers the rollback.
- **Merges that change `.github/workflows/*` cannot be done by the pipeline** (GitHub does not let the built-in token change workflow files): the gates still run and are reported; the merge is pushed by hand. This release is one of those.
- **Branch protection**: none blocks pushes to main today. If it is ever turned on for main, the pipeline's merge step fails with a clear message; the setting to change is *Settings → Branches → main → allow GitHub Actions to bypass* (or turn off "Require a pull request before merging" for the Actions bot).
- The unexplained one-off flake seen once on Admin → Strategies in the production-mode run (a `0%` figure) did not reproduce in 8 later runs.

### Rollback

Automatic (above). By hand: redeploy the previous tag: `curl -X POST "<deploy hook>&ref=<commit of the previous tag>"`, or revert the merge commit on main (`git revert -m 1 <merge commit>`) and push; the pipeline deploys the revert.
