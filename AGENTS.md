# Brightolio contributor instructions

These rules apply to both Codex (ChatGPT) and Claude Code. The two work on this repo in turns and pick up where the other left off. [AI_HANDOFF.md](AI_HANDOFF.md) holds the shared task queue, who is working on what, and the latest checkpoint.

## The loop: every session, every assistant

1. **Catch up.**
   - Run `git fetch origin main` and `git pull --ff-only origin main`.
   - Read AI_HANDOFF.md, then the newest sections of [CHANGELOG_AI.md](CHANGELOG_AI.md) and `git log --oneline -15`.
   - If the latest checkpoint and the commits disagree, trust the commits and fix the checkpoint first.
2. **Claim one task.**
   - Take the first `ready` row in the queue, unless the owner named a different one.
   - Don't take a row that is `active` for the other assistant if its last update is less than 3 hours old.
   - To claim it, set the row to `active`, with your name, the UTC time and the starting SHA.
   - Commit it as `handoff: claim <ID>` and push to main. If the push is rejected, pull, read the queue again and retry; never force-push.
3. **Work in small steps.**
   - Make one commit per finished piece, with `npm test` passing before every push: `node --import ./test/setup.js --test --test-force-exit test/*.test.js`.
   - Push to main; the deploy is automatic.
   - Pushes are the heartbeat: push at least every hour, and before long runs or when a usage limit is near.
4. **Hand off.**
   - When you stop (done, paused, blocked or out of credit), update the checkpoint in AI_HANDOFF.md:
     - task ID, state, UTC time, last SHA;
     - what changed and the checks with their results;
     - blockers and **one concrete next action**.
   - Set the row to `done`, `paused` or `blocked`, then commit `handoff: <ID> <state>` and push.
   - The other assistant continues from exactly that line.
5. **Record the details.**
   - Write what you did in CHANGELOG_AI.md (a dated section that names you).
   - Decisions go in [DECISIONS.md](DECISIONS.md), assumptions in [ASSUMPTIONS.md](ASSUMPTIONS.md).
   - Hosting notes go in [MIGRATION_ORACLE.md](MIGRATION_ORACLE.md), performance notes in [PERFORMANCE.md](PERFORMANCE.md).

## Never

- Print, log or commit a secret value. To check a key, look only at its prefix and length.
- Spend money, place real-money trades or send real emails or texts to users. Use the paper account, fixtures and mocks.
- Remove or break an existing feature, rewrite history on main, or force-push.
- Take an owner-only action (rows marked `owner`): DNS, dashboards, secrets, billing. Write it in the checkpoint for the owner instead.
- Put anything private in the repo; it is public.

## Production

- `main` deploys to the Oracle server (https://app.brightolio.com) automatically, so a push must pass `npm test`.
- Read-only checks are fine: /healthz, the status workflows, and the read-only load test at most once per task.
- A workflow that changes the server (`oracle-migrate.yml` set-env, restore and similar) needs a reason written in the checkpoint before it runs.
