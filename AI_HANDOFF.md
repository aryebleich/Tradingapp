# Brightolio AI handoff

The shared queue and checkpoint for **Claude Code** and **Codex**. The rules are in [AGENTS.md](AGENTS.md): catch up, claim one row, work in small tested pushes to `main`, hand off. This file lives on `main`, so one `git pull` shows the latest state.

## Latest checkpoint

- **2026-11-26 13:55 UTC, Claude Code, OPS-01 → done (the source part).**
  - **Last SHA:** `a00ae2e` on main.
  - **What changed:**
    - render.yaml and src/render-redirect.js are deleted, with their tests, after dns-cutover.yml confirmed on 2026-11-25 at 16:42 UTC that app.brightolio.com is an A record to 138.2.233.183 and answers `host: oracle` without Render (issue #55 closed);
    - AGENTS.md and this file are rewritten as one loop on main.
  - **Checks:** npm test passes 590 (3 known TODO reviews). clean-check passes.
  - **Owner still to do:** in the Render dashboard, remove the custom domain and suspend the service; delete the GitHub secret RENDER_DEPLOY_HOOK_URL; set the variable APP_URL to https://app.brightolio.com.
  - **Next action:** CODEX: publish PERF-01 (only on Codex's local branch `work/perf-01-stock-card` at `e8fe589`). Rebase it onto main, run npm test, push to main and mark it done. CLAUDE: take AIADMIN-3.

## Earlier checkpoints (short)

- **2026-11-25, Codex, PERF-01:** stock cards precomputed for four starter symbols and shared across workers (server.js, src/stock.js, src/memo.js, test/stock-routes.test.js). 589 tests passed locally. Not pushed yet.
- **2026-11-25, Codex, CHAT-04:** Codex activity and partial answers in the Admin chat, now on main (`e318623`). 33 chat tests passed. Not yet checked live against the provider.
- **2026-11-25 16:33 UTC, Claude Code, performance phase 2:** done on main (`d6a291b`). 200 users: every API route meets its target, 0 errors, 0 shed. Desk quote p95 131 ms, overview p95 224 ms. Only the 48 KB font misses (334 ms against 300 ms). Lighthouse mobile 95–98. Details in PERFORMANCE.md.

## Shared task queue

States: `ready` (free to claim), `active` (claimed; don't touch while the last update is under 3 hours old), `paused`, `blocked`, `done`, `owner` (only the owner can do it).

| ID | State | Owner | Scope and how to know it is done |
| --- | --- | --- | --- |
| TEAM-01 | active | Claude (2026-11-26 14:05 UTC, from 0034686) | Three assistants (Claude, Codex, Grok): one loop, ai/status.json, prompts, Grok provider, Admin work status, ai-loop.yml, 20-task queue. Owner-named task. |
| PERF-01 | active | Codex | Publish the local stock-card precompute (see the checkpoint): rebased on main, npm test passes, pushed. |
| CHAT-04 | ready | — | A live check of the Codex activity stream in Admin → AI chat with the owner's key: one short "hello" in a test thread; write the result. No message text in logs. |
| AIADMIN-3 | ready | — | Admin AI part 3: Claude usage and caps. Show spend and tokens per day and month in Admin → AI; add a monthly cap setting, and stop new AI calls with a clear reason at the cap. Tests with mocks. |
| AIADMIN-4 | ready | — | Admin AI part 4: the AI work queue. ai-queue.yml plus an Admin page that lists, adds and cancels queued AI tasks, read only for anyone who is not the owner. |
| AIADMIN-5 | ready | — | Admin AI part 5: GitHub Actions in Admin (list the recent runs, and start the safe, read-only workflows) and tools in the chat (status, logs, health). |
| PARTA-1 | ready | — | Part A items A1, A3, A4, A7 and A8 (see DECISIONS.md and CHANGELOG_AI.md for their definitions), one commit each. |
| PARTA-2 | ready | — | A language chooser at sign-up, the AI-written README, and the setup assistant in the chat. |
| PAGES-01 | ready | — | The GitHub Pages deploy fails with "No artifacts named github-pages": find the cause in pages.yml and fix it. Done when a Pages run is green. |
| CI-01 | ready | — | Read the failing Clean code and README run (private README check) and the Deep check run (its issue-opening step); find the root causes, fix them, and get both green. |
| PERF-02 | ready | — | A smaller subset of the font (it is the only performance miss). Check the languages it covers and the fallback; record size before and after. |
| SEVEN-4 | ready | — | Seven-phase brief, phase 4: Plans and billing as a main section, plus credits. |
| SEVEN-5 | ready | — | Phase 5: the dividend scanner (about 2,000 symbols, measures, scores, AI, terminal UI). |
| SEVEN-6 | ready | — | Phase 6: the AI work queue. Coordinate with AIADMIN-4 so it is built once. |
| SEVEN-7 | ready | — | Phase 7: readability checks everywhere, with fixes. |
| TICK-01 | ready | — | Part B: the tick engine (not started). Write a design note in DECISIONS.md first. |
| OPS-01 | owner | Owner | Render dashboard: remove the custom domain app.brightolio.com and suspend the service. GitHub: delete RENDER_DEPLOY_HOOK_URL and set APP_URL. The repo part is done. |
| OPS-02 | blocked | — | Turso recovery window, scheduled from 2026-12-01 00:30 UTC (oracle-merge-scheduled.yml). Afterwards, read its report and checks and write the result. |

## Checkpoint fields

Write these each time you hand off: UTC time; task ID and state; your name; the last SHA on main; the changed paths; the checks and their results; blockers; and one concrete next action.
