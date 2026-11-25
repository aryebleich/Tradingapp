# Brightolio AI handoff

Read [AGENTS.md](AGENTS.md) before claiming a task. Use this file as the shared queue and checkpoint for Claude Code and Codex. Keep project decisions in [DECISIONS.md](DECISIONS.md), working assumptions in [ASSUMPTIONS.md](ASSUMPTIONS.md), and completed task history in [CHANGELOG_AI.md](CHANGELOG_AI.md).

## Working agreement

1. Fetch and check `origin/docs/ai-handoff` and the proposed task branch. Read the latest checkpoint and compare its branch and recorded commit with GitHub. If the branch moved, inspect the intervening work before claiming anything.
2. Keep one active owner across these two assistants. Before implementation, commit the claim to `docs/ai-handoff` and verify the remote shows your claim. Record the task ID, assistant, UTC time, task branch, and starting SHA. If a normal fast-forward update is rejected, fetch and read the new queue before retrying. Never force-push the shared branch or overwrite another claim.
3. Work from an isolated checkout or worktree. Use the recorded task branch when resuming and start a fresh branch for a new task from the reviewed base. Keep staged and unstaged work intact. Push scoped checkpoint commits to the task branch as work progresses, especially before long tests or when a session limit is near.
4. At pause or completion, publish the task checkpoint first and verify the remote SHA. Then update this file with the task ID, owner, UTC time, branch and exact SHA, changed paths, checks with results, blockers, and the next concrete action. Record any local-only work and its location. Release the claim by marking it `paused`, `blocked`, or `done`. If interrupted before release, the next assistant should compare the last claim with remote commits and ask the owner to confirm transfer before taking over a still-active claim. Use `ready` for unclaimed tasks.
5. Resume from the recorded checkpoint once ownership is available. If there is a discrepancy between the note and the branch, inspect both and update the checkpoint before editing. A completed task can remain on its own branch for owner review.

## Checkpoint after Claude Code

- **Last published Claude work:** [`d6a291b`](https://github.com/aryebleich/Tradingapp/commit/d6a291b090abf177fe10dcda697106fe2c54bbfa) on `main`, 2026-11-25 16:33 UTC. Claude recorded the third Phase 2 performance run and fixed the Load test Summary step for missing Lighthouse output. The measured application commit was [`6e124e1`](https://github.com/aryebleich/Tradingapp/commit/6e124e1157d9a27844d4c2ac996431797f337dbc).
- **Last measurement:** 200 simulated users, all API routes within target, zero errors, sheds or 5xx. Desk quote p95 was 131 ms and market overview p95 was 224 ms. The 48 KB font was the sole miss at 334 ms against 300 ms. Mobile Lighthouse scored 95–98 in the previous run. See [PERFORMANCE.md](PERFORMANCE.md).
- **Branches:** Reviewed all 15 remote branches visible at takeover. Eight non-Dependabot branches, including `feature/copilot-ai-handoff`, were ancestors of `main`. That branch is 25 commits behind and contains performance work already on `main`. The six Dependabot branches each had one unique commit and open PRs #8, #9, #13, #14, #22 and #49. Claude's local-only changes and session state are unknown.
- **Hosting:** The [DNS issue](https://github.com/aryebleich/Tradingapp/issues/55#issuecomment-7168416731) closed at 16:42 UTC after the workflow verified direct Oracle traffic. [MIGRATION_ORACLE.md](MIGRATION_ORACLE.md) predates that confirmation. The Render dashboard and GitHub setting cleanup are still unverified. The existing Turso recovery is documented as scheduled from 2026-12-01 00:30 UTC.
- **Checks:** [CI](https://github.com/aryebleich/Tradingapp/actions/runs/45657499162) passed on the base. [Clean code and README](https://github.com/aryebleich/Tradingapp/actions/runs/45655189475) failed at the private README check. [Deep check](https://github.com/aryebleich/Tradingapp/actions/runs/45655702274) failed at its issue-opening step. The takeover reviewed existing GitHub results. No application test or production workflow was run for this documentation commit.
- **Current claim:** none. Codex completed the documentation handoff on `docs/ai-handoff`, based on `d6a291b090abf177fe10dcda697106fe2c54bbfa`. The commit introducing this checkpoint is the initial handoff revision.

## Codex checkpoint for PERF-01

- **Status:** implemented locally on `work/perf-01-stock-card` at `e8fe5891373518ce676e9c90d32910aeb538e3a9`. The remote task and coordination refs remain absent. Codex proceeded in the isolated local checkout after the owner asked to continue. There is no remote claim.
- **Changes:** `server.js`, `src/stock.js`, and `src/memo.js` share precomputed cards across workers for four starter symbols. `test/stock-routes.test.js` checks a cold worker's cache hit and expired-entry fallback. The performance notes and changelog record the change.
- **Verification:** 21 focused local tests passed. The full suite reported 589 passed, 0 failed, 3 skipped and 3 TODO. Production latency remains unmeasured.
- **Next action:** Review or transfer the local commit, then take PERF-02 from the queue. Production latency still needs separately authorized measurement.

## Shared task queue

| ID | State | Owner | Scope and completion evidence |
| --- | --- | --- | --- |
| PERF-01 | done | Codex | Implementation and fixture verification complete locally. See the checkpoint above for the task commit and publication status. |
| PERF-02 | ready | Unclaimed | Identify the measured font and required character coverage. Compare a smaller subset against the current asset, checking fallback and supported languages. Record size and local measurements. |
| CI-01 | ready | Unclaimed | Read the existing Clean and Deep check failure logs. Reproduce locally where possible and record the root causes independently of the passing basic CI. |
| PERF-03 | blocked | Owner | DNS is confirmed. A canonical-domain performance run still requires explicit approval for live load. Use a local or staging run for development verification. If authorized separately, attach the canonical-domain report and check the targets in PERFORMANCE.md. |
| OPS-01 | blocked | Owner | Confirm Render custom-domain removal and suspension and the repository setting cleanup from issue #55. Review the two leftover forwarder files for a separate source-only cleanup once the owner confirms the dashboard state. |
| OPS-02 | blocked | Owner | Wait for the documented December 1 Turso recovery window. Review the existing workflow's report, integrity checks and final backup evidence when available. Any production action requires separate authorization. |

## Checkpoint fields

- UTC timestamp, task ID, status and outgoing assistant
- Task branch, starting SHA and published checkpoint SHA
- Changed paths and decisions or assumptions with links
- Checks run, their results and outstanding verification
- Local-only work location, blockers and one concrete next action
