# CHANGELOG_AI.md

One entry per task: what changed, why, test results, release tag, rollback. Newest first.

---

## 2026-11-26: Codex, stock-card precomputation (PERF-01)

- Reused the database cache to share precomputed stock cards across request workers. The active leader starts with four symbols from the existing large-stock universe and pauses warmup during load shedding.
- Stock-card, route and load-shedding fixture tests passed. No release tag. The isolated commit can be reverted if needed.

## 2026-11-25: Codex in Admin AI Chat

- Added an explicit Codex model using the existing OpenAI key and Responses streaming. It uses the existing chat permissions and leaves Auto's provider routing as before.
- Verified with a local OpenAI fixture. No release tag. Revert the task commit to remove the option.


## 2026-11-25: Claude Code and Codex handoff

- Added the shared contributor instructions, Claude Code entry point, and the checkpoint and task queue in [AI_HANDOFF.md](AI_HANDOFF.md).
- Reviewed the published history and GitHub checks. Documentation only. Release tag and deployment rollback do not apply.

## 2026-11-25: Leaving Render (what was done)

- **DNS**: issue #55 gives the exact record (A `app` → 138.2.233.183, DNS only) and says to remove the old CNAME to onrender.com. `dns-cutover.yml` checks every 10 minutes and closes the issue when https://app.brightolio.com/healthz answers from the Oracle server (`host: oracle`, no Render header). /healthz now names the host.
- **Removed from the app**: the Render API key sync (src/site.js) and its Admin routes (push, pull, deploy); the Render plans and the "render" upgrade kind (src/upgrades.js) with their Admin tab; the "Keys sync with Render" setup check; RENDER_API_KEY and RENDER_SERVICE_ID from the key catalogue, the setup tasks, the key store and the settings groups; every RENDER_EXTERNAL_URL / RENDER_EXTERNAL_HOSTNAME / RENDER_GIT_COMMIT fallback; the forwarder import at the top of server.js; Render wording in Admin → Hosting, the edge setup, the readme generators, the Yiddish strings and the docs.
- **Build info**: the commit is built into the image (`GIT_COMMIT`, a docker build argument passed by deploy/vm/update.sh), which also deletes the old RENDER_GIT_COMMIT line from the server .env.
- **PUBLIC_URL** is required in production: without it (or with a non-https or path value) the app stops at start with the reason (src/origin.js missingPublicUrl).
- **Jobs**: no "render" host. thisHost() is HOST_ID ("local" in development, "unknown" in production without it). In production a server without HOST_ID never runs jobs; with nothing configured in Admin → Hosting only the Oracle server (HOST_ID=oracle) does; otherwise only the configured active server.
- **A hosted server without a lasting disk** is now `REQUIRE_HOSTED_DB=1`, not the presence of a RENDER variable.
- **Workflows**: render-redirect.yml deleted; android, pages and post-deploy use https://app.brightolio.com unless APP_URL is a brightolio.com address; the Render comments in deploy, scheduler, security and oracle are gone; the temporary render-diagnose step was removed after its findings were written down.
- **Kept until the DNS change**: render.yaml and src/render-redirect.js (Render deploys every push, and while the domain still points at Render they are what keeps the site up). The app does not load them; the test allows only that file and says why.
- **Docs**: MIGRATION_ORACLE.md describes the current state and a "Leaving Render" section with the owner steps; the guide as it stood during the move is in docs/archive/MIGRATION_ORACLE-render-era.md.
- **Tests**: test/no-render.test.js (7: no Render as a host in src, server.js, public or .github; the forwarder is not loaded; jobs only on the named active server; production without HOST_ID never active; PUBLIC_URL required, and the app refuses to start without it). Updated: batch9 (no Render plan), batch18 and edge (no "render" server kind), health and oracle (REQUIRE_HOSTED_DB), origin (no Render host name), owner (no Render sync routes).
- **Not possible from here**: changing the DNS, removing the custom domain on Render and suspending the service (no Cloudflare or Render API key exists). The owner steps are in issue #55 and MIGRATION_ORACLE.md.

---

## 2026-11-25: Leaving Render (findings, before any change)

From the read-only ops step `render-diagnose` (run 45644272391) and a search of the repository:

- **DNS:** the brightolio.com zone is on Cloudflare (name servers melinda/harlan.ns.cloudflare.com). app.brightolio.com is proxied by Cloudflare (104.21.94.31, 172.67.218.253 and two IPv6 addresses) with **Render as the origin** (header x-render-origin-server: Render): app.brightolio.com → Cloudflare → Render → Oracle. brightolio.com and www.brightolio.com have no A, AAAA or CNAME record. Render's /healthz says it forwards (forwarding: true, its edge secret set).
- **Keys:** no RENDER_API_KEY anywhere (not in the VM .env, not in the Admin key store, not as a GitHub secret), and no Cloudflare token anywhere (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID absent in all three). So the Render service cannot be read, changed or suspended from here, and the DNS record cannot be changed from here.
- **GitHub:** the secret RENDER_DEPLOY_HOOK_URL is set (RENDER_DEPLOY_HOOK, RENDER_API_KEY and RENDER_SERVICE_ID are not). The repository variable APP_URL is https://quantpocket.onrender.com.
- **The VM:** .env holds RENDER_GIT_COMMIT, which deploy/vm/update.sh writes on every deploy as the running commit. No other RENDER_* setting. PUBLIC_URL is https://app.brightolio.com; APP_DOMAIN and PUBLIC_ORIGINS were set by the last step.
- **What Render still provides:** only the forwarder for the main address (src/render-redirect.js, started by render.yaml). It has no database, no disk and runs no jobs. Settings, jobs, webhooks and files have nothing left on Render to move: the app's settings are on the VM, jobs run on the VM, and webhooks are registered to app.brightolio.com (the brief's list of outside settings is in MIGRATION_ORACLE.md).
- **In the repository:** render.yaml, src/render-redirect.js, .github/workflows/render-redirect.yml; the Render API key sync in src/site.js (renderEnabled, renderEnv, renderPut, renderDeploy, renderService, renderSetPlan) and its ENV_GROUPS/HOST_ONLY entries; RENDER_PLANS and the "render" upgrade kind in src/upgrades.js and its Admin tab; "render" in src/hosting.js (the host kind, thisHost and isActiveHost); RENDER_EXTERNAL_URL, RENDER_EXTERNAL_HOSTNAME and RENDER_GIT_COMMIT fallbacks in server.js, src/origin.js, src/smssignup.js, src/admin-site.js, src/routingcheck.js and src/server-admin.js; RENDER_API_KEY in src/keys-catalog.js, src/setup-tasks.js and src/keystore.js; the "Keys sync with Render" setup check in server.js; src/readme-auto.js and src/readme-overview.js; public/pages/admin-ops.js and public/pages/owner.js; the onrender.com fallbacks in android.yml, pages.yml and post-deploy.yml; deploy/vm/update.sh; scripts/clean-check.mjs; tests; docs.

Decisions:
- The DNS record is changed by hand (issue #55 gives the exact record: A app → 138.2.233.183, DNS only, and remove the old CNAME to onrender.com). The workflow dns-cutover.yml checks every 10 minutes and closes the issue when https://app.brightolio.com/healthz answers from the Oracle server (host "oracle", no Render header).
- **render.yaml and src/render-redirect.js stay until that DNS change is made**, and only those two: Render deploys every push to main, and while the domain still points at Render they are what keeps the site up. Everything else that refers to Render goes now.
- Render's custom domain and the service itself can only be removed and suspended by the owner (no API key): the steps are in issue #55.

---

## 2026-11-25: One address: everything goes to https://app.brightolio.com (what was done)

- **Why visitors ended on sslip**: Render's forwarder (src/render-redirect.js) passed the main address on to the Oracle server only while its trust check was on. While it was off (at start, after a slow or failed check), every main-address request got a 301 to REDIRECT_FALLBACK, the server's sslip address. Fixed: a visitor now gets a "taking longer than usual" page that tries again, the check runs again within a minute, and the server address is only a server-to-server target.
- **Caddy**: the site file is generated by one function (`caddy_site`, the same in setup.sh and migrate.sh): APP_DOMAIN is the site; the server's sslip name and its bare IP redirect GET/HEAD to it, except health, readiness, metrics, /internal, webhooks, sign-in returns, the load test (its header) and forwarded requests (the edge secret). The ops step `caddy-site` writes it and checks it with Caddy before loading it.
- **The app**: the one-address redirect exempts webhook and sign-in paths; a warning on Admin → Hosting when the main address does not reach the server (src/main-address.js).
- **Settings**: setup.sh writes APP_DOMAIN, PUBLIC_URL and PUBLIC_ORIGINS (the app domain and the GitHub Pages origin). The live server: PUBLIC_URL was already https://app.brightolio.com; PUBLIC_ORIGINS was https://aryebleich.github.io only.
- **Workflows**: deploy.yml and scheduler.yml call the server directly (commit checks, internal calls) through a variable named DIRECT, not APP_URL; the visitors' address is app.brightolio.com.
- **Not changed, on purpose**: REDIRECT_FALLBACK stays the server's own address (server to server; pointing it at the app domain would loop through Render). DNS stays as it is (app.brightolio.com → Cloudflare → Render → Oracle), which works; moving it straight to the server needs a Cloudflare token on the server (CLOUDFLARE_API_TOKEN is not in its settings) and is left for an explicit go-ahead.
- **Tests**: test/one-address.test.js (11 tests: the generated Caddy site, the same function in both scripts, APP_DOMAIN as a setting, the retry page instead of a redirect, the Render address, no redirect to the server address, the Oracle redirect and its exemptions, a scan that no file names the server address as the site, the Android address). test/oracle.test.js: the two tests that asserted the old redirect now assert the retry page.

---

## 2026-11-25: One address: app.brightolio.com (findings)

Found with the read-only ops step `address-diagnose` (run 45642114324, commit b4a30f2) and the outside checks in the same run:

- **PUBLIC_URL on the Oracle server is already https://app.brightolio.com.** PUBLIC_ORIGINS is https://aryebleich.github.io only (it lists the origins allowed to call the API, not the site address), so the app domain is not in it.
- **DNS:** app.brightolio.com resolves to Cloudflare (proxied: 172.67.218.253 and 104.21.94.31, with IPv6 addresses). Its origin is **Render** (the response header x-render-origin-server: Render), not the Oracle IP 138.2.233.183. The Oracle server is reached through Render's forwarder.
- **HTTPS:** Caddy's site block is "app.brightolio.com, 138-2-233-183.sslip.io" and holds a valid Let's Encrypt certificate for each name (valid until Feb 2027). From outside, the certificate for app.brightolio.com is Cloudflare's (CN brightolio.com), because the domain is proxied.
- **Outside, now:** https://138-2-233-183.sslip.io/ answers 301 to https://app.brightolio.com/ (the server's redirect works, since its own check of the main address passes: trusted, same process). http://138.2.233.183/ answers 308 to https://138.2.233.183/, which has no certificate, so a visitor who types the IP gets a certificate error. https://app.brightolio.com/ answers 200.
- **Why visitors still end up on sslip (cause):** Render's forwarder (src/render-redirect.js) passes requests for the main address to the Oracle server only while its check says the Oracle server is trusted. The check runs at start (the flag starts as off), then every 5 minutes, with a 15-second timeout. While the flag is off, every main-address request gets a 301 to REDIRECT_FALLBACK, which render.yaml sets to https://138-2-233-183.sslip.io. So any time the check is off (after a restart of Render, a slow answer, or a failed check), visitors are sent to sslip. The Oracle server's own redirect cannot help, because the request never reaches it.
- **The Oracle redirect (server.js, about line 205):** on when PUBLIC_URL is https://app.brightolio.com and the server's own check of the main address returns its boot id (mainReachesUs). Current value: true.
- **Other places that point to sslip:** render.yaml REDIRECT_FALLBACK; src/render-redirect.js FALLBACK default; deploy.yml (two lines) and scheduler.yml fall back to sslip when APP_URL is empty or Render; the repository variable APP_URL is https://quantpocket.onrender.com (the old Render address), so those workflows use sslip; load-test.yml and live-mobile.yml use sslip for direct server checks (kept, named as such); Caddy's site block; .env.example PUBLIC_URL; Admin → Hosting placeholders. The Android app uses the app address through BuildConfig.BASE_URL (checked below). Sign-in links and emails use PUBLIC_URL.
- **Secrets:** ORACLE_ENV is set (presence only). CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are not in the server .env; whether the key store holds them was not checked.

Decision: the visitor path has to stop going to sslip. The forwarder's 301 for an untrusted check becomes a "taking longer than usual" page that retries (never a redirect to sslip), and it checks again within a minute. The forward target stays the Oracle server's direct address (a server-to-server connection, never shown to a visitor): a redirect to app.brightolio.com from the forwarder would loop through Render.

---

## 2026-11-24: Part A (product, money, AI and admin)

### A2: language at Get started
- **Get started** (`public/pages/start.js`): the first screen starts with "Choose your language", one large button per language the app has. The browser's language pre-selects one (`detect()` in `public/i18n.js`).
- **In place, no reload** (`public/i18n.js`): the translator stores each text node's English original, so switching restores it or applies another language at once. Yiddish sets the page to right-to-left immediately.
- **Saved to the account**: `pref:lang` (`src/settings.js`, validated against the list of languages). The saved choice is applied at sign-in (`public/app.js`).
- **Plain-words English** (`en-plain`): offered, switches direction only; its wording is not written yet (see DECISIONS, A-2.5).
- **Not done**: a chooser on the sign-up page.
- **Tests**: `test/language.test.js` (3 tests: detection, direction and the plain entry, the saved list matches the languages the app has).
- **Rollback**: revert the commit; the saved `pref:lang` values are ignored by the old code.

---

### A5: overview and documents
- **Overview**: Admin → README is now labelled Overview (the same encrypted, code-built page; `public/app.js`).
- **Docs**: AUDIT, BUG_REPORT, COPY_CHANGES, DESIGN_DECISIONS, LAYOUT_TEST_RESULTS, NEEDS_REVIEW, PLAN_GROWTH and STRUCTURE_AUDIT moved to `docs/archive/` (git mv); comments updated.
- **Public check**: no server addresses, sslip names, Oracle references or personal emails in the public top-level documents.
- **Not done**: the AI-written public README and the AI rebuild of the overview after each push.

### A6: ranked setup list
- **`src/setup-tasks.js`**: ranks each setting into blocker, revenue, quick win or nice-to-have; statuses done, needs attention, not started; "Do it" links; progress.
- **`server.js`**: `/admin/setup` also returns `ranked`.
- **Admin → Setup** (`public/app.js`): progress bar, ranked list, Oracle wording instead of Render.
- **Tests**: `test/setuptasks.test.js` (6 tests: ranking, statuses, progress, links, no values).
- **Not done**: the setup assistant in the admin AI chat.
- **Rollback**: revert the commit; `ranked` is additive.

---

## 2026-11-24: Admin AI chat: the fix (interrupted replies now explain themselves)

- **Reasons, not "interrupted"** (`src/aichat/failure.js`): each failure names the provider and says what to do: "Gemini refused the key (401). Check GEMINI_API_KEY in Admin → Keys.", "ChatGPT (OpenAI) is over its limit right now (429) (rate_limit_exceeded)…", "took too long to answer (timeout after 60 s)", "had a server error (503)", "The connection to Groq closed during the reply…". OpenAI's own short error code is kept (src/llm.js), never the key and never the user's text.
- **Saved with the reply**: a new column `ai_chat_messages.error`; reopening the conversation shows the same reason. The model that failed is shown under the reply.
- **Auto**: a failing provider is recorded (llm.lastErrors, fed by the chat's streams too) and skipped for a short cool-down (2 min for 429, network and 5xx; 15 min for a refused key). If every provider is cooling down, the best one still answers. When the first model fails before any text, the next one ranked answers, and the reply says "X didn't answer (code); trying the next model" with "Y answered instead".
- **Long answers**: a comment line (": ping") every 15 s while the reply is written; a reply silent for 60 s is stopped and reported as a timeout. A connection that closes during a reply is saved as an error that says so (a Stop request is still "stopped"). The page reads the reply back from the server when the stream drops.
- **Never shed**: /api/admin/aichat and /api/admin/ai/* are critical in src/reliability.js. Caddy already sends /api/admin/* to the leader with flush_interval -1 and no timeout.
- **Test the chat**: Admin → AI button runs the diagnosis for each provider with a key (key shape, models check, one tiny chat request) and shows each result in plain words.
- **Clean-up check fixed**: scripts/clean-check.mjs now follows new URL(…, import.meta.url) and cpu('module') names, and reads deploy/vm scripts. The check had failed on the last push, so the clean-up job was red.
- **Tests**: test/aichat-errors.test.js (15 tests: each failure text, ping, fallback, health, Auto skipping a failing provider, a saved reason after a failed reply, no key or message text in logs, the chat is never shed, a 401 through the streaming path). test/aichat.test.js: the "closing the stream" test now checks the new error message, and a Stop request still gives "stopped"; test/router.test.js: a rate-limited provider is skipped for two minutes instead of only ranked lower.
- **Not verified here**: the live "hello" on Auto and on ChatGPT (needs an admin sign-in on the live site), and whether the OpenAI error code is the rate limit or quota once the new text is live (the diagnosis step shows it after the deploy).

---

## 2026-11-24: Admin AI chat: the interrupted replies (findings)

Found on the live Oracle server with the ops step `aichat-diagnose` (run 45507341549, from commit 5177d93):

- **Which provider answered:** only ChatGPT (OpenAI) has a key on the server. Auto therefore has no other provider to fall back to.
- **The key:** starts "sk-proj-", 164 characters (shape only). Its models endpoint answered in 612 ms, so the key is accepted and the network works.
- **The chat request:** a one-token request to ChatGPT returned HTTP 429 with the rate-limit wording. It was not the "out of credit" (insufficient_quota) case, because that text was not in the answer. The app does not keep OpenAI's error code, so the exact code is still unknown; the fix below keeps it.
- **The failing replies:** the last two assistant replies (23:06:59 and 23:08:23 UTC) were both routed by Auto to ChatGPT ("quick answer") and ended with status error.
- **Why the reason was hidden:** a provider error is sent to the page as the generic "The reply was interrupted" line when its code is "provider" or its status is 500 or more (src/aichat/routes.js). The saved reply kept only status error, so reopening a conversation showed the generic line again.
- **Logs:** the app's stream_failed lines were not found in the last 7 days of container logs, so the cause could not be confirmed from the log lines alone. Those lines now carry the HTTP status and a reason code (commit 1aaef50).
- **Auto health:** a failing stream never updates the provider health used by the router, so Auto can keep choosing a provider that is failing.

Decision: the fix saves the provider, the status, OpenAI's error code and a redacted short message on each failed reply; Auto skips a provider that failed recently and falls back to the next model when the first fails before any text; long waits send a comment every 15 seconds.

---

## 2026-11-24: Admin AI, smart and complete

### Part 1: chat crash fixed, ChatGPT added
- **`src/llm.js`**: OpenAI provider (`OPENAI_API_KEY`, `OPENAI_MODEL` or the newest chat model the key lists), `max_completion_tokens`, no temperature, one retry on a rejected parameter, clear 401 / quota / rate-limit errors, streaming (`openaiStream`), redaction.
- **`src/aichat/engine.js`**: streams OpenAI through `openaiStream`; redacts messages on the compatible-stream path as well.
- **`src/aichat/config.json`**: `openai` added to the chat models.
- **`public/pages/aichat.js`**: no-model state keeps the form and disables it with a link to Admin → Keys; missing elements never throw; /status failure shows the real error with Retry.
- **Tests**: `test/openai.test.js` (8 tests: provider selection, model pick, 401, quota and rate limit, 400 retry, streaming, redaction).
- **Not verified yet**: the no-model page in a browser; the live check.

---

### Part 2: the system picks the best AI (partly)
- **Catalogue** `src/ai/catalog.json`: providers and models, strengths, tiers, member-data rule, price (null = not verified). No keys.
- **Router** `src/ai/router.js`: rule-based need, scoring (fit, tier, cost, free, health, privacy), decisions recorded (last 200), `catalogSummary`.
- **Chat**: Auto is the default; the answer shows the model, the reason and the token count; "Retry with a stronger model"; `routeReason` stored per reply (`ai_chat_messages.route_reason`).
- **Admin → AI → Routing**: rules, privacy per provider, models that answered and how often they finished, recent decisions (`/api/admin/ai/routing`).
- **Tests**: `test/router.test.js` (9 tests); chat tests still pass (18).
- **Not done**: other AI features routed through the router; per-feature fixed models; cost caps; verified prices; i18n and the "i" help panel for these pages.

---

## 2026-11-24: OpenAI: active provider, key checks, and the webhook receiver

- **Keys** (`src/key-format.js`, `src/keystore.js`): prefix checks on save; a one-time move of a misfiled signing secret; warnings on Keys and AI; `OPENAI_WEBHOOK_SECRET` in the catalogue. `src/llm.js` never sends a whsec_ value as the API key.
- **Active provider**: `AI_PROVIDER` in the key store; `/api/admin/ai/active`; Admin → AI card with the selector and a test; "(active)" in the chat menu; the router prefers it where it fits.
- **Webhook**: `src/openai-webhook.js` (signature, dedup, response and batch handling), `src/openai-jobs.js` (OpenAI calls and background jobs), `POST /api/webhooks/openai`, tables `openai_events` and `openai_jobs`, `/api/admin/ai/status`.
- **Chat**: "Run in background" checkbox; background answers finish through the webhook.
- **Tests**: `test/openai-keys.test.js` (8), `test/openai-webhook.test.js` (6), `test/openai-active.test.js` (5).
- **Not verified here**: a real OpenAI test event (needs the live site and the dashboard); the live "hello" in the chat (needs the deployed site).

---

## 2026-11-24: Seven phases

### Phase 1: every key on the Oracle server, managed from Admin
- **Key store** (`src/keystore.js`, table `secrets`):
  - Each value is AES-256-GCM under `ENCRYPTION_KEY`, with the last 4 characters, who changed it and when, and the last test.
  - `secret(name)` reads Admin first, then the server .env.
  - A change works at once in every worker (it is put on `process.env`, and each worker checks a version every 3 s). No restart or redeploy.
  - Removing a key falls back to the .env value.
  - The older saved settings were moved in once.
- **Admin → Keys** (rebuilt):
  - Every key the app knows (`src/keys-catalog.js`, about 90), grouped: AI, brokers, market data, payments, email and SMS, hosting and backups, GitHub, sign-in, other.
  - For each one: what it's for, required, recommended or optional, where it comes from (Admin, the server .env, or missing), the last 4 characters, when it changed and by whom, the last test, and a link to get one.
  - Actions: add, replace, remove, test (a real read-only call to the provider), and "Copy to .env".
  - Search, and an "only missing" filter.
- **Rules**:
  - Admin plus step-up (password, and 2FA when on) for everything.
  - One audit entry and one owner email per change, never with the value.
  - Values never reach a browser: the old export of real values answers 410.
  - `ENCRYPTION_KEY` and host settings can never be stored.
- **"Copy to .env"**:
  - The app leaves an encrypted request on the data volume (`data/.env-request`).
  - `deploy/vm/update.sh` decrypts it inside the container (`scripts/env-request.mjs`) and pipes it into `migrate.sh set-env` with no restart.
- **Backups**: they hold the table, still encrypted. MIGRATION_ORACLE.md now says the same `ENCRYPTION_KEY` is needed to read the keys after a restore.
- **Tests**:
  - `test/keystore.test.js`: the read order, encryption at rest (not in the database file), the refresh across workers, the refused names, admin plus step-up, no value in any answer or the audit log, and the encrypted copy request.
  - Owner, security and Stripe setup tests were updated for the step-up.


## 2026-11-23: One disclaimer, the mobile website and the Android app

### Part 1: one disclaimer, never two
- **Found**: signed-in users saw the disclaimer twice.
  - The page `<footer>` in public/app.html was shown again by layout.css after theme.css had hidden it.
  - The side menu also built its own copy (`.navfoot` in app.js).
  - The sign-up page repeated part of it ("Brightolio is software, not a broker… Trading involves risk of loss").
- **Now**: the app.html footer is the only copy, for signed-in and signed-out users, desktop and phone.
  - The wording, the four links and `#siteVer` are unchanged.
  - The menu copy and its CSS are gone.
  - The sign-up page keeps its links (risk disclosure, security) without the repeated sentence.
  - Every footer rule is in layout.css. It is hidden in popouts and sits above the tab bar with room for the safe area.
  - The marketing site's `footer.site` is untouched.
- **Guards**:
  - `test/footer.test.js` fails on any second copy in the app sources, or on footer rules outside layout.css.
  - `test/e2e/mobile.mjs` counts the disclaimer on every page, signed in and out, in English and Yiddish (hidden copies count too).

### Part 2: the mobile website
The new mobile suite (`npm run e2e:mobile`, its own job in e2e.yml) covers:
- every menu page, signed out and in (76 pages);
- 360, 375, 390, 393 and 414 px portrait, and 740 px landscape;
- dark mode and Yiddish (right to left) on two phones;
- a screenshot of each page.

It fails on:
- sideways overflow;
- a second (or missing) disclaimer;
- the footer under the tab bar;
- fields under 16 px;
- app buttons under 44 px;
- dialogs that can't scroll.

Phone flows: sign up, add a passkey, sign out from the menu, sign in by password, sign in by passkey, the menu closing after a tap, the order ticket and its review, equalize with its checkboxes, alerts, Playbooks, settings, admin.

Before (first run, 4 variants): 879 failures. What they were:
- Every signed-in page had 2 disclaimers.
- The header ran off the right edge at 375 px: the search and theme buttons were cut off, and the owner's "View as" picker squeezed everything (`docs/screens/before-dashboard-top.png`, `before-trade-top.png`).
- The header buttons (34–36 px) and the menu group buttons were under 44 px.
- The "View as" field was 14 px (iOS zooms in).

The second run added landscape at 740 px and found:
- The phone rules stopped at 640 px wide, so a phone held sideways had small buttons and 49 fields under 16 px.
- The flows found the "Whole shares only" checkbox row was 17 px tall.
- The background-loading card ("0%") covered the open side menu (`before-menu-bottom.png`).

Fixes (public/layout.css):
- On phones and all touch screens, the header, tab bar, menu, the page title's "i" and gear, and the page tabs are 44 px.
- On phones the header buttons are icons only. The connection badge leaves the header unless it says LIVE (real money), and "View as" shows only while in use.
- Touch screens get 16 px fields at any width, and 44 px checkbox rows.
- The loading card sits above the tab bar and under the menu.
- Page content keeps the theme's sizes (D-13).

After: **PASS** on all 76 pages × 10 variants (550 s) and all phone flows. No page is wider than the screen on any phone (none was before either).

Screenshots at 375 px, in `docs/screens/`:
- before: `before-menu-bottom.png` (the second disclaimer and the loading card over the menu), `before-dashboard-top.png`, `before-trade-top.png` (the header cut off), `before-dashboard-bottom.png`;
- after: `after-menu-bottom.png`, `after-dashboard-top.png`, `after-trade-top.png`, `after-dashboard-bottom.png` (one disclaimer, above the tab bar).

**Speed (Lighthouse mobile, slow 4G emulation, median of 3, production mode, local):**

| Page | Before (perf / a11y / best practices) | After |
|---|---|---|
| Sign-in | 94 / 100 / 100 | **95 / 100 / 100** |
| Dashboard | 88–89 / 100 / 100 | **90 / 100 / 100** |
| Trade | 92–93 / 97 / 100 | 94 / 97 / 100 |
| Home (marketing) | 80*–98 / 100 / 100 | 98 / 100 / 100 |

\* That run overlapped the mobile suite.

The worst problems on the dashboard were:
- three unminified stylesheets blocking the first paint;
- a layout shift (0.074) when the header and side menu appeared after start.

Now:
- The three stylesheets are one minified bundle, 137 KB instead of 170 KB, hashed and cached for a year.
- A page request that carries a session cookie gets `html.was-in`, so the header and menu hold their place from the first paint.
- The JS was already one bundle, and images already have sizes.

Fixed along the way: the "i" help button now joins a page title as soon as it is drawn. Research and Compare showed it only after their data loaded, which took over 8 s on a slow runner. That made the end-to-end run fail (`test/page-help.test.js`), including on the commit before this work.

The golden page gate (`test/layout/gate.sh`) fails with the same counts before and after this work: 248 disclosures, 108 figures, 468 controls, 3 axe. That's older drift in the marketing and admin pages against the committed baseline. The only effect of this work is 8 px (the 44 px header) in the "moved further down" entries.

### Part 3: the Android app
- **Address**: the `APP_URL` repository variable is still `https://quantpocket.onrender.com`, the old Render address.
  - The app's own default was that address too, and the workflow fell back to the raw server address.
  - Now the app uses `https://app.brightolio.com` when the variable is empty, Render, or sslip.
  - The build log says "The app talks to: https://app.brightolio.com".
- **API**: every call the app makes still exists on the Oracle server: auth me, login, mfa, logout and app-exchange; accounts; account; desk quote; orders; quote. The session cookie `qp_sid` matches.
- **Busy server**: a 503 with `shed` is retried quietly up to 3 times, like the website (Retry-After, at most 8 s, a little longer each time). Then it shows "This is taking longer than usual. Trying again…" with Try again. A refused call never ran, so retrying an order is safe.
- **Legal**: the disclaimer and Terms, Privacy, Risk Disclosure, Support appear once, on More under About, in the site's exact wording. Before it was a different sentence. A unit test compares it with app.html's footer.
- **Phone fit**:
  - edge to edge (required from Android 15), with system-bar, cutout and keyboard insets on every screen;
  - Back returns to Home before it leaves the app, and cancels the two-factor step;
  - order chips wrap at large font sizes (200%);
  - one-line tab labels;
  - Try again when there is no connection;
  - dark mode follows the system as before.
- **Build**: android.yml run 9 succeeded. `testReleaseUnitTest` passed, then the APK and bundle were built.
  - Google Play upload now happens only when the workflow is run by hand with "Upload to Google Play" ticked; nothing was published.
  - `ANDROID_KEY_PASSWORD` is not set, so each build is signed with a one-time key, and phones cannot update in place until it is set.

### Tests
- `npm test`: 503 pass, 0 fail (3 TODOs as before).
- Mobile suite: PASS.
- Android unit tests: pass.
- Lighthouse: no score dropped.

### Live check
`.github/workflows/live-mobile.yml` runs the mobile suite read-only against https://app.brightolio.com:
- It never creates an account.
- It signs in only with the optional `SMOKE_EMAIL`/`SMOKE_PASSWORD` test account, otherwise it checks the signed-out pages.
- Its result is below.

**First live run (signed out, 10 phone variants): 5 failures.**
- Fields under 16 px in landscape.
- Two disclaimers on the Yiddish sign-up page.

Both were already fixed in the code. The live site was simply not running it:
- The bundle it served (`app-UDOYYFOW.js`) and its file hash (`8f9ba3c4c5`) are exactly those of commit 0da9c9d, from before this work.
- On the server, `brightfolio:new` held each new build, but `brightfolio:latest` (what runs) was 2 hours old.

**The cause**:
- After each deploy, "Verify live site" smoke-tests `APP_URL`. That variable is still the Render address, so it fell back to the server's direct address (`…sslip.io`).
- The server answers pages on that address with a 301 to app.brightolio.com, so 10 of 14 checks failed every time.
- The workflow then rolled the server back to `brightfolio:previous`, which was always the same old image.
- This happened on every release, all day, while the deploy log said "Deployed". The same loop explains the 4-hour-old image found during the load-shedding work.

**Fixed (327ac17, 84391b6)**:
- post-deploy.yml and pages.yml use https://app.brightolio.com when `APP_URL` is empty, Render, or the direct address. deploy.yml and the scheduler keep the direct address, since they only call `/healthz` and `/internal`, which are never redirected.
- If the previous version fails the same smoke test, the release is not the cause: the new version goes back in and the run fails for a person to look at.
- The smoke test accepts the bundled stylesheet (it looked for `layout.css`), and checks the disclaimer appears once.

Also learned from the diagnosis:
- The `APP_URL` repository variable should be set to https://app.brightolio.com (it can only be changed in the repository settings).
- `ANDROID_KEY_PASSWORD` is not set.

**After the fix (2026-11-24)**:
- "Verify live site" run 66 passed: the smoke test on https://app.brightolio.com and the 15-minute watch, with no rollback.
- The live site serves build 925cc24: the stylesheet bundle `app-ae912fae44.css` and `app-3MEBOB57.js`, matching the current source.
- "Live site on phones" run 12 is a **PASS**: the signed-out pages on all 10 phone variants, light and dark, English and Yiddish. One disclaimer at the bottom, nothing wider than the screen, no field under 16 px.

Also fixed: the early "i" no longer reaches the hidden copy that a same-page redraw builds, which briefly showed two on Compare (400efe5).

---

## 2026-11-23: "The market is very busy" on every page: the cause, then the fix

### Findings on the live server (before any change; oracle-migrate diagnose-load runs 45248546870 and 45249014849)

| | 19:24 UTC, app up since 17:34 | 19:25, right after a restart |
|---|---|---|
| load (worst of the three parts) | **1.0, constant** (three samples 3 s apart) | 0.07 |
| heap in use / limit used by load() | **941 MB / 450 MB** (= 2.09, capped at 1) | 31 MB |
| V8's real heap limit (heap_size_limit) | 1048 MB (no --max-old-space-size set) | 1048 MB |
| event-loop delay p99 | 21 ms (limit 500 ms) | 21 ms |
| requests in flight | 3 of 200 | 1 |
| refused (shed) | 42 of 572 requests; 374 background jobs skipped | 0 |
| container memory | (not sampled before the restart) | 187 MB of 2 GB |
| database file | **553 MB**, of which the `cache` table **526 MB** | |

- It was **constant, not spikes**: the heap part alone kept the load at 1.0, so every "normal"
  route, pages included (/, /app.html, scripts and styles are "normal" and shedMiddleware runs before
  express.static), got the raw JSON 503 at load ≥ 0.97, and optional API calls at ≥ 0.85.
- The heap was really full, not only misjudged: 941 of 1048 MB is a leak heading for a crash; the
  container's start at 17:34, 17 minutes after the 17:16 deploy, was most likely that crash.
- **The leak**: SEC company-facts documents. `sec:facts:<CIK>` entries in the `cache` table are
  7–9 MB each (the full XBRL "every figure ever reported" file: 0001099219 9.3 MB, 0000831001 9.1 MB,
  0000019617 8.2 MB, …), written by stock.js and wealth.js, and `dbCached` also kept every one parsed in
  memory (a parsed object is several times its JSON size), up to 2000 entries. A page or scan that
  looks at a few dozen companies fills the heap and the file. The 18:49 backup was 1.45 MB, so this
  all came within the hour before.
- Event-loop delay and requests in flight were fine; no route was slow or stuck.

### The fix (DECISIONS.md LS-1..LS-8)

- **The leak**: SEC company facts are trimmed to the ~30 concepts the app reads, 10-K/10-Q of the
  last 12 years (`trimFacts`, key `sec:facts2:`); submissions to the few fields used (`trimSubmissions`,
  `sec:subs3:`, which also ends a key clash between wealth.js and fundamentals.js). The in-memory front
  of `dbCached` keeps no value over 1 MB and at most `MEM_CACHE_MAX_MB` (64) in all. At start the old
  big entries are deleted and the file is vacuumed when most of it is free.
- **The heap limit** comes from V8 (`heap_size_limit`), or `HEAP_LIMIT_MB`; the container runs
  with `NODE_OPTIONS=--max-old-space-size=1536`.
- **Event-loop delay** is measured over a 2 s window (p50/p90/p99), not since start.
- **Never shed**: pages, scripts, styles and anything outside /api are always critical, as are
  orders, risk and sign-in. Shedding starts only after the load stays over `SHED_AT` for 5 s, and
  stops after 3 s under it. A browser gets a small page that tries again by itself, not JSON. Every
  refusal carries Retry-After.
- **The front end**: a refused call is retried quietly up to 3 times (Retry-After, growing).
  Only then a small note "This is taking longer than usual. Trying again…" with a Try again button,
  never a popup. It is translated, including Yiddish.
- **Settings**: `MAX_INFLIGHT`, `LAG_LIMIT_MS`, `HEAP_LIMIT_MB`, `SHED_AT`, `SHED_SUSTAIN_MS`,
  `SHED_CALM_MS`, `MEM_CACHE_MAX_MB` (.env.example). Tests are in test/shed.test.js.
- **The deploy that only looked done**: several deploys were logged "Deployed" while the container
  still ran the 4-hour-old image. update.sh accepted any /healthz answer, and the old container answers
  too when a recreate fails. Now a deploy counts only when the container runs the new image ID (one
  more recreate after 10 s, else a rollback). oracle-migrate has a `deploy-now` step that deploys in
  the open with its log.

### After (diagnose-load run 45267262829, 21:12 UTC, new code bd06d35 confirmed in the container)

| | before | after |
|---|---|---|
| load | 1.0, constant | **0.04** (six samples over a minute; SHED_AT 0.85) |
| heap in use / limit | 941 MB / 450 MB | **32 MB / 1560 MB** (V8's limit with --max-old-space-size=1536) |
| event-loop delay p50 / p90 / p99 | – / – / 21 ms | 20 / 20 / 21 ms (2 s window: 10 / 10 / 11 ms) |
| requests in flight | 3 of 200 | 1 of 400 |
| refused (shed) | 42 of 572 | **0** |
| container memory, CPU | – | 134 MB of 2 GB, 0.25% |
| database file | 553 MB (cache 526 MB) | **36.8 MB**; largest cache value 0.58 MB (sec:tickercik) |
| app.brightolio.com /, /app, /app.html, /app.js, /styles.css, /sw.js | raw JSON 503 | **200**, HTML/JS/CSS, 0.07–0.45 s |
| /api/news, /api/insights, /api/market/overview (signed out) | 503 | 401 (sign-in needed), never 503 |


## 2026-11-23: Google sign-in works again: everything on app.brightolio.com

Google refused sign-ins because the server called itself 138-2-233-183.sslip.io. Now the server's
address is https://app.brightolio.com, its other address redirects there, and Render (where
app.brightolio.com's DNS still points) passes that address on to the Oracle app with the edge secret.
Also: deploys can no longer collide (lock, leftover containers removed, retry and roll back); a
redirect loop on app.brightolio.com from the first version (16:56–17:09 UTC) is fixed. Checked:
sign-in check (Google accepts https://app.brightolio.com/auth/google/callback from every address),
verify with a paper trade. `npm test`: 492 pass, 0 fail. Lasting fix: point the Cloudflare record
at 138.2.233.183 (MIGRATION_ORACLE.md).


## 2026-11-23: Finishing the move to Oracle Cloud (Phase 1 now, merge after Turso's reset)

**What runs where:** the site and its database on the Oracle VM (https://138-2-233-183.sslip.io),
hourly backups there; Render is a 301 redirect only; Turso is blocked until 2026-12-01 and holds
only the data from before November 22, which the scheduled merge brings back and then deletes.

**Changed**
- Phase 1 (done, verified): the VM is active, out of maintenance, backed up hourly; verify and a
  paper trade pass. Render redirects every path (render-redirect.yml run 45213426249). Workflows use
  the Oracle address. Signed-in people see "We moved to a new server…" until the merge.
- Phase 2: `oracle-merge-scheduled.yml` (every 6 hours from 2026-12-01 00:30 UTC); a safe
  `turso-merge.mjs` (ids, one account per person, paused automations with their old values, missed
  schedules, in-app notices, no sessions or tokens, credential check, integrity and foreign-key
  checks, counts) with a rehearsal and an exact copy in `migrate.sh merge-turso`.
- Phase 3 (automatic after the merge): the final encrypted copy (90 days), the Turso database
  deleted through the API or one issue with three steps, the old settings removed from the VM, the
  merge-only code removed by `scripts/old-db-cleanup.sh`. Turso wording elsewhere is already gone.
- Removed: the rollback to Turso, the `turso db export` fallback, Render deploys and Render's weekly
  rebuild; replaced by "restore a backup" and "rebuild the server from a backup" (MIGRATION_ORACLE.md).

**Tests:** test/merge.test.js (two sample databases: id ranges, one account, a past scheduled order,
an active bot and a Playbook paused, foreign keys, a failure leaves the file byte-for-byte as it was,
a second run changes nothing), test/oracle.test.js (+ the Render redirect), test/old-db.test.js.
`npm test`: 489 pass, 0 fail; after the clean-up script on a copy: 486 pass, 0 fail. shellcheck
clean for deploy/vm and scripts; actionlint clean for the workflows changed.

**Rollback:** restore a backup (Admin → Database, or oracle-migrate `restore`); a bad deploy goes
back to the previous image automatically (post-deploy.yml).


## 2026-11-23: Move to Oracle Cloud Always Free (app, database, keys)

**Why:** Turso refused every SQL read after the monthly read limit, which took production down. The
VM was already set up (oracle.yml) but used the same Turso database.

**What changed**
- Database: a SQLite file on the VM's disk (`DB_FILE`, `PERSISTENT_DISK=1`), WAL, busy_timeout,
  synchronous=NORMAL. The start-up check and `/healthz/full` accept it.
- `/healthz` runs no query (it reports what the app's statements saw last); `/healthz/full` still checks.
- Backups (`src/backup.js`): hourly `VACUUM INTO`, integrity-checked, 48 hourly + 30 daily, encrypted
  daily upload to Oracle Object Storage when `OCI_BACKUP_PAR_URL` is set. `deploy/vm/restore.sh`.
- Copy out of Turso without SQL reads: `scripts/turso-pull.mjs` (embedded replica, `sync()` only),
  `turso db export` as fallback b, overages as c.
- Maintenance mode (env or Admin or `/internal/maintenance`): jobs paused, orders refused (503), banner.
- `STANDBY=1`: a server that never runs jobs (Render from now on; also in render.yaml).
- Admin → Database (new): type, size, tables, backups (now, download, restore), maintenance, keys by
  name. Admin → Hosting: CPU, memory, disk, version, last deploy, deploy now, restart. Admin → Keys:
  "Required on this server". All need the admin role and a password confirmed within 15 minutes; all audited.
- `update.sh` installs its own new copy, carries out Admin's deploy/restart/restore requests, installs sqlite3.
- `.github/workflows/oracle-migrate.yml` + `deploy/vm/migrate.sh`: maintenance-on, pull, switch-db,
  verify, activate, maintenance-off, rollback, set-env, backup, status. `oracle.yml settings` keeps the move.

**Tests:** test/oracle.test.js (PERSISTENT_DISK start-up check, backup → restore.sh row counts,
retention and encryption, turso-pull with a fake sync source and a refused sync, query-free /healthz,
maintenance blocks orders and pauses jobs, STANDBY, Admin Database/Keys need admin + step-up and never
show values). `npm test`: 486 pass, 0 fail. shellcheck and actionlint clean.

**Rollback:** oracle-migrate.yml step `rollback` (the VM goes back to Turso); going back to Render:
MIGRATION_ORACLE.md → "Going back to Render".


## 2026-11-22: The four-phase job: summary

| Phase | What changed | Tested |
|---|---|---|
| 1. Home clock | One market calendar for the server and the browser (public/market-calendar.js). One label everywhere: closed with the reason and the next open on weekends and holidays, 1 PM on early-close days. One clock and one timer on Home. Yiddish function patterns fixed. | test/market-clock.test.js (holidays 2026–2027, early closes, marketState without the server, /desk/session, one clock after 20 redraws in Chromium); faked dates checked in the browser |
| 2. Page help | An "i" next to every page title (before the gear) opens the guide in a drawer (desktop) or a sheet (phone). The guide cards are gone from pages. A first-time dot and hint; 41 new guides; Yiddish. | test/page-help.test.js (all 93 pages and tabs in Chromium, panel, Esc and focus, seen, hint); light, dark, 375 px, RTL |
| 3. OFI lab | The R project (hf.Rmd, R/ofi.R, sample data, rendered PDF), the JavaScript math matching R to 6 decimals, and the "Order flow (OFI) lab" page with the sample, an upload or Alpaca quotes. | test/hfofi.test.js; R rendered the PDF in this container; page checked at 1280 and 375 px |
| 4. Live pairs | The "Live ratio" model and engine (stream or polling, two-leg safety, limits, kill switch, calendar hours, PDT, rate limit), Paper first with a real-money gate, an intraday backtest next to OLS, and the "Live ratio" tab. | test/pairslive.test.js (math, bars, time zones, thresholds, failed and partial legs, hours, limits, kill switch, account picker, real-money gate); a KO/PEP session simulated on Paper over a full day: 11 round trips, legs always paired, flat at the close |

`npm test`: 470 pass, 0 fail. `npm run clean` passes, and the boot check passes.

### Left for you

- **Data:** put the licensed rb2305 file at research/hf-ofi/data/df_rb2305_am1.Rds and run `./run.sh` for the report on real data. If you have the original hf.Rmd, compare its factor definitions with DECISIONS O-3.
- **Live pairs on a real account:** run a bot on Paper for the required days first. With an Alpaca key, the intraday backtest and live quotes work; without one the page says so and the engine polls prices.
- **Legal:** LEGAL_REVIEW.md L16–L19 wait for sign-off; nothing new was added to the homepage.
- **Page gate:** NEEDS_REVIEW.md N-18 (the golden baseline is out of date).

---

## 2026-11-22: Phase 3 of 4: Order flow (OFI) lab

### What changed

- **R project** (research/hf-ofi/): hf.Rmd, with the factors in R/ofi.R:
  - spread, mid, microprice, volume imbalance, VOI, OFI, OFI-N and the rolling differences;
  - the regressions on 4 horizons;
  - the OFI-N strategy with the in-sample thresholds and costs, gross and net, in and out of sample;
  - ggplot2 + patchwork figures.
  It also has a README, DESCRIPTION, run.sh, data/README.md, a seeded synthetic sample, and the rendered out/hf.pdf and out/return.png. The real data file is git-ignored.
- **App page** "Order flow (OFI) lab" (Automate → Pairs & stat arb):
  - data: the sample, a CSV upload or Alpaca stock quotes;
  - charts of price, bid/ask and microprice, OFI-N with its thresholds, imbalance and VOI;
  - the regression table, and cumulative returns against buy and hold, in and out of sample, with statistics;
  - settings for N, the percentiles, the split, the fee, slippage and tick size;
  - downloads of the R project (zip, no data) and the PDF;
  - the "i" panel explains each factor in plain words, with Yiddish throughout.

### Tests

- test/hfofi.test.js:
  - every factor by hand, including VOI and OFI when the bid or ask rises, falls or stays;
  - the rolling sum and percentiles, and no look-ahead;
  - the backtest's positions, returns and costs;
  - the upload checks (columns, 20 MB, numbers);
  - JavaScript = R to 6 decimals on the sample;
  - the zip without data, quote conversion, and the holiday refusal.
- R: `./run.sh` rendered the PDF from the sample (checked page by page).
- In the browser at 1280 and 375 px, with the sample, a good and a bad upload, Alpaca quotes (mock) and a holiday: no errors, no sideways scroll, axe clean.
- `npm test`: 456 pass, 0 fail.

### Left for you

Put the real data file at research/hf-ofi/data/df_rb2305_am1.Rds and run `./run.sh` to get the report on real data. If you have the original hf.Rmd, compare it with this version: the factor definitions are listed in the README.

---

## 2026-11-22: Phase 2 of 4: Page help behind an "i"

### What changed

- **The "i":** a round "i" next to every page title (before the settings gear) opens "How this page works" in a drawer (desktop) or a bottom sheet (phone). The panel holds the title, what the page is for, the steps, "Good to know", the practice-mode tip and the links to the Learning center and the AI assistant.
- **No more guide cards in pages:** the guide card and Home's guide slot are gone. The toolkit's lesson cards and the risk page's "Why it matters" moved into the panel.
- **First-time hint:** a dot and, once, "New here? Tap i" until the page's panel is opened. The Settings switch now only turns off the hint.
- **Guide text for all 93 menu pages and tabs:** 41 new guides, all in Yiddish too.

### Tests

test/page-help.test.js:
- every menu page and tab has guide text and Yiddish;
- in Chromium, every one of the 93 pages has exactly one "i" in its title (before the gear) after rendering and after a redraw, with no guide card;
- the panel shows the page's guide, closes with Esc or a click outside, returns focus and marks the page seen;
- the hint goes away once seen and with the Settings switch.

`npm test`: 448 pass, 0 fail. Screenshots checked at 1280 and 375 px, in light and dark mode and in Yiddish (RTL).

### Rollback

Revert the commit. Only browser-side "seen" keys are involved.

---

## 2026-11-22: Phase 1 of 4: Home clock

### What changed

- **Market status:** the Home clock, /desk/session, the order desk strip and the Market overview use one shared calendar (public/market-calendar.js) and one label. Weekends and holidays say "closed" with the holiday's name and the next open; early-close days close at 1 PM.
- **One clock:** a single #homeClock in the title row and a single 1-second timer, however often Home is drawn. On Home the quick ticket no longer repeats the market state.
- **Date picker and schedule:** both use the same calendar, with no request.
- **Yiddish:** clock and status labels translated; function patterns in every translation file now work in the browser.

### Tests

test/market-clock.test.js:
- weekends, and the 2026–2027 holidays (including the observed July 4, Juneteenth and Christmas);
- early closes;
- `marketState()` with no server answer;
- /desk/session on holidays and weekends;
- the Yiddish labels;
- in Chromium: Home drawn 20 times leaves one clock and one timer, and the seconds move one at a time.

`npm test`: 443 pass, 0 fail.

Browser, with the date faked: Saturday, Sunday, Thanksgiving, the day after Thanksgiving at 2 PM and a Tuesday at 10 AM. Each was checked with no server answer and with one, and each label was right with one clock.

### Rollback

Revert the commit. No data changes.

---

## 2026-11-22: Growth features, phase 2 (consistency, linking, revenue)

### What changed

- **Pricing:** Free / Pro / Premium tier labels on the plan cards and the comparison table, plus a "Research and AI" group of rows (in the app; the homepage waits for sign-off, LEGAL_REVIEW.md L18). A test ties each row to the server's own checks.
- **Linking:** related links under every stock-page section, and "Save these matches as a watchlist" on the scanner.
- **Design system:** rules for the research, AI and growth pages in DESIGN_SYSTEM.md (frame, numbers, charts, locks, the company card, AI pages, related links).
- **Translations:** Yiddish for the new pricing rows, links and buttons.

### Tests

`npm test`: 436 pass, 0 fail. Checked in the browser at 1280 and 375 px, signed in and signed out: no console errors, no horizontal scroll, axe clean.

### Rollback

Revert this entry's commit. No data changes.

---

## 2026-11-22: Growth features, phase 1

### What changed

- **Plan first:** PLAN_GROWTH.md: what exists, what the data and the broker really allow, 18 features with plan tiers, and the build order ranked by effect on revenue and trust against effort.
- **One stock page:** the analyzer gained Valuation (P/E against its own 5-year average and its sector, PEG, P/S, EV/EBITDA), Fundamentals (5 years, with an AI summary for Pro), Earnings (beats, misses, price moves after reports), Dividends (safety score), Technicals and Supply & demand (labelled indicative, no depth). There is also a Compare tab. Old `#/analyze?symbol=` links work.
- **Scanner:** "Growth at a price" presets, saved filters and daily alerts (Pro).
- **Rates vs stocks:** Fed funds, 2y, 10y and the curve against SPY and sectors, with the next Fed meeting.
- **Company card before every buy:** on the quick ticket, the Trade page, Equalize, Playbooks and bots. It loads in the background, never blocks the order, and can be hidden per stock.
- **Diversification:** a score in six parts, fund overlap, correlation, and up to 3 suggestions with "why" and a preview (never an order).
- **AI morning picks:** ranked picks with reasons and sources. Approve each day or let them run automatically, within a daily budget, a per-stock limit, a stop and a daily loss limit. Paper by default; real money needs Elite, the password and step-up. The public record includes every loss.
- **AI intraday:** a slow, rule-based engine (every 5 minutes at the fastest). It has hours, interval, order, position, loss and PDT limits, the kill switch, an optional ex-dividend hold for a dividend list, paper by default and a full trade log.
- **AI long/short portfolios** (renamed from "AI hedge funds"): a cap on each position, the value history with its largest fall, a hypothetical backtest against SPY, fees and risks in plain words, and step-up before real-account approvals.
- **Dividends & income:** income by month, coming ex-dates, safety per holding, DRIP status, and opt-in reminders before ex-dividend dates and earnings.
- **Passive investing:** an account check (funds against single stocks, average fee), four steps linking the existing tools, example mixes and a fee example.
- **Active trading desk** (`#/active`): session, buying power, the day-trade rule, positions, movers and the automatic engines.
- **Fund compare:** 2 to 4 funds side by side; each mutual fund shows its closest ETF.
- **Futures research:** contract months, the roll calendar for equity-index contracts, and brokerages that offer futures.
- **Translations:** Yiddish (`public/i18n/yi-growth.js`) and simple translations of the new menu labels in 8 languages.

### Tests

`npm test`: 435 pass, 0 fail (3 existing TODO items are marked for review, as before). New: test/stock.test.js, stock-routes, rates, diversify, newspicks, intraday, aifunds-growth, income, futures-roll. Checked in the browser at 1280 and 375 px, signed in: no console errors, no horizontal scroll, axe (WCAG 2 A/AA) clean on each new page.

### Rollback

Revert the commits from `55306d4` (PLAN_GROWTH.md) to this entry. The new tables (newspicks_log, newspicks_trades, intraday_log, ai_fund_nav) and the `ai_funds.max_weight` column are additive and can stay.

---

## 2026-11-20: Pro polish: design system, landing, pricing, onboarding, empty states

### What changed

- **Review:** PRO_REVIEW.md covers first impression, consistency, trust, speed, accessibility and mobile, and revenue, with the 20 highest-impact fixes ranked against effort.
- **Design system:**
  - every app screen has its own browser title;
  - AA contrast for the `.save` and `.og-tag` badges, and a label on the invite-link field;
  - one `.empty` component;
  - rules for wording, badges, titles and sign-up in DESIGN_SYSTEM.md.
- **Landing:** a "Security" link in the header of every public page, and the footer's own risk sentence and the Risk Disclosure link under the final sign-up box (English and Yiddish). No new claims (LEGAL_REVIEW.md L13).
- **Pricing:**
  - a plan comparison table on Plans & billing, the same rows as the homepage (tested);
  - yearly prices as a monthly amount with the yearly charge under it;
  - "Recommended" instead of "Most popular".
- **Upgrade window:** it names the plan that unlocks the feature, shows its real prices with Monthly/Yearly, says what stays free, and shows the trial terms. Paying members change plan in the billing portal, and a second subscription is refused (409, tested).
- **Onboarding:**
  - sign-up has an `h1` and a short factual panel;
  - Get started puts the first trade first and jumps to the ticket;
  - a next step to the strategy library appears after the first practice trade.
- **Polish:** empty states with next steps on Home (positions, recent orders), Orders and Billing history; in-page jumps stop below the sticky header; a menu error when the session ends mid-load is fixed.
- **Translations:** Yiddish for every new string (`public/i18n/yi-pro.js`, `scripts/yi_home.py`).
- **Follow-ups for the owner:** NEEDS_REVIEW.md N-15 to N-17 and LEGAL_REVIEW.md L13 to L15.

Decisions: DECISIONS.md P2-1 to P2-15.

### Tests

- `npm test`: 395 pass, 0 fail, 3 todo (new: test/pricing.test.js, the no-second-subscription check in test/stripesetup.test.js). Security and clean checks pass.
- axe-core (WCAG 2.0/2.1 A and AA): 0 violations on the homepage (English and Yiddish), Security, Status, sign-in, sign-up, Get started, Home, Plans & billing, Invite & earn, Marketplace, AI bots, Developer API and Settings, at 1280px and 375px. Before: 3 failures and a missing `h1`.
- Click-through of all 94 menu pages and tabs at 1280px and 375px: no browser errors, no page wider than the screen, every page with an h1.
- `npm run e2e` (with the pre-installed Chromium): 444 checks, exit 0. Checked by hand in Chromium: sign-up, Plans & billing (Monthly and Yearly), the upgrade window, Get started and the next step, in English and Yiddish, signed in and signed out, at 1280px and 375px.

---

## 2026-11-20: Equalize positions: choose which holdings to include

### What changed

- **The confirm dialog** (Positions → Equalize positions):
  - Every holding has a tick box, all ticked at first, with Select all / none in the header and "X of Y included" above the table.
  - Holdings left out are greyed and marked "Not changed"; they get no buys or sells.
  - Every change recounts on the server (debounced): "each holding gets", the targets, the change per holding, the trades, the buy and sell totals and the "Place N trades" button.
  - With fewer than two ticked, the button is disabled with "Pick at least two holdings".
  - Options and shorts stay in the "Left as they are" note, with no tick box.
  - A sticky footer holds the totals and buttons, and the layout works at 375px.
- **Server** (src/equalize.js):
  - `planPositions` takes `exclude`, and `cleanExclude` validates it: only held symbols, at most 500.
  - The money is split only among the included holdings (DECISIONS.md E-1).
  - Preview and run both accept `exclude`. Run rebuilds the plan and ignores any orders sent from the browser.
  - Password and confirm are unchanged.
- **Remembered per account**, on the server, with "Reset to all".
- **Translations:** Yiddish (`public/i18n/yi-equalize.js`) and the eight simple languages.
- **Tests:** `test/equalize-exclude.test.js` (4 tests):
  - excluded holdings get no orders;
  - the money is split only among the included holdings, with and without cash to keep;
  - fewer than two included is refused;
  - unknown symbols, more than 500 and non-lists are refused.

### Tests

- `npm test`: 393 pass, 0 fail, 3 todo. Security and clean checks pass.
- Chromium against the mock broker (Alpaca account, 4 holdings), at 1280px and 375px, with no browser errors:
  - leaving out AAPL drops its orders and splits the money among the other three;
  - one or zero ticked disables the button;
  - Select all and none work;
  - the trades were placed with AAPL untouched;
  - reopening shows AAPL still left out, and Reset to all brings it back;
  - the unknown-symbol and too-few errors come from the server;
  - the dialog fits the screen at 375px.

---

## 2026-11-19: Home with a clear priority order, one layout for every account type

### What changed

- **One Home for every account type.** Alpaca accounts no longer use their own portfolio page (`#/portfolio` redirects to Home). They see the same layout with their own data: intraday chart, margin card, today's change per position.
- **New order, top to bottom:**
  1. Title row: Portfolio, the account pill, the clock and an account switcher.
  2. Action needed, only when there is something to do: approvals, trading blocked.
  3. The welcome card, for a brand-new practice user.
  4. The chart with 1D, 1W, 1M, 3M, 6M, 1Y and All, and the statement row.
  5. One even row of key numbers: Total value, Today, Total P/L, Buying power, Cash, and Since you last looked when that setting is on.
  6. The main grid. Left, about 2/3: Positions (count in the header, sorted by value, click-to-sort columns, % of portfolio, today's change), then Recent orders. Right, about 1/3: the quick ticket, My day, Why my P/L moved, and Balances & margin for Alpaca.
  7. Get started (collapsible, and Hide is saved to the account), the page guide, the other accounts, and a small Paper account card holding Reset.
- **Server:** `/account` positions carry `dayPl` (today's change) when market data is on.
- **No layout shift:** My day, Why my P/L moved and Recent orders fill fixed slots with skeletons of their measured height.
- **Fixes:** a resize redraws only the chart; "-$0.00" now shows as $0.00; the 16px gaps between Home's blocks now apply (the rule never matched before).
- **Unchanged:** PREFS (hideToday, the chart mode and color), the live updates of every `[data-k]` value, the onboarding logic, approvals, the statement, the other-accounts boxes and Equalize.

Decisions on unclear points: DECISIONS.md H-1 to H-16.

### Tests

- `npm test`: 389 pass, 0 fail, 3 todo. Two tests that read Home's code were pointed at the shared page, with the same checks:
  - batch10: the chart draws the account's history without a legend;
  - batch8: the numbers and chart refresh in place, not by redrawing the page.
- Chromium against the mock broker, practice account (3 positions, My day on) and Alpaca account (connected with test keys), at 1280, 800 and 375px:
  - the blocks are in the order above, and the grid is 664/332px at 1280px and one column at 375px;
  - the key-number tiles are equal height, with 5, 3 and 2 per row;
  - nothing is wider than the screen, and the positions table fits without scrolling at 1280px;
  - sorting, the time ranges, the switch to Alpaca and Hide (still hidden after clearing the browser's copy) all work;
  - no browser errors.
- `npm run e2e` (with the pre-installed Chromium): 444 checks, exit 0, including the Alpaca home (Balances & margin), the quick ticket orders, My day on Home, and the other-accounts boxes with Equalize.

### Rollback

`git revert` this commit and push.

---

## 2026-11-18: App structure: menu by goal, merged pages with tabs, redirects, Related links

### What changed

1. **Audit:** STRUCTURE_AUDIT.md lists all 94 pages. For each it gives what the page does, who it is for, which pages overlap with it, the recommendation and the new place.
2. **Menu:** 6 member groups instead of 9, organized by what members want to do (Research, Trade tools, Invest, Automate, Track & plan, Account & help), with 5 to 7 entries each instead of up to 13. Core and the admin groups are unchanged.
3. **Merges:** 21 pages with tabs hold 62 pages: Stock & fund analyzer, Research & news, Scanners, AI assistant, Options, Phone & text, Investing toolkit, Portfolios, Futures bonds & more, Strategies, Bots, Alerts & signals, Pairs & stat arb, Marketplace, Developers, Performance, Risk, Taxes, All my money, Accounts, Security & protection. Each tab is still its own page, so no feature, setting or saved item moved. Why each page went where it did: DECISIONS.md M-6 to M-14.
4. **Split:** the developer half of Bonds, rates & crypto (Alpaca MCP server and CLI, the owner's Broker MCP, connecting AI agents) is now its own page, `#/alpaca-dev`, the Developers → Alpaca AI & CLI tools tab (M-15).
5. **Redirects:** every old address opens its tab (`#/aibots` → `#/bots/aibots`), and the query string is kept. The menu highlights the merged entry, search lists every tab as "Group › Entry", and page guides and page gears follow the tab.
6. **Related links:**
   - A "Related" row at the end of the pages that work together.
   - A single strategy and a single Playbook link at the top to their own backtest, run settings (the bot) and listing (Marketplace or Playbook library), plus My bots and Risk controls.
   - AI signals link to Alerts to trades.
   - The community strategies card links to the Marketplace.
7. **Translations:** Yiddish for every new label and sentence (`public/i18n/yi-structure.js`). The eight simple-translation languages got the new group and entry names.
8. **Fixes found by the click-through:** the Retirement tables overflowed at 1280px, and the Playbooks tab strip overflowed at 375px (and still showed a Developer API tab).
9. **Docs and checks:**
   - The generated README overview lists each entry with its tabs.
   - `scripts/readme-check.mjs` accepts tab names.
   - Three old menu paths in text were updated (a page guide and two code comments).
   - DESIGN_SYSTEM.md has a "Merged pages and tabs" rule.

### Tests

- `npm test`: 389 pass, 0 fail, 3 todo (the review-only BUG-003/004/005). Security check and clean check pass.
- Click-through in Chromium against the mock broker, at 1280px and 375px:
  - all 53 menu entries and detail pages, the 41 tab addresses and all 41 old addresses, plus old addresses with a query;
  - every old address lands on its tab with the right menu entry marked;
  - no browser errors, no page wider than the screen after the fixes, and every merged page shows its tabs and its Related row.
- `npm run e2e` (with the pre-installed Chromium): 444 checks, exit 0. One earlier run had one failure in the trade symbol search step; it passed on the re-run and that page was not changed, so it was a one-off timing failure. The e2e menu steps were updated for the new structure: the Automate group instead of Quant lab, the Alpaca account through Accounts, and a new step that checks 12 old addresses redirect to their tab.

### Rollback

`git revert` the four commits (audit, menu and merged pages, redirects, Related links) and push. Old addresses work in both directions, because every page keeps its own route.

---

## 2026-11-18: Remove the homepage video; dashboard home with the portfolio chart on top

### What changed

1. **Homepage video removed** from `index.html` and `yi.html`, and from their generator `scripts/home.py` (otherwise the next `python3 scripts/pages.py` would bring it back). The whole `<section class="adreel">` went: the video, its caption and its transcript. Its player code in `public/site.js` and its styles (`.adreel`, `.adbox`, `.adtrans`) in `public/site.css` were deleted. The files in `public/media/` stay. The pages were rebuilt with `scripts/pages.py`, so the other public pages differ only in the `site.css`/`site.js` version hashes.
2. **Dashboard home** (`routes.dashboard`, paper and other non-Alpaca accounts) now goes from top to bottom: the title row (with the clock in it), then the portfolio chart at full width with the monthly statement, then the key numbers, then a two-column card grid (one column under 768px) holding Positions, My day, Why your P/L moved, Trade and Recent orders (full width). The layout rules are in `public/layout.css` under "dashboard home", and DESIGN_SYSTEM.md has a new "Dashboard home" section.
3. **My day, Why your P/L moved and the page guide** now go into slots (`[data-slot]`, `display: contents`) on the home grid, instead of being inserted under the title. On pages without a slot they work as before.

### Decisions on unclear points

- I left the title row (`h1`) above the chart, because DESIGN_SYSTEM.md requires one `h1`, placed first in the view. I moved the clock into that row so the chart comes right after it (153px from the top at 1280px, 205px at 375px).
- The key numbers are Total value, Today (hidden when `hideToday` is on), Buying power (new tile: `buyingPower` from `/account`, falling back to cash; it updates live like the others) and Open positions. I kept Profit / loss, Since you last looked (PREFS mode) and Cash after them, so no data is lost.
- The approvals banner, the welcome and "Get started" cards and the page guide ("How this page works") used to sit above everything. They now sit under the key numbers, above the grid, so the chart is the first thing you see. The guide is unchanged otherwise (Got it, Hide on every page).
- There is no watchlist card. Watchlists are Alpaca-only, and an Alpaca account's home is the Portfolio page (`routes.portfolio`), which I left alone ("don't touch other pages"). On that page, My day and P/L still go under the title as before. "Recent activity" is the existing Recent orders card.
- Cards in a grid row stretch to the same height, so the rows end on a clean line.
- Video tests: BUG-013 (captions and a transcript for the video) is superseded. Its test now checks that the video is gone and that the captions file is still in `public/media`. I removed the 11 English and 11 Yiddish sentences of the video caption and transcript from `test/golden/homepage-v1-sentences.json`. The transcript's legal lines ("Investing involves risk of loss", "software, not a broker") are still covered by the homepage footer disclosure.
- The layout golden gate (`npm run layout:gate`, not part of `npm test`) will show the dashboard and homepage as changed on purpose. The baseline is for the owner to update.

### Tests

- `npm test`: 389 pass, 0 fail, 3 todo (the review-only BUG-003/004/005).
- Dashboard checked in Chromium against the mock broker at 1280, 800 and 375px: no horizontal scroll and nothing wider than the page (tables scroll inside their own box). The chart is the first block after the title. The grid is 2 columns at 1280 and 800px and 1 column at 375px, in the order Positions, My day, P/L, Trade, Recent orders. With `hideToday` on, the Today tile is hidden. No browser errors.
- `npm run e2e` (with the pre-installed Chromium): 444 checks, exit 0, no failures (it includes My day on the home page and the quick-ticket orders).

### Rollback

`git revert <this commit>` and push.

---

## 2026-11-16: Remove the feature flag system, make the layout permanent, automatic release pipeline

**Release:** see the tag on the deploy of this change (`vYYYY.MM.DD-N`, created automatically after the deploy). Rollback target: the commit before it on main (the release commit's first parent). **Rollback used:** none (filled in below if the live check fails).

### What changed

1. **The feature flag system is gone.** Deleted: `src/flags.js`, the admin "Feature flags" card, `GET/PUT /api/admin/site/flags`, `GET /api/tools/flags`, the staged-rollout module (`src/layout-rollout.js`) and every flag check. The stored site settings `flags` and `layoutRollout` are left in the database, unused and harmless (no migration, so no backup or reverse was needed).
2. **The layout redesign is permanent** (it was built behind the flag `layout_v2`): `layout.css` and `layout.js` are part of every page (`<html class="lv2">`). Spacing, type scale, focus outlines, scrolling tables, skeleton loaders, empty states with a next step, error boxes, WCAG AA colour fixes, and the signed-in footer disclosures now shown. Details: DESIGN_SYSTEM.md, DESIGN_DECISIONS.md, COPY_CHANGES.md, LAYOUT_TEST_RESULTS.md.
3. **A release pipeline that needs nobody:** gates on every branch push → automatic merge to main when they all pass → deploy → smoke test and 15-minute watch of the live site → automatic rollback if it fails twice in a row → every deploy tagged. See "Release pipeline" below.

### Decision for each flag (finished and passing its tests means permanently on)

| Flag | Decision | Reason |
|---|---|---|
| `layout_v2` | **On for everyone** | Passed every gate: 0 disclosure, figure or control differences on 122 pages × 4 widths (test mode and production-mode build), 0 new axe violations (921 → 146), Lighthouse within tolerance, 436 end-to-end checks identical to the old layout. |
| `home_v2` | **Removed, not released** (owner's choice, option 2): the previous homepage stays live, unchanged; the audited-order version's code (section regrouping, risk links, Trust & compliance block, its CSS) was deleted. Recoverable from git history (commit `1d9efaf`). | Releasing it would have needed a change to the page snapshot (golden baseline) that the safety check refused, and its legal items L9 to L12 were never signed off. |
| `ai_team_chat` | **On** (still needs the "AI team chat" permission: owner, or admins the owner grants) | 18 unit tests and a browser suite pass; the flag only hid a feature that is already permission-gated on the server. |
| `comms_drawer` | **On, but a user sees it only once an admin assigns them a number** (no number: every route answers 404 and the app downloads nothing) | 30 unit tests and a browser suite pass. The site-wide flag could not be removed without making every user see an unconfigured drawer, so the natural switch (having a number) replaces it. **Risk:** the Telnyx call names were written without the vendor documentation (COMMS_SETUP.md); the webhooks fail closed (503 without keys, 401 without a valid signature). |
| `tools_sizing`, `tools_rr` | **On for every signed-in user** | Tests pass (maths against worked examples, routes, browser suite). |
| `tools_heatmap` | **On** | Tests pass. Without a market-data feed it answers "not set up" honestly instead of showing prices. |
| `ai_portfolio_explainer`, `ai_indicator_explainer` | **On, with their kill switches unchanged** (`PUT /api/admin/tools/kill`, `AI_TOOLS_KILL`) | Advice-filter tests (adversarial set), redaction, logging and kill-switch tests pass. **Risk:** COMPLIANCE_REVIEW.md marks them "Review required"; they talk about a user's own holdings. Use the kill switch if a legal check says so. |

One feature was removed instead of released: the audited-order homepage (above).

### Test results

| Gate | Result |
|---|---|
| Syntax of every JS, MJS and Python file | pass |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Secrets scan (`scripts/secrets-scan.mjs`) | none found |
| Clean code and README check | pass |
| Unit and integration tests | 353 pass, 0 fail, 3 todo (the three money-logic bugs held back since the audit, untouched) |
| End-to-end flows (sign-up, sign-in, bank link and deposit, order preview and confirmation, limit, bracket, crypto and options orders in the sandbox, modify, cancel, close-all with typed confirmation, withdrawal-style transfer, paper flow) | filled in from the final run: see "Final gate run" |
| Disclosures present and visible on every page at 1440, 1280, 768, 390 px; figures identical; every control present; no new axe violations | filled in from the final run |
| Browser suites: AI team chat, SMS and voice drawer, planning tools | filled in from the final run |

Number snapshots: the baseline of 11,820 figures (prices, fees, balances, P&L, %) from the code before the redesign is committed (`test/golden/layout-baseline.json`). The current site must reproduce every figure.

### Release pipeline (new)

- `.github/workflows/release-gates.yml`: on every push to `ai/*`, `chore/*`, `fix/*`, `feature/*`: audit, secrets scan, syntax, clean check, unit tests, end-to-end, page gates in test and production mode, browser suites. If all pass, the branch is merged into main (merge commit, only when the branch already contains main's latest commit, so the merged tree is exactly the tested tree), the deploy is started, and the branch is deleted. A failing gate leaves main untouched.
- `.github/workflows/deploy.yml` (existing): CI → Render deploy → routing and database checks. Also startable by the merge step.
- `.github/workflows/post-deploy.yml` (new): waits for the live site to serve the commit, runs `scripts/smoke.mjs` (pages load with their legal text and layout; the app's trading and payment code is served; health and routing checks; sign-in refuses a wrong password normally; with the optional test-account secrets also signs in and reads account and planning tools), then watches 15 minutes (one smoke test per minute). Two failures in a row → **automatic rollback**: the deploy hook is called with the release commit's first parent (what was live before), then the smoke test runs again.
- `.github/workflows/tag-release.yml` (new): tags every deploy `vYYYY.MM.DD-N`. Restore a version by name: redeploy that tag's commit.

### Limits and what could not be done

- **The live site cannot be reached from the coding environment** (the network policy blocks it), so live verification runs inside GitHub Actions, which can.
- **The smoke test's sign-in step needs a test account**: add the repository secrets `SMOKE_EMAIL` and `SMOKE_PASSWORD` (a sandbox account, never a customer). Without them the step is reported as skipped and the wrong-password check stands in for it. I cannot create repository secrets.
- **"Errors above 2x normal" is checked as page and health failures**, not as an error-rate ratio: the server's error counters are admin-only. A check failing twice in a row triggers the rollback.
- **Merges that change `.github/workflows/*` cannot be done by the pipeline** (GitHub does not let the built-in token change workflow files): the gates still run and are reported; the merge is pushed by hand. This release is one of those.
- **Branch protection**: none blocks pushes to main today. If it is ever turned on for main, the pipeline's merge step fails with a clear message; the setting to change is *Settings → Branches → main → allow GitHub Actions to bypass* (or turn off "Require a pull request before merging" for the Actions bot).
- The unexplained one-off flake seen once on Admin → Strategies in the production-mode run (a `0%` figure) did not reproduce in 8 later runs.

### Rollback

Automatic (above). By hand: redeploy the previous tag: `curl -X POST "<deploy hook>&ref=<commit of the previous tag>"`, or revert the merge commit on main (`git revert -m 1 <merge commit>`) and push; the pipeline deploys the revert.

### Leaving Render (checked after the deploy, 2026-11-25 15:41 UTC, commit 2595bfe)
- The Oracle server answers /healthz with `host: oracle`, database ok; it runs commit 2595bfe.
- https://138-2-233-183.sslip.io/ and http://138.2.233.183/ answer 301 to https://app.brightolio.com/.
- The server holds valid Let's Encrypt certificates for app.brightolio.com and the sslip name (until Feb 2027).
- app.brightolio.com still resolves to Cloudflare (104.21.94.31, 172.67.218.253) with Render behind it (`x-render-origin-server: Render`). It reaches Oracle only through the Render forwarder until the owner sets the record in issue #55. dns-cutover.yml checks every 10 minutes and closes the issue once the header is gone.
- No Cloudflare or Render key exists, so the custom domain and the service were left as they are; the service is still running.
- The repository variable APP_URL is still the old Render address. The workflows ignore it, because it is not a brightolio.com address.
- actionlint is not installed in this environment and the browser suites were not run here; npm test passed (585).

## 2026-11-25: Performance phase 2, the CPU pool in the backtest routes
- **Basket backtest** (`POST /api/baskets/backtest`): the math moved to src/baskets-math.js (pure: no database or network) and runs in the CPU pool. src/baskets.js loads the prices and hands them over; `select` and `isRebalanceDay` are shared from the new module, so the live rebalancer uses the same code.
- **Landing-page demo backtest** (`POST /api/public/backtest`): runs in the pool (`cpu-tasks.demoBacktest`), same answer as before.
- Already in the pool: `POST /api/backtest` and the optimizer. Left on the request thread on purpose: the AI-bot backtests (one symbol, a single pass, a few milliseconds), the AI-fund backtest (cached 12 hours) and the playbook and pairs backtests, which read the database while they run.
- Tests: test/cpu-routes.test.js (pool answer equals inline answer; a database module is refused). test/no-render.test.js no longer uses an sslip address (the one-address test caught it).

## 2026-11-25: Performance phase 2, the load test and the shared market-data cache
- **Load test run** (load-test.yml, 200 people, 60 s, against the Oracle server):
  - 568 requests per second; 0 errors, 0 shed, no 5xx;
  - p50 71 ms, p95 1.2 s;
  - the server's CPU stayed idle.
- **What was slow:** calls to outside providers that had no cache. The desk quote called the provider on every request; movers, most actives and news went to Alpaca on every call. Details are in PERFORMANCE.md (new).
- **Fix:** src/shared-cache.js:
  - for data that is the same for everyone, one provider call at a time per key;
  - movers, most actives and the latest news are kept 60 s, then the last answer is served for 10 more minutes while one refresh runs;
  - the desk quote is shared per symbol for 1 s;
  - news searches with dates are not cached.
- **Lighthouse step fixed:** the script ran `npx --yes lighthouse@12` as a single program name.
- **Tests:** test/shared-cache.test.js. npm test passes 594 (3 known TODO reviews).

## 2026-11-25: Performance phase 2, second load test and fixes
- **Second load test** (commit 8431f8f):
  - movers, most actives, news and sentiment now meet their targets;
  - Lighthouse ran: mobile 95–98, desktop 92–100, accessibility 100;
  - 0 errors, 0 shed.
- **Still slow, and fixed now:**
  - the desk quote: the quote and its bid/ask are shared together, kept 1 s and shown for 2 s more while one refresh runs. Orders do not use this; they price themselves.
  - the market overview: the rows use the shared cache, so an expiry no longer makes every user refetch 22 symbols at once.
- Numbers are in PERFORMANCE.md. npm test: 594, all pass apart from the 3 known TODO reviews.

## 2026-11-25: Performance phase 2, third load test (commit 6e124e1)
- **Results:**
  - 200 people, 0 errors, 0 shed;
  - the desk quote's p95 went from 2 s to 131 ms, the market overview's from 6.2 s to 224 ms;
  - every API route meets its target.
- **The only miss:** the font file (334 ms against 300 ms), which is network transfer time.
- **Fix:** the load-test Summary step no longer fails when Lighthouse is skipped.
- **Phase 2 status:**
  - the CPU pool is in the backtest routes, PERFORMANCE.md is written, and the 200-user load test runs and mostly passes;
  - indexes: 131, and no slow database route showed up in the load test (database routes answer in 1–10 ms on the server), so no new index was needed;
  - precomputing: the shared caches cover the market-wide data. Precomputing the stock card for the most-viewed symbols is left in PERFORMANCE.md ("Still to do").

## 2026-11-26: Render files removed after the DNS cutover
- **Confirmed** by dns-cutover.yml on 2026-11-25 16:42 UTC: app.brightolio.com resolves to 138.2.233.183 (A record, no CNAME), /healthz answers `host: oracle`, no Render header. Issue #55 is closed.
- **Deleted:** render.yaml and src/render-redirect.js, their tests (test/oracle.test.js, test/one-address.test.js), the Render line in test/security.test.js, and the render.yaml read in scripts/clean-check.mjs.
- **test/no-render.test.js** now checks that the three Render files are gone; the UNTIL_CUTOVER allowance is removed.
- **Owner, later:** in the Render dashboard, remove the custom domain and suspend the service. The service receives no traffic now.
- **Tests:** npm test passes 590 (3 known TODO reviews).

## 2026-11-26: Claude and Codex share one loop (Claude Code)
- **AGENTS.md** (read by Codex; CLAUDE.md imports it): one loop for both assistants. Pull main, read AI_HANDOFF.md, claim one row with a pushed `handoff: claim` commit, work in small pushes that pass npm test, then leave a checkpoint with one concrete next action.
- **Changed from Codex's first version:** work goes to `main` (the owner's standing instruction) instead of a separate `docs/ai-handoff` branch and task branches. A claim is stale after 3 hours without an update.
- **AI_HANDOFF.md:** a new latest checkpoint, and a queue that holds every open item (Admin AI 3–5, Part A, Pages, CI, the font, the seven-phase phases 4–7, the tick engine, the owner's steps).

## 2026-11-26: Three assistants on one board: Claude, Codex and Grok (Claude)
- **One loop for three assistants** (AGENTS.md, CLAUDE.md): catch up, claim one row, small tested pushes, a hand-off with one next action, and a record of the details. A "Who does what best" table: Claude for big changes and reviews, Codex for focused coding and tests, Grok for research and second opinions. Claims last 3 hours after their last update.
- **The board**:
  - AI_HANDOFF.md is sorted (active, paused, ready by priority, blocked, done this week), with the raw links at the top; the history is in docs/archive/AI_HANDOFF-history.md.
  - ai/status.json is generated from it by scripts/ai-status.mjs (`npm run ai:status`; it also sorts the queue), with the AI status workflow as a safety net.
  - test/ai-status.test.js keeps keys, tokens, emails, IP addresses and the server's own address out of the board, the JSON, AGENTS.md and the prompts, and checks that the JSON is up to date.
- **Paste-in prompts**: ai/prompts/chatgpt.md, grok.md and claude-web.md. Each reads the raw board, status and rules; works in the loop when it can push; and without push access ends with a patch and a hand-off block in the board's format.
- **Grok (xAI) as a provider** in src/llm.js, the router catalog, Keys and the AI team priors. It is off until its cap is raised.
- **Admin → AI team → Work status**:
  - the three assistants (task, state, last push, next action), the queue, the owner-only items, recent hand-offs and automatic runs;
  - monthly caps per assistant ($0 by default for per-use billing), Pause or Resume, and Run now (and Run for one row) through GitHub.
- **The automatic loop**:
  - ai-loop.yml (every 4 hours, or on demand) picks by key, cap and queue (scripts/ai-loop.mjs), claims, works on its own branch, opens a pull request and hands off;
  - Codex and Claude cross-review before release-gates.yml merges, and Grok reviews billing, trading and AI-pick changes;
  - at a usage limit the row is paused with its reset time;
  - scripts/ai-grok.mjs runs Grok's research and reviews.
- **Queue:** 22 ready rows ranked by revenue and trust against effort (PRO_REVIEW.md, the growth plan, the open briefs), each with a "Done when" line and a suggested assistant. The owner-only items are in their own table.
- **Checks:** npm test passes (606 tests, 3 known TODO reviews); actionlint passes on every workflow (its shellcheck pass not run: shellcheck is not installed here).

## 2026-11-26: The loop without paid keys (Claude)
- **Checked first:**
  - no pull request or issue had used `@codex` yet, and the Codex bot had never commented;
  - Grok has no GitHub bot that answers mentions; it reads repos on grok.com through its GitHub connection;
  - CI on main had been failing since the three-assistant push (issues #57 and #58): the clean check didn't know ai/. Fixed: `ai/` is in its KEEP list, and AGENTS.md now says to run the clean check before pushing.
- **Codex through GitHub (ChatGPT plan, no key):**
  - ai-loop.yml takes Codex rows when the variable CODEX_GITHUB=1. It opens a draft task pull request with ai/tasks/<ID>.md and comments `@codex …` (from CODEX_MENTION_TOKEN when set).
  - On Claude's pull requests it asks `@codex review`; the new codex-verdict job merges after "Didn't find any major issues", or sends the row back.
  - The picker (scripts/ai-loop.mjs) prefers it over the per-use API, with no cap. src/ai-loop.js and Admin → Work status show it as not billed per use.
- **Grok, and any web chat, through the AI hand-off inbox:**
  - the issue form .github/ISSUE_TEMPLATE/ai-handoff.yml;
  - the workflow ai-inbox.yml (only the owner's issues) runs scripts/ai-inbox.mjs, which checks the task, the hand-off format, no patch and nothing private, then commits the note to docs/research/ and the hand-off to the board, and closes the issue.
- **Prompts and rules:** ai/prompts/ (all three link the form; Codex's covers being woken by `@codex`; Grok's covers its GitHub connection). AGENTS.md has a "Without paid keys" table. OWN-05 lists the one-time setup.
- **Tests:** test/ai-loop.test.js covers Codex on the plan, the inbox parse, plan and apply, its refusals, and the workflow rules. npm test passes 610 (3 known TODO reviews); clean check and actionlint pass.

## 2026-11-26: Two-factor sign-in policy, off by default (Claude, SEC-01)
- **Admin → Security** (new tab under Owner: technical): "Require two-factor sign-in", with the scope (admins, live-trading accounts, everyone) and a grace period. The page shows how many admins have two-factor or a passkey, and the history of changes (who, when).
- **src/mfa-policy.js:**
  - the policy and each member's status (none, grace, set-up required);
  - the API gate (403 `mfaSetupRequired` after the grace; the sign-in, set-up and sign-out routes stay open);
  - the admin lock-out check;
  - recovery codes.
- **Members:** a "Set up now" banner during the grace period, and the app opens Settings → Security when set-up is required. Recovery codes are shown once when the authenticator app or a first passkey is set up, and a recovery code works at the sign-in code step.
- **Unchanged while it's off:** sign-in, the existing authenticator and passkey set-up, and the step-up for live orders.
- **Tests:** test/mfa-policy.test.js (7): off by default, sign-in unchanged while off, the grace period then required set-up, the gate's open routes, the three scopes and passkeys, step-up, audit and the lock-out refusal, and recovery codes.

## 2026-11-26: The page gate unblocked (Claude, QA-02)
- **Reviewed:** the page gate on main against its pre-redesign baseline; findings and verdicts are in DECISIONS.md QA2-1 to QA2-5.
- **Fixed:** Retirement accessibility (labelled account dropdowns, keyboard-reachable tables).
- **New baseline:** test/golden/layout-baseline.json, 89 pages × 4 widths, from test/layout/baseline.mjs.
- **Stable from day to day:** the gate fixes the browser date and ignores dates as figures (test/layout/run.mjs).
- **CI-01:** the prepared clean-check fix (ai/grok-ci-01-clean-check) is the same rule already on main (dc4d309); nothing more to merge there. The Deep check stays on CI-01.

## 2026-11-26: Claude → Grok → Codex, and deploy right away (Claude, TEAM-03)
- **scripts/ai-loop.mjs:**
  - `chain` (chainPick: order, access, resets, failed tries, waiting for the first reset);
  - `owner` (needsOwner: the owner-approved paths and words);
  - `addrow` (FIX-nn from a review);
  - `release --reset/--from` (the reset time, "taken over from").
- **scripts/ai-grok.mjs:** `code` (Grok as a coder: patch, apply, checks, up to 3 tries, forbidden paths).
- **.github/workflows/ai-loop.yml:** rewritten.
  - Hourly; one branch per task, continued and never restarted.
  - Claude, Grok (research or code) or Codex (API, or GitHub `@codex`).
  - At a limit or after Grok's 3 failed tries, the next run starts at once on the same task.
  - A post-merge review job; codex-verdict reads Codex's limit or review.
- **release-gates.yml:** squash-merges the task pull request when the gates pass, except owner-approved paths; then the deploy and the post-merge review. The old "reviewed=true" hold is gone.
- **Admin → AI team → Work status:** each assistant's reset time, and per task the chain (who had it, why it moved).
- **AGENTS.md:** "Reviews" (after the merge) and "When an assistant hits its limit". The ChatGPT prompt is updated to match.
- **Tests** (test/ai-loop.test.js):
  - Claude at its limit → Grok on the same branch;
  - no XAI key or a $0 cap → Codex;
  - Grok failing 3 times → Codex;
  - all three at their limits → wait for the first reset;
  - no per-use key at a $0 cap;
  - research rows to Grok first;
  - the auto-merge and owner-approved paths;
  - Grok's forbidden paths.
