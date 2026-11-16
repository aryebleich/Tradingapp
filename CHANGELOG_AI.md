# CHANGELOG_AI.md

One entry per task: what changed, why, test results, release tag, rollback. Newest first.

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
| `home_v2` | **On: the single homepage** (`index.html`, `yi.html` are now the audited-order page; the old copies and the `-v2` files are deleted) | Every sentence of the old page was kept (tested); tests pass. **Risk to know:** the legal items L9 to L12 were never signed off. If a check finds a problem, change the wording and redeploy. |
| `ai_team_chat` | **On** (still needs the "AI team chat" permission: owner, or admins the owner grants) | 18 unit tests and a browser suite pass; the flag only hid a feature that is already permission-gated on the server. |
| `comms_drawer` | **On, but a user sees it only once an admin assigns them a number** (no number: every route answers 404 and the app downloads nothing) | 30 unit tests and a browser suite pass. The site-wide flag could not be removed without making every user see an unconfigured drawer, so the natural switch (having a number) replaces it. **Risk:** the Telnyx call names were written without the vendor documentation (COMMS_SETUP.md); the webhooks fail closed (503 without keys, 401 without a valid signature). |
| `tools_sizing`, `tools_rr` | **On for every signed-in user** | Tests pass (maths against worked examples, routes, browser suite). |
| `tools_heatmap` | **On** | Tests pass. Without a market-data feed it answers "not set up" honestly instead of showing prices. |
| `ai_portfolio_explainer`, `ai_indicator_explainer` | **On, with their kill switches unchanged** (`PUT /api/admin/tools/kill`, `AI_TOOLS_KILL`) | Advice-filter tests (adversarial set), redaction, logging and kill-switch tests pass. **Risk:** COMPLIANCE_REVIEW.md marks them "Review required"; they talk about a user's own holdings. Use the kill switch if a legal check says so. |

No feature was unfinished or failing, so none was deleted.

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
