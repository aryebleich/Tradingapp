# Features: gap audit and status

Phase 1 audit of the feature set (2026-11-17). For each feature: what existed, what was missing, the
plan, and the status. "Playbooks" is Brightolio's name for block-based strategies (DECISIONS P-1).

| # | Feature | Status |
|---|---|---|
| 1 | AI strategy builder in plain English | Built |
| 2 | Visual strategy editor (Playbooks) | Built |
| 3 | Backtesting and research | Built |
| 4 | Automated execution and rebalancing | Built |
| 5 | Trade preview | Built |
| 6 | Playbook history | Built |
| 7 | Community library | Built |
| 8 | Guided discovery | Built |
| 9 | Manual override | Built |
| 10 | Account types | Built |
| 11 | REST API for developers | Built |

## 1. AI strategy builder in plain English
- **Existed:** `src/aibots.js` turns plain English into single-symbol bot rules (`parseRules`, `parseWithAi`) and backtests them; `src/llm.js` (`jsonCall`) with provider fallback.
- **Missing:** output in the visual editor's format (a weighted portfolio with explicit rules), validation of symbols, weights and rules, an automatic backtest before saving, the AI label.
- **Plan / built:** `aiBuild` in `src/playbooks.js` asks the AI for a Playbook JSON (`SYSTEM` prompt); without an AI provider a plain reading of the words (`ruleDraft`) is used and says so. The result is checked by `checkPlaybook` (every problem listed), symbols are checked by loading price history (unknown tickers are rejected), and it is backtested before it can be saved (`POST /api/playbooks` with `aiGenerated` backtests again). Labelled "AI-generated. Not investment advice".

## 2. Visual strategy editor
- **Existed:** the strategy editor for library designs (`src/rotation/*`, tree steps and lists), not block-based.
- **Missing:** blocks (asset with weight, weighting method, if/else on indicators, top/bottom-N filter, nested groups, rebalance frequency), drag and drop, nesting, undo/redo, one shared JSON, versions.
- **Plan / built:** format and checks in `src/rotation/playbook-core.js`, shared by the editor (`public/pages/playbooks.js`), the AI builder, the backtester (`src/rotation/engine.js`, kind `playbook`) and the executor (`src/rotation/runner.js`). Every saved change is a version (`user_strategies.versions`), restorable.

## 3. Backtesting and research
- **Existed:** `src/rotation/engine.js` backtest (costs in basis points, SPY buy-and-hold), `src/engine.js` metrics and walk-forward, Reality Check (`src/rotation/reality.js`).
- **Missing:** slippage, a chosen benchmark, Playbook support.
- **Built:** `runBacktest` (costs + slippage, benchmark default SPY): return, CAGR, max drawdown, volatility, Sharpe, equity curve vs benchmark, a walk-forward consistency check over four periods; the saved version's backtest is Reality Check's yardstick.

## 4. Automated execution and rebalancing
- **Existed:** `runAuto` (strategies at a run time, claim per day), `execute` through `placeOrder`, the approval mode, the market calendar (`src/market-calendar.js`).
- **Missing:** a run tied to each day's real close (early closes), expiry of missed runs with a notification, step-up for real-money deployment.
- **Built:** `runPlaybooks` (scheduler): 20 minutes before the close (13:00 on early-close days), skipped on holidays, claimed once per day, never within 5 minutes of the close; a missed day is recorded as expired and the user is notified. Orders go through `runner.execute` → `placeOrder`. Real-money deploy, resume and close need step-up; paper first. Copies of ready-made or shared Playbooks follow real accounts by approval unless the business runs in adviser mode (same rule as the ready-made strategies).

## 5. Trade preview
- **Built:** `GET /api/playbooks/:id/preview`: current and target allocation, dollars and share changes from live prices, the conditions that decided it, labelled an estimate.

## 6. Playbook history
- **Existed:** `strategy_runs` log.
- **Built:** every run logs trades, holding changes (results) and the conditions that triggered them (trace); skipped, failed, expired runs and overrides are logged with the reason. `GET /api/playbooks/:id/history`.

## 7. Community library
- **Existed:** publishing and copying library strategies (`/api/library/community`), AI bot marketplace.
- **Built:** `GET /api/playbooks/library` (sort by newest, CAGR, drawdown, Sharpe, name), backtest any entry, copy (independent), publish (needs a backtest of the current version). Seeded only with Brightolio's blueprints (with their example tickers) converted to Playbooks; the original strategies stay owner-only. Reports (3 reports from different people hide an entry) and moderation for admins. No invented community entries or counts.

## 8. Guided discovery
- **Built:** `POST /api/playbooks/discover`: goal, risk tolerance, time horizon → up to 3 library Playbooks whose backtested drawdown fits, with a plain explanation each, framed as education with the risk disclosure.

## 9. Manual override
- **Built:** pause and close all (immediate), resume, skip the next rebalance, edit, swap an asset (next run); all logged.

## 10. Account types
- **Existed:** `ACCOUNT_TYPES` (taxable, Traditional, Roth, Rollover, SEP IRA) as a per-account tax label in settings (`accountTax`).
- **Built:** business account types (LLC, partnership, family office) with entity name and type (`accountEntity` setting), offered only where the connected broker supports them (`BROKER_SUPPORT` in `src/retirement.js`).

### Broker support for account types (what Brightolio offers, per broker)
| Broker | Taxable | IRA types | Business (LLC, partnership, family office) | Notes |
|---|---|---|---|---|
| Practice (paper) | Yes | Yes (label only) | Yes (label only) | Pretend money; the type only changes tax estimates. |
| Alpaca (Trading API keys) | Yes | Label only (an IRA you already hold) | No | Entity accounts are not offered until confirmed for the connected account. |
| Alpaca (Broker API, accounts opened through Brightolio) | Yes | Label only | No | Business types only after the owner enables them (`BROKER_ACCOUNT_TYPES`). |
| Other connected brokerages | Yes | Label only, when the user's own account at that broker is an IRA | No | The type labels an account the user already holds; Brightolio does not open it. |

## 11. REST API for developers
- **Existed:** personal tokens for AI agents (`api_tokens`, `src/mcp.js`).
- **Built:** `/api/v1` with personal API keys created in Settings → Developer API (hashed, scopes `read` (default), `write`, `trade`; per-key rate limit; revocation). Playbooks (list, create, update, backtest, deploy, pause), history, previews, accounts. Orders go through the same `placeOrder` path and guards; real-money actions are refused over the API (the website's step-up is required). OpenAPI spec at `/openapi.json`, docs at `/developers`.

## Final status (2026-11-17)
All eleven features are built with unit tests (test/playbooks.test.js, test/apiv1.test.js) and e2e flows (test/e2e/run.mjs: Playbooks editor/AI/backtest/deploy/preview/overrides/history; library and discovery; Developer API key; business account type). Local gates: npm test 389/0, npm run e2e 444 checks passed, security-check and clean-check passed.
Not live yet: GitHub refused every push from this session (403, the Claude GitHub App has no access to the repository for this organization), so nothing in this round is on main or deployed, and Check 1/Check 2 have not run on GitHub.
