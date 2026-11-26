# REV-02: "Unlock with Pro" labels on paid-only controls

**From the board (AI_HANDOFF.md):** "Unlock with Pro" labels on paid-only controls before they are pressed (PRO_REVIEW.md #18), from one list of paid features. Done when every paid control on the 10 most-used pages is labelled and a test checks the list.

**Assistant:** Codex, through the Codex GitHub integration (asked with `@codex` on this pull request). Started by Claude for the owner on 2026-11-26.

## What exists

- **Server:** a paid feature answers 402 with `{ upgrade: true, feature }` (`upgrade()` in src/aiplans.js; `needPlan(...)` and `isPaid(...)` in server.js and src/*.js, for example src/scanner.js, src/playbooks.js and src/stock.js).
- **Browser:** public/app.js line ~128 opens the upgrade window (`showUpgrade(feature)`) when a 402 comes back. Today the user learns a control is paid only after pressing it.
- **Plan data:** the plans and what each includes (see the Plans & billing page and the pricing table that the homepage and Plans & billing share).

## What to build

1. **One list of paid controls** (a single module, for example public/paid-features.js), shared by the pages, built from the plan data where possible: the feature name as the server's `upgrade()` names it, the plan that unlocks it, and the page and control it belongs to.
2. **A small "Pro" label** (or the right plan's name) beside each paid-only control on the 10 most-used pages, shown only to members whose plan doesn't include it. Pressing the control still opens the existing upgrade window, which already says what stays free and that cancelling is one tap.
3. **Tests:** every entry in the list maps to a real server check (an `upgrade(...)` or `needPlan(...)` that exists); the labels render for a free member and are hidden for a member whose plan includes the feature.

## Rules (AGENTS.md)

- Honest labels only: no countdowns, no "only today", no pressure wording. Follow DESIGN_SYSTEM.md (the "Paper" and "practice money" wording) and LEGAL_REVIEW.md.
- Push to this pull request's branch, never to main. `npm test` and `node scripts/clean-check.mjs` must pass before each push.
- Add a dated Codex section to CHANGELOG_AI.md, and any decision to DECISIONS.md.
- Don't edit AI_HANDOFF.md, ai/status.json or .github/workflows: the loop updates the board.
- End with a comment here: Changed, Checks, Blockers, Next action.
