# Brightolio contributor instructions

These rules apply to all three assistants on this repo: **Claude** (Claude Code), **Codex** (ChatGPT) and **Grok**. They take turns, and each one picks up exactly where the last one stopped.

- [AI_HANDOFF.md](AI_HANDOFF.md) is the shared board: who is on what, the queue, the hand-offs and the "Owner later" items (none of them blocks a task).
- `ai/status.json` is the same board in JSON, generated from AI_HANDOFF.md by `npm run ai:status`.
- For web chats, both are public at:
  - https://raw.githubusercontent.com/aryebleich/Tradingapp/main/AI_HANDOFF.md
  - https://raw.githubusercontent.com/aryebleich/Tradingapp/main/ai/status.json
- The paste-in prompts for the web chats are in [ai/prompts/](ai/prompts/). Update them whenever this loop changes.

**The plan documents** (all assistants work from the same ones):
- [docs/research/master-plan.md](docs/research/master-plan.md): the owner's master plan (its prices and revenue figures are proposals to test).
- [docs/MASTER_ROADMAP.md](docs/MASTER_ROADMAP.md): the phases and the status of each.
- [docs/FEATURE_REGISTRY.md](docs/FEATURE_REGISTRY.md): every feature, with its status, files, tier, product and legal or data flag. **Every pull request that adds or changes a feature updates its row**; `npm test` fails when a page or route isn't listed (`node scripts/registry.mjs` rebuilds the summary).
- [docs/SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md): how the parts fit (modules, data flow, hosting, brokers, AI, jobs).
- [docs/SECURITY_REQUIREMENTS.md](docs/SECURITY_REQUIREMENTS.md): the security requirements and what is in place.
- [docs/research/growth-plan.md](docs/research/growth-plan.md): the revenue strategy and the price ladder ("Revenue").
- This file stays the development rules; AI_HANDOFF.md and ai/status.json stay the board and the current status.
- Rows flagged `legal` in the registry are built only behind their Admin switch (Admin → Security → Legal gates), off until the owner signs off (LEGAL_REVIEW.md L-MP, OWN-04). Rows flagged `licensed` wait for a data license (OWN-06).

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
   - **Unfinished work comes first.** The "Unfinished tasks" table at the top of AI_HANDOFF.md (rebuilt by `npm run ai:status`) lists every active, paused or blocked task and every task the loop already started, with its owner, branch, last update and next action. Continue its first row from its branch `ai/task-<id>` and its note `ai/tasks/<ID>.md`; never start over, and write "taken over from <assistant>" in the hand-off.
   - Otherwise continue your own `active` or `paused` row, or take the first `ready` row by priority. Prefer rows suggested for you, unless the owner named one.
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
   - Push to main (it deploys automatically), or, in GitHub Actions, to the task's branch `ai/task-<id>`. There release-gates.yml tests each push, and the pull request merges itself (squash) as soon as the gates pass, then deploys.
   - Pushes are the heartbeat: push at least every hour, and before long runs or when a usage limit is near.
4. **Hand off.**
   - When you stop (done, paused, blocked or at a usage limit):
     - add a hand-off at the top of "Hand-offs": the heading `### <UTC time> · <assistant> · <ID> · <state>`, then Last SHA, Changed, Checks, Blockers and **one concrete Next action**;
     - update the row and your Assistants line;
     - at a usage limit, set the row to `paused` and write the reset time.
   - Then run `npm run ai:status`, commit `handoff: <ID> <state>` and push.
   - Keep the queue sorted (active, paused, ready by priority, blocked, later, done this week). A `later` row belongs to a later phase of the master plan (docs/MASTER_ROADMAP.md) and is never picked until someone sets it to `ready`; keep about 20 rows `ready`. Move done rows older than a week, and old hand-offs, to docs/archive/AI_HANDOFF-history.md.
5. **Record the details.**
   - Write what you did in a dated CHANGELOG_AI.md section that names you.
   - Decisions go in [DECISIONS.md](DECISIONS.md), assumptions in [ASSUMPTIONS.md](ASSUMPTIONS.md).
   - Hosting notes go in [MIGRATION_ORACLE.md](MIGRATION_ORACLE.md), performance notes in [PERFORMANCE.md](PERFORMANCE.md), and research in docs/research/.

## Reviews

- Reviews never hold up a deploy. Right after a task pull request merges, another assistant reviews it: Codex reviews Claude's work, and Claude reviews Codex's and Grok's. Grok adds a market or product review when the change touches trading, pricing or AI picks.
- A real problem becomes the next task at the top of the queue (`FIX-nn`). Style preferences are notes, not tasks.
- Every pull request merges and deploys once release-gates.yml passes, workflow and billing changes included; there is no owner-approved label. What protects real money is in the product: Stripe stays in test mode, live-money trading and real emails or texts stay off until the owner turns them on in Admin, and prices come only from Admin → Prices.
- One GitHub rule remains: the workflows' built-in token can never push changes to `.github/workflows/`, so a branch that edits a workflow is merged by a run with workflow rights (Claude Code, Codex or the owner) after its gates pass.

## Batch pull requests (Grok and Codex)

When several task branches are open, Grok or Codex collects them into one fresh pull request:
1. Branch `batch/<YYYY-MM-DD>` from main, and merge into it every open task branch (`ai/task-*`) that merges cleanly and passes `npm test` and `node scripts/clean-check.mjs`. Leave out a branch that doesn't, and say why.
2. Open one pull request titled `BATCH-<YYYY-MM-DD>: open tasks`. Its description lists every included task on its own line as `- <ID> #<pull request number>` (`node scripts/ai-batch.mjs list` prints the open task branches and their pull requests).
3. When the batch pull request is merged, .github/workflows/batch-close.yml closes each sub-pull-request listed in it, with a comment linking to the batch, and deletes its branch. GitHub doesn't allow deleting pull requests, so they are closed. A sub-pull-request that isn't listed in a merged batch is never closed.

## When an assistant hits its limit: Claude → Grok → Codex

An unfinished task never waits (scripts/ai-loop.mjs `chainPick`, .github/workflows/ai-loop.yml):
1. Claude works the task.
2. At Claude's usage limit, the row is paused with the reset time (the Assistants table, "Reset (UTC)"). The branch and the progress note (`ai/tasks/<ID>.md`) are pushed, and the next run starts at once with Grok on the same branch.
3. Grok codes only with XAI_API_KEY and a Grok cap above $0. It gets 3 tries to pass npm test and the clean check.
4. When Grok can't run, or fails 3 times, Codex continues through GitHub (`@codex` on the task pull request, on the owner's ChatGPT plan).
5. When all three are at their limits, the task waits for the first reset, and the hourly schedule continues it there. After Claude's reset, Claude is first again.

Research rows go to Grok first. Whoever continues reads the branch and the progress note, never starts over, and writes "taken over from <assistant>" in the hand-off.

## Without push access (a plain web chat)

- Claim nothing.
- Read the board at the raw links (Grok: through its GitHub connection, when it has one) and do the work in the chat.
- End with a ready hand-off block in the exact format above, plus any note or patch (a unified diff).
- **A hand-off or a research note:** the owner pastes it into the AI hand-off form (https://github.com/aryebleich/Tradingapp/issues/new?template=ai-handoff.yml). The AI inbox workflow checks it and commits it to the board. Only issues from people with write access count.
- **A patch:** the owner pastes it into Claude Code or Codex, which test it and commit it.

## Without paid keys

The whole loop runs on plans the owner already has. No per-use API key is needed:

| Assistant | How it runs | What the owner sets up once |
| --- | --- | --- |
| Claude | Claude Code (interactive), and the AI loop through `CLAUDE_CODE_OAUTH_TOKEN`: the owner's Claude subscription, not billed per use | `claude setup-token`, then the repository secret CLAUDE_CODE_OAUTH_TOKEN |
| Codex | Codex in ChatGPT with GitHub access, and the Codex GitHub integration. The AI loop opens a task pull request with a brief and comments `@codex …`. After Claude's pull requests merge, it comments `@codex review`. Findings become the next task; "Didn't find any major issues" means none | Connect Codex to this repo and turn on code review in Codex's settings; set the repository variable CODEX_GITHUB=1. Optionally add CODEX_MENTION_TOKEN (a token of the owner's, Pull requests: write), so the `@codex` comments come from the owner, which Codex answers |
| Grok | grok.com with its GitHub connection, using the prompt in ai/prompts/grok.md. Results come back through the AI hand-off form, which the AI inbox workflow commits | Connect GitHub in Grok's settings |

The per-use keys (OPENAI_API_KEY, XAI_API_KEY, ANTHROPIC_API_KEY) are optional extras behind the $0 caps in Admin → AI team → Work status.

## Never

- Print, log or commit a secret value. To check a key, look only at its prefix and length.
- Spend money, place real-money trades, or send real emails or texts to users. Use the paper account, fixtures and mocks. Per-use AI billing has a $0 cap until the owner raises it in Admin.
- Promise returns, use dark patterns (countdowns, fake scarcity, invented reviews, hidden cancel), or make live trading the default. Follow [LEGAL_REVIEW.md](LEGAL_REVIEW.md) and [COMPLIANCE_REVIEW.md](COMPLIANCE_REVIEW.md).
- Remove or break an existing feature, rewrite history on main, or force-push.
- Take an owner-only action (the "Owner later" table): DNS, dashboards, secrets, switching billing live, legal sign-off. Write it there instead; none of them blocks a task.
- Put anything private in the repo; it is public. That includes the board and ai/status.json: no emails, server addresses, account details or private plans.

## Production

- `main` deploys to https://app.brightolio.com automatically, so a push must pass `npm test`.
- Read-only checks are fine: /healthz, the status workflows, and the read-only load test at most once per task.
- A workflow that changes the server (`oracle-migrate.yml` set-env, restore and similar) needs a reason written in the hand-off before it runs.
