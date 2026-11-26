# Brightolio contributor instructions

These rules apply to all three assistants on this repo: **Claude** (Claude Code), **Codex** (ChatGPT) and **Grok**. They take turns, and each one picks up exactly where the last one stopped.

- [AI_HANDOFF.md](AI_HANDOFF.md) is the shared board: who is on what, the queue, the hand-offs and the owner-only items.
- `ai/status.json` is the same board in JSON, generated from AI_HANDOFF.md by `npm run ai:status`.
- For web chats, both are public at:
  - https://raw.githubusercontent.com/aryebleich/Tradingapp/main/AI_HANDOFF.md
  - https://raw.githubusercontent.com/aryebleich/Tradingapp/main/ai/status.json
- The paste-in prompts for the web chats are in [ai/prompts/](ai/prompts/). Update them whenever this loop changes.

**The goal:** grow Brightolio into a large, professional trading platform that earns money honestly: real value, clear prices, no promised returns and no dark patterns.

## Who does what best

The "Suggested" column in the queue follows this split. When the others are idle, any assistant may take any ready row.

| Assistant | Best at | Typical rows |
| --- | --- | --- |
| Claude | Big multi-file changes, architecture, careful code and security reviews, hard debugging | New sections, billing, auth, refactors, reviewing Codex's pull requests |
| Codex | Focused coding tasks with tests, CI fixes, small features, and test coverage | One page or route, a CI failure, a test suite, reviewing Claude's pull requests |
| Grok | Market and news research, competitor and pricing scans, product second opinions, market realism | docs/research/ notes, reviews of AI picks and disclosures, trading-engine design review |

Grok normally doesn't push code. It writes its result as a research note or a review, which the next coding run (Claude or Codex) picks up.

## The loop: every session, every assistant

1. **Catch up.**
   - Run `git fetch origin main` and `git pull --ff-only origin main`.
   - Read AI_HANDOFF.md (Assistants, Queue, the newest Hand-offs), the newest sections of [CHANGELOG_AI.md](CHANGELOG_AI.md) and `git log --oneline -15`.
   - Read the other assistants' latest commits before starting, so nothing is done twice.
   - If the board and the commits disagree, trust the commits and fix the board first.
2. **Claim one task.**
   - Continue your own `active` or `paused` row, or take the first `ready` row by priority. Prefer rows suggested for you, unless the owner named one.
   - An `active` row belongs to its assistant for **3 hours after its last update**. After that, anyone may take it over; write "taken over from <assistant>" in the hand-off.
   - To claim a row:
     - set it to `active` with your name and the UTC time, and set your line in the Assistants table;
     - run `npm run ai:status`;
     - commit it as `handoff: claim <ID>` and push.
     - If the push is rejected, pull, read the board again and retry. Never force-push.
3. **Work in small steps.**
   - Make one commit per finished piece.
   - `npm test` must pass before every push: `node --import ./test/setup.js --test --test-force-exit test/*.test.js`.
   - Also run `node scripts/clean-check.mjs` (CI runs it): a new file that nothing imports must be used, or listed in its KEEP list.
   - Push to main (it deploys automatically), or to your own `ai/<assistant>-<ID>` branch when you run in GitHub Actions, where release-gates.yml tests and merges it after the review.
   - Pushes are the heartbeat: push at least every hour, and before long runs or when a usage limit is near.
4. **Hand off.**
   - When you stop (done, paused, blocked or at a usage limit):
     - add a hand-off at the top of "Hand-offs": the heading `### <UTC time> · <assistant> · <ID> · <state>`, then Last SHA, Changed, Checks, Blockers and **one concrete Next action**;
     - update the row and your Assistants line;
     - at a usage limit, set the row to `paused` and write the reset time.
   - Then run `npm run ai:status`, commit `handoff: <ID> <state>` and push.
   - Keep the queue sorted (active, paused, ready by priority, blocked, done this week). Move done rows older than a week, and old hand-offs, to docs/archive/AI_HANDOFF-history.md.
5. **Record the details.**
   - Write what you did in a dated CHANGELOG_AI.md section that names you.
   - Decisions go in [DECISIONS.md](DECISIONS.md), assumptions in [ASSUMPTIONS.md](ASSUMPTIONS.md).
   - Hosting notes go in [MIGRATION_ORACLE.md](MIGRATION_ORACLE.md), performance notes in [PERFORMANCE.md](PERFORMANCE.md), and research in docs/research/.

## Reviews

- When one assistant finishes a pull request, another reviews it before it merges: Codex reviews Claude's, Claude reviews Codex's, and Grok adds a market or product review when the change touches trading, pricing or AI picks.
- Real problems are fixed before the merge. Style preferences are notes, not blockers.

## Without push access (a plain web chat)

- Claim nothing.
- Read the board at the raw links and do the work in the chat.
- End with a ready hand-off block in the exact format above, plus any patch (a unified diff). The owner pastes it into Claude Code or Codex, which commits it.

## Never

- Print, log or commit a secret value. To check a key, look only at its prefix and length.
- Spend money, place real-money trades, or send real emails or texts to users. Use the paper account, fixtures and mocks. Per-use AI billing has a $0 cap until the owner raises it in Admin.
- Promise returns, use dark patterns (countdowns, fake scarcity, invented reviews, hidden cancel), or make live trading the default. Follow [LEGAL_REVIEW.md](LEGAL_REVIEW.md) and [COMPLIANCE_REVIEW.md](COMPLIANCE_REVIEW.md).
- Remove or break an existing feature, rewrite history on main, or force-push.
- Take an owner-only action (the "Owner only" table): DNS, dashboards, secrets, billing, legal sign-off. Write it in the hand-off instead.
- Put anything private in the repo; it is public. That includes the board and ai/status.json: no emails, server addresses, account details or private plans.

## Production

- `main` deploys to https://app.brightolio.com automatically, so a push must pass `npm test`.
- Read-only checks are fine: /healthz, the status workflows, and the read-only load test at most once per task.
- A workflow that changes the server (`oracle-migrate.yml` set-env, restore and similar) needs a reason written in the hand-off before it runs.
