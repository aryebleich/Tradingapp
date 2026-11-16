# AI team Chat

> **Update 2026-11-16: the feature flag system was removed** (CHANGELOG_AI.md). Wherever this page mentions a flag, read it as the feature being permanently on. The Chat is on for every admin who has the AI team chat permission; there is no site-wide switch.

Admin → AI team → **Chat**: a normal back-and-forth conversation with the AI team's model. No flag;
**off**. Branch `feature/ai-team-chat`. Decisions: [DECISIONS.md](../DECISIONS.md), section "AI team Chat".

## Architecture

```
Admin → AI team page (Chat card, shown only if /api/admin/aichat/status answers 200)
   └─ #/admin-aichat  public/pages/aichat.js  (+ chatmd.js renderer, aichat.css)
        │  fetch POST …/conversations/:id/messages   → server-sent events: start · thinking · thinking_done · text · done | error
        ▼
server.js  api.use('/admin', requireUser, requireAdmin)  → 403 for non-admins
   └─ /api/admin/aichat  src/aichat/routes.js   → 403 without the AI team chat permission
        └─ src/aichat/engine.js  permission · models · token budget · streaming (Anthropic SDK with adaptive thinking;
                                 OpenAI-compatible SSE for Gemini/Groq/OpenRouter) · storage · retention
           src/aichat/config.json  system prompt, allowed models, limits, retention (server only)
libSQL: ai_chat_conversations · ai_chat_messages · ai_chat_thinking
```

Endpoints (all under `/api/admin/aichat`): `GET /status`, `GET/POST /conversations`, `GET/PATCH/DELETE /conversations/:id`,
`DELETE /conversations/:id/thinking`, `POST /conversations/:id/messages` (stream), `POST /conversations/:id/regenerate`
(stream; also Retry), `POST /conversations/:id/branch`, `POST /messages/:id/stop`, `GET/PUT /access` (owner only).

## Database migration (runs automatically at start, `src/db.js` MIGRATIONS)

```sql
CREATE TABLE IF NOT EXISTS ai_chat_conversations (id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ai_chat_conversations_owner ON ai_chat_conversations (owner_id, updated_at);
CREATE TABLE IF NOT EXISTS ai_chat_messages (id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES ai_chat_conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL, model TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ai_chat_messages_conv ON ai_chat_messages (conversation_id, id);
CREATE TABLE IF NOT EXISTS ai_chat_thinking (message_id INTEGER PRIMARY KEY REFERENCES ai_chat_messages(id) ON DELETE CASCADE, content TEXT NOT NULL, duration_ms INTEGER);
```
Rollback of the schema: `DROP TABLE ai_chat_thinking; DROP TABLE ai_chat_messages; DROP TABLE ai_chat_conversations;`

## Tests

| Suite | Command | Result |
|---|---|---|
| Whole app (unit + integration) | `npm test` | 285 passed, 0 failed, 3 todo (older review items) |
| Chat: 21 XSS payloads, markdown, partial markdown, token budget, permission, 403 / 404, streaming completes, thinking kept apart, stop (connection closed and Stop endpoint) records "stopped" with partial text, mid-stream error with retry, regenerate, branch, rename, delete thinking, delete, ownership, budget 429, validation, retention, no content in logs | `test/aichat.test.js` (in `npm test`) | 18 passed |
| Browser: flag on/off, Enter / Shift+Enter, streaming cursor, live region (status only), markdown, thinking collapse / expand by keyboard, copy (answer, thinking, code), model without thinking, autoscroll stops when scrolled up, Stop, reduced motion, error + Retry, regenerate, edit to branch, rename / delete, accessibility rules, phone drawer, non-admin 403 | `npm run aichat:ui` | all 19 checks passed |

Not tested: a real Claude / Gemini stream (the scripted test model is used), a hands-on screen-reader pass.

## Staging deployment

1. Deploy branch `feature/ai-team-chat` to a **staging** service with its own database, `NODE_ENV=production`,
   `ENCRYPTION_KEY`, and `ANTHROPIC_API_KEY` (or another AI key) in its environment. Do not set `AI_CHAT_FAKE_MODEL`.
2. Sign in as the owner on staging.
3. Optional: grant another admin: `PUT /api/admin/aichat/access {"email":"…","allowed":true}` (owner session).
4. Run the smoke test.

## Smoke test (staging)

- [ ] A non-admin → 403 on `/api/admin/aichat/status`; an admin without the permission → 403.
- [ ] The Chat card opens the chat; the model list shows only providers with keys.
- [ ] Send "Write a table of three fruits and a JavaScript function": text streams with a cursor; the table and highlighted code render; **Thinking** appears collapsed with a duration (Claude only).
- [ ] Copy copies the answer without the thinking; Copy thinking copies only the thinking; Copy code copies only the code.
- [ ] Ask for a long answer, press Stop: it stops at once, shows "Stopped", the text so far stays after a reload.
- [ ] Regenerate replaces the last answer; Edit an earlier message → a new "(edited)" conversation appears, the original is unchanged.
- [ ] Rename and delete a conversation; reload: the changes stayed.
- [ ] Switch to a non-Claude model (if configured): no Thinking control, layout unchanged.
- [ ] Server log: errors show ids and codes only.

## Manual checklist (staging, by a person)

- [ ] Keyboard only: reach every control; Enter sends, Shift+Enter makes a new line; Escape closes the drawer and the rename box.
- [ ] Screen reader (VoiceOver or NVDA): new replies are announced as "replying…" and "complete", not word by word; the Thinking block reads as a collapsed disclosure.
- [ ] Phone (≤ 390 px): the conversation list opens as a drawer; nothing scrolls sideways; buttons are easy to tap.
- [ ] Reduced motion on: the cursor does not blink, the drawer does not slide.
- [ ] Dark theme: text, code colours and buttons are readable.
- [ ] Try `<script>alert(1)</script>`, `[x](javascript:alert(1))` and `<img src=x onerror=alert(1)>` in a message and ask the model to repeat them: they show as text.
- [ ] Use up the budget on staging (lower `dailyTokenBudget` in the config there): a clear message with the reset time.
- [ ] Remove an admin's permission (Admin → AI team): their chat access stops at once; their conversations are kept.

## Rollback

Switch `ai_team_chat` off (takes effect on the next request). To remove the code, revert the merge commit; the three
tables can stay (unused) or be dropped as above.
