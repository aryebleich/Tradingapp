# Brightolio contributor instructions

These instructions apply to Codex and Claude Code. Start with [AI_HANDOFF.md](AI_HANDOFF.md) for the current branch, task queue, and latest checkpoint.

## Before editing

1. Fetch the refs and inspect the current branch, commit, and worktree status. Read the open task, recent commits and diffs, and any instructions scoped to the affected files. Preserve existing work, including local changes and partially completed tasks.
2. Review [CHANGELOG_AI.md](CHANGELOG_AI.md), [DECISIONS.md](DECISIONS.md), and [ASSUMPTIONS.md](ASSUMPTIONS.md) for the task. Consult [MIGRATION_ORACLE.md](MIGRATION_ORACLE.md) for hosting or data work and [PERFORMANCE.md](PERFORMANCE.md) for performance work. Reconcile dated notes with newer commits and GitHub evidence before changing behavior.
3. Claim the task using the handoff process. Keep changes and verification within the agreed scope. Use local fixtures, mocks, or isolated paper-only environments for development and tests.

## Branch and production boundaries

Use a separate branch. Before creating or updating a remote branch, check the current workflow triggers and the destination ref. The current [release gates](.github/workflows/release-gates.yml) can automatically merge and deploy pushes under `ai/**`, `chore/**`, `fix/**`, and `feature/**`. Use a branch outside those patterns, such as `work/<task-id>-<summary>`, while the no-merge constraint applies.

Do not merge, push to `main`, deploy, dispatch production workflows, change production infrastructure or settings, or execute real-money trades. Owner tasks in the queue require separate authorization. Keep credentials, customer data, and private logs out of commits and handoffs.
