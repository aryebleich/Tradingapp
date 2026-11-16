# DECISIONS.md

> **Update 2026-11-16:** the feature flag system was removed and the flagged features are permanently on (CHANGELOG_AI.md). Rows below that mention a flag describe the earlier design.

## AI team Chat (branch `feature/ai-team-chat`)

| # | Decision | Reason |
|---|---|---|
| C-1 | Stack as found: Express 5, libSQL (SQL in `src/db.js` `MIGRATIONS`), vanilla-JS pages under `public/pages/`, admin pages under `#/admin-*`, the AI team at Admin → AI team (`#/admin-agents`, `src/aiteam.js`). | Match the existing code. |
| C-2 | The Chat is a **new job type next to** the AI team's task jobs, not a change to them: new tables, new routes (`/api/admin/aichat/*`), a new page (`#/admin-aichat`). The only touch to the AI team page is a "Chat" card that appears when the server allows it. `ai_team_jobs` and `runJob` are untouched. | Rule 4. |
| C-3 | **Permission.** The app has no per-admin permissions, so a new one is added: "AI team chat". The owner always has it; other admins only when the owner grants it (`PUT /api/admin/aichat/access`). Checked on the server on every request: non-admins get 403 from the existing admin guard, admins without the permission get 403 from the chat router. | Rule 1 without changing core auth. |
| C-4 | **Flag** `ai_team_chat` in the existing flag system, **off**. Off: every chat route answers 404 (after the 403 checks), the card is not shown. | Rule 5. |
| C-5 | **Models**: the providers already configured in `src/llm.js` (Claude via the Anthropic SDK already in `package.json`, and the OpenAI-compatible Gemini / Groq / OpenRouter / custom). A model appears only if it has a key, is listed in `src/aichat/config.json` `models`, and, if `adminModels` names the admin, is in their list. | "Use the provider already configured"; "limited to models the admin is allowed to use". |
| C-6 | **Thinking**: on Claude (claude-opus-5-5) with `thinking: { type: "adaptive", display: "summarized" }` (checked against the bundled Claude API reference); the summarised thinking streams separately. Other providers have no thinking: the control is hidden. | "If the model supports extended thinking, enable it". |
| C-7 | **Streaming**: server-sent events over the POST response (`start`, `thinking`, `thinking_done`, `text`, `done`, `error`), read with a streaming `fetch`. Stop = the browser aborts the request (the server sees the closed connection and aborts the model call), plus `POST /messages/:id/stop`. | A POST body is needed, which `EventSource` cannot send. |
| C-8 | **Status values**: `streaming` while writing, then `complete`, `stopped` or `error`. Partial text is saved about every second and kept on stop or error. | Requirement; nothing is lost if the server restarts mid-reply. |
| C-9 | **Retry / regenerate** replace the last assistant reply. **Editing** an earlier user message makes a **new conversation** (a branch) holding everything before it, titled "… (edited)"; the original stays unchanged. | Simplest branching that never loses history. |
| C-10 | **Storage**: `ai_chat_conversations` (id UUID, owner, title, model, times), `ai_chat_messages` (role, content, status, model, input/output tokens, times), `ai_chat_thinking` (message id, thinking text, duration), kept apart so it can be deleted on its own (`DELETE /conversations/:id/thinking`). Thinking is never in `content` or in "Copy". | Requirement 5. |
| C-11 | **Retention**: 90 days since a conversation was last used (`retentionDays` in the config); purged at most hourly while the chat is used. | Requirement default. |
| C-12 | **System prompt** lives in `src/aichat/config.json`, read by the server only; it is never sent to the browser (tested). Changing it means editing the file and redeploying. | Requirement 6. |
| C-13 | **Limits**: 10 messages per minute per admin (in memory), 300,000 tokens per admin per UTC day (input + output from the provider's usage, or a four-characters-per-token estimate when it reports none). At the limit: 429 with the reset time. | Defaults in the config. |
| C-14 | **History sent to the model**: the last 40 messages; failed or empty replies are skipped and neighbouring messages of the same role are joined. | Keeps requests valid for the provider and within size. |
| C-15 | **Markdown**: a new small renderer (`public/pages/chatmd.js`, ~110 lines) that escapes everything first and emits a fixed set of tags; links only http(s)/mailto, `target="_blank" rel="noopener noreferrer"`; simple highlighting for JS/TS/JSON, Python, shell and SQL. An unclosed code fence renders as a code block so streaming does not jump. The existing studio renderer was not reused (no tables or fences, depends on page state). | Rule 3 without a dependency. |
| C-16 | **No new dependency.** | Rule in the brief. |
| C-17 | **Logs**: one JSON line per failure with conversation id, message id, model and error code; never message or thinking text (tested). | Requirement 6. |
| C-18 | **Test model**: a scripted model (`fake`, `fake-plain`) exists only when `NODE_ENV=test` and `AI_CHAT_FAKE_MODEL` are both set, for the tests. It cannot appear in production. | Tests without a real AI service. |
| C-19 | The chat opens as a new conversation; earlier ones are in the list. On phones (≤ 860 px) the list is a drawer. | Predictable start; mobile requirement. |
| C-20 | **Accessibility**: polite live region for "replying / complete / stopped / interrupted" (not tokens); `<details>` for the thinking block (keyboard and screen-reader native, collapsed by default); focus moves to Stop while streaming, to Retry after an error, into the drawer when it opens and back when it closes; cursor and pulse stop under reduced motion. | WCAG 2.2 AA. |
| C-21 | Work is on branch `feature/ai-team-chat`; nothing merged or deployed. | Rule 6. |

Choices and assumptions made without asking, with the reason. Trading-tools work on branch `feature/trading-tools`.

| # | Decision | Reason |
|---|---|---|
| D-1 | Stack is Express 5, Node 22, libSQL, a vanilla-JS single-page app; users are retail traders and investors (equities, ETFs, options, crypto) on Alpaca accounts, with paper trading as the default. | Read from `package.json`, `server.js`, the menu and the brokerage code. |
| D-2 | "Staging" is the feature branch plus a separate staging service (DECISIONS D-6, release package). Nothing is merged to `main` (which deploys to production) and nothing is deployed. | There is no staging environment in the repository; `main` auto-deploys. |
| D-3 | **No competitor comparison.** The gap table compares with the standard tool categories listed in the brief and names no competitor. | Rule 4: competitor claims must be verified against public sources and cited; public documentation could not be fetched from this environment, so the comparison is left out rather than guessed. |
| D-4 | Built: position size, risk / reward with ATR stop, sector heatmap, two AI explainers. Not built: economic calendar (no release-dates data source; dates must not be invented), guardrails on the existing AI tools (they are existing features; changing them is outside "new tools" and needs review). | Highest-value gaps that need no new data source and touch no order, margin or account logic. |
| D-5 | One flag per tool (`tools_sizing`, `tools_rr`, `tools_heatmap`, `ai_portfolio_explainer`, `ai_indicator_explainer`) in the existing flag system, all off. A tool that is off answers 404; the menu entry appears only when at least one is on for the user. | Rule: behind flags, default off; independent rollout and rollback per tool. |
| D-6 | "Internal users first" happens on staging (flags at 100% there). In production the existing flag system rolls out by percentage of user ids; it cannot target named people. | Adding role targeting would change the flag system shared by other features. |
| D-7 | Read-only only: user-typed numbers, daily bars (`dailyBars`), Alpaca snapshots, and the existing read-only positions endpoint for "Fill from my positions". No order, draft order, margin, balance or auth code is touched. | Hard rule 1. No order-placing module was needed. |
| D-8 | Data labels: Alpaca IEX feed = "one exchange, can differ"; SIP = consolidated; no market data = delayed / end-of-day (heatmap off). Each price shows its age. | Rule: a clear data-delay indicator. The feed setting (`ALPACA_STOCK_FEED`) decides the wording; nothing is assumed live. |
| D-9 | Sector heatmap uses the eleven Select Sector SPDR funds as proxies for S&P 500 sectors. | A fixed, public list of tickers; their prices come from the feed. |
| D-10 | AI tools explain facts the server computed; the AI never sees raw account data unless Admin → AI & privacy allows account data for that provider (`mayShareAccount`); otherwise a rule-based explanation is used and labelled "written from fixed rules, not by AI". | Rule 2 and the existing privacy setting. |
| D-11 | The advice filter is deterministic regular expressions on the question and on the answer (and key points, and the rule-based text), plus a strict system prompt. | Transparent, testable, no extra service. Its limit (new phrasings can slip through) is handled by the compliance log, the kill switch, staged rollout and a growing adversarial test set. |
| D-12 | Compliance log stores a keyed hash of the user, the redacted question and answer, outcome, reason, model, time; never holdings or balances. Retention `AI_LOG_RETENTION_DAYS`, default 1,095 days (3 years). | "Log for compliance review without storing personal financial data beyond what is needed." Three years is a placeholder for the firm's record-keeping rule [PLACEHOLDER: retention period from legal]. |
| D-13 | Kill switch: `AI_TOOLS_KILL` (env) and an admin switch per tool or "all", both checked on every request. | Rule: server-side, immediate. |
| D-14 | Analytics use the existing `count(kind, key)` schema: `tool`, `ai_tool`, `ai_latency`; page views come from existing route tracking. | Rule 6: existing schema, no new tracker. |
| D-15 | Disclaimer component on every tab; copy states what the tool does, that it is not advice or an order, and that capital is at risk. No superlatives or promises in any copy. | Rules 2 and 3. |
| D-16 | Accessibility checked with Playwright scripts (labels, names, unique ids, table headers, disclaimer role, 24 px targets, keyboard flow, live region, phone width, light and dark), not an axe dependency. Heatmap direction is shown with ▲ / ▼ and numbers, not colour alone. | WCAG 2.2 AA without a new dependency; a manual screen-reader pass is still on the checklist. |
| D-17 | **No new dependency.** | Rule 8. Everything uses existing modules (`ta.js`, `llm.js`, `aiaccess.js`, `alpaca/data.js`). |
| D-18 | Rate limits: 120 requests per 10 minutes per user per tool. | Protects the data and AI providers; generous for a person. |
| D-19 | Position sizes round down to whole lots with a tiny tolerance (1e-9) so floating-point results like 9.999999999 count as 10. | Shown by a test; never rounds up past the risk budget. |
| D-20 | Backtests and simulations: none were added. The tools only calculate from user inputs and read-only prices. | Rule 5 needs no new handling here. |

## Scheduled trades (2026-11-16)

- S-1: US market calendar computed from the NYSE rules (holidays, observed days, 13:00 early closes, a list for unscheduled closures) in src/market-calendar.js, so no yearly table needs updating; used by the session checks, repeats, "before the close", "next open" and the date picker.
- S-2: Every scheduled order has a grace window (default 15 min, shorter for "N minutes before the close"); missed by more, it expires with a note and a notification and is never sent late; a repeating order moves to its next run.
- S-3: The window counts from the order's time, or from the next open when the market is closed then, so an order timed before the open runs at the open (as before) and is not treated as late.
- S-4: "At the close" and "at the next open" use Alpaca's closing and opening auction orders (time in force cls / opg, whole shares, sent 30 and 50 minutes ahead, before the 15:50 and 9:28 cut-offs taken from Alpaca's order documentation as known; the docs could not be fetched from this environment). Paper and other brokers have no auction order: the review screen says so and a timed market order is sent instead.
- S-5: The existing test that ran a 10-day-late scheduled order now uses an order 5 minutes late: the double-run assertion is unchanged, and sending a 10-day-late order is exactly what the new rule forbids (covered by test/schedule.test.js).
- S-6: POST /schedule on any account other than the practice account goes through stepUpGuard, the same check as /orders.
- S-7: The calendar endpoint is /api/trading-calendar (the /api/market router requires sign-in; the calendar is public data).
## Deploys

- D-1 (2026-11-16): released flag removal, permanent layout layer, Chat, planning tools, AI explainers, comms drawer for users with a number, previous homepage kept, post-deploy smoke/rollback workflows; merge commit f392309; gates npm test 354/0, e2e 435 exit 0, security:check 0; no revert. The page-snapshot gate still flags Admin → SEO (Feature flags card gone) and the owner to-do list (flag steps gone): intentional, snapshot update for those two pages left for the owner.
