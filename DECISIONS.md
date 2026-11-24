# DECISIONS.md

> **Update 2026-11-16:** the feature flag system was removed and the flagged features are permanently on (CHANGELOG_AI.md). Rows below that mention a flag describe the earlier design.

## Part A (2026-11-24): product, money, AI and admin

### A2: language at Get started, applied at once and saved to the account
- A-2.1: The language is chosen on the first Get started screen as large buttons, one per language the app has (English, English in plain words, Yiddish, and the other translated languages). The same choice is in the top bar and in Settings.
- A-2.2: The browser's language pre-selects a choice when the app has it ("ji" counts as Yiddish). Otherwise English. Detection never picks "English in plain words".
- A-2.3: Switching no longer reloads the page. The translator remembers each text node's English original (and each translated attribute), so switching back restores it exactly and switching to Yiddish turns the page right-to-left in place.
- A-2.4: The choice is saved to the account (`pref:lang`, validated against the list of languages the app has). At sign-in the saved account choice wins over this device's choice. Trade-off: a language picked on a new device before signing in is replaced by the account's choice after sign-in.
- A-2.5: "English in plain words" is offered as asked, but it only switches the page direction and keeps the standard English text. The plain-word copy for the rest of the app is not written yet, and the entry says so in the code. This is a known gap, not finished work.
- A-2.6: The sign-up page does not have its own chooser yet. The Get started page (the first screen) does, and the top bar and Settings keep the same choice.

### A5: one private overview, public files checked
- A-5.1: The private overview is the existing Admin → README, which is stored encrypted in the database and rebuilt from the code (src/readme-overview.js, src/readme-auto.js). Building a second store would duplicate it, so the tab is now called Overview and nothing new is stored in the repo.
- A-5.2: The AI rebuild of the overview after each push (asked in A5) is not built in this step. The code-built overview already regenerates on every deploy and on each open, which covers "only what is active now" without a model. An AI polish step needs a provider key in CI and is left for later, gated behind that key.
- A-5.3: Outdated top-level files moved to docs/archive/: AUDIT, BUG_REPORT, COPY_CHANGES, DESIGN_DECISIONS, LAYOUT_TEST_RESULTS, NEEDS_REVIEW, PLAN_GROWTH, STRUCTURE_AUDIT. Code comments that name them now point there. ASSUMPTIONS.md, FEATURES.md, PRO_REVIEW.md, LEGAL_REVIEW.md and COMPLIANCE_REVIEW.md stay at the top, because code and tests refer to them as live documents.
- A-5.4: A scan of the public top-level documents for server addresses, sslip names, Oracle references and personal emails found nothing.

### A6: ranked setup list
- A-6.1: The list is built from the existing setup check (the names and on/off state of each setting) by src/setup-tasks.js. Values are never part of it.
- A-6.2: Ranking: blockers (ENCRYPTION_KEY, persistent storage, admin email, Node version, the Alpaca market data key, email reset-password keys, the sender domain) first, then revenue and user growth (Stripe, Google sign-in, broker and Alpaca connect), then quick wins, then nice-to-haves. Within a tier, the quicker tasks come first. Done tasks sort last.
- A-6.3: Each open task has a "Do it" link to the admin page that changes it. The page no longer says "from Render": it describes the Oracle server and Admin → Keys.
- A-6.4: Not done in this step: the setup assistant inside the admin AI chat (it needs the chat's tool layer and step-up confirmation, see A6 in the brief). The ranked list it will use is ready (nextTasks in src/setup-tasks.js).

## Admin AI, smart and complete (2026-11-24)

### Part 1: the chat crash and ChatGPT as a provider
- AI-1.1: The crash came from the chat page replacing its whole message form when no model was listed, then setting handlers on the removed Stop button. The form is now kept; the message is shown above it and the box and Send are disabled. Every element lookup returns an empty stand-in when missing, so no handler can throw on null. When /status fails the page shows the real error with a Retry button.
- AI-1.2: OpenAI is a full provider (src/llm.js): id openai, "ChatGPT (OpenAI)", base https://api.openai.com/v1, key OPENAI_API_KEY (already in the key catalogue), streaming, tool calls and JSON output, and it is listed in the chat config.
- AI-1.3: The model comes from OPENAI_MODEL. When it is not set, the newest chat model that the key can list (GET /v1/models, cached 6 hours) is used. Reason: the OpenAI changelog could not be read from this environment (DNS failed), so no model name is hard-coded that might be wrong or retired. The owner can pin one with OPENAI_MODEL.
- AI-1.4: Parameters: max_completion_tokens instead of max_tokens; no custom temperature (reasoning models accept only the default; the default is fine for every model). A 400 that names a rejected parameter is retried once without it.
- AI-1.5: Errors: 401 names OPENAI_API_KEY in Admin → Keys without showing the key; insufficient_quota says the account is out of credit (not a rate limit); other 429s say rate-limited; other statuses pass the API's message through redacted. OpenAI's messages are not rewritten by the shared "key refused" wrapper.
- AI-1.6: Redaction: the streaming path for OpenAI-compatible providers now redacts system and message text too (it did not before). OPENAI_BASE_URL (not a secret) exists only so tests can use a fake server.
- AI-1.7: Not verified here: the chat page's no-model state in a real browser (it needs a signed-in admin on the live site). It is part of the live check.

### Part 2: the system picks the best AI for each need (partly)
- AI-2.1: The model catalogue is src/ai/catalog.json: strengths, tier, memberData (may the provider receive member data), free or paid, and prices. Prices are null where they are not verified: the router then treats the model as mid-cost and says so in the code. I did not check current prices or each provider's terms this session (the web fetch that would have checked OpenAI's pages could not reach the host). Those values must be verified before the cost limits (Part 3) rely on them.
- AI-2.2: Free tiers default to memberData false, because their terms usually let the provider use prompts to improve its models. Paid providers default to true only where their API terms say so; the owner should confirm this per provider before member data is sent to a new one.
- AI-2.3: Classification is by rules first, in order: image, code, translation, summary, structured data, a calculation (numbers, %, $), a long text, reasoning words, a short question, then general. The tiny-model check for unclear cases is not built; a general question simply gets the best fit.
- AI-2.4: Scoring: fit for the need (a model listed for the need scores far higher); hard needs (reasoning, coding, long, finance) favour strong models, the other needs favour small ones; a strong model is kept back from easy needs; free models get a bonus for easy needs and only +1 for hard ones, so a hard task keeps the strong model; unknown prices get a small caution penalty.
- AI-2.5: Health comes from the last real calls: a provider that refused its key or ran out of quota (401, 402, 403) is skipped for 15 minutes; a 5xx is skipped for 5 minutes; a 429 is only ranked lower. Fallback inside a request is the existing chain in src/llm.js.
- AI-2.6: Member data: the chat sends member: false (it has no member data flag yet). When a feature sends member data, it must pass member: true, which removes providers that may not receive it. Other AI features still use the existing chain and are not yet routed; that is the next step.
- AI-2.7: Chat: "Auto (best for each message)" is first and the default when at least one real provider has a key. Under each answer: which model answered, why, and the token count. "Retry with a stronger model" uses Claude, then ChatGPT. Per-feature fixed models and cost caps are not built yet.
- AI-2.8: Decisions are recorded (last 200) and shown in Admin → AI → Routing with the rules, the privacy rule per provider, which models answered and how often they finished (from real chat replies).

## OpenAI: active provider, key checks, and the webhook receiver (2026-11-24)

### Part 1: the keys are in the right place
- OAI-1.1: I cannot read the saved values from this environment (they are encrypted on the Oracle server, and only prefixes may be looked at). So the check runs where the keys are: at start, the key store moves any value saved under an API-key name that starts with whsec_ to its signing-secret name (OPENAI_API_KEY → OPENAI_WEBHOOK_SECRET), once; it only logs names. A value already in the signing-secret name is not overwritten.
- OAI-1.2: Saving a value is checked by prefix: a whsec_ value is refused in an API-key field, and an sk- value in a signing-secret field, each with the name it belongs in. Other providers' formats (for example sk-ant- and gsk_) are not refused, because their prefixes are not the same rule.
- OAI-1.3: Warnings: if the OpenAI API key is missing (or was a signing secret), Admin → Keys and Admin → AI show the exact message from the brief. A missing signing secret is also reported. The API key is never sent to OpenAI when it starts with whsec_ (src/llm.js).
- OAI-1.4: OPENAI_WEBHOOK_SECRET added to the catalogue (group AI, optional).

### Part 2: OpenAI as the active AI
- OAI-2.1: The active provider is stored as AI_PROVIDER in the key store (Admin → AI → Active AI provider), so it applies at once with no restart. "Automatic" removes it. Choosing a provider without a key is refused.
- OAI-2.2: When set to openai and the key is real, OpenAI is tried first; the next provider with a key answers when it fails (the existing chain in src/llm.js). Automatic keeps the free providers first, as before.
- OAI-2.3: The router prefers the active provider by +4 where it lists the need (never where it is weak), and the admin chat marks it "(active)".
- OAI-2.4: I did not set the active provider on the live site myself: that is part of the post-deploy steps, which need the live server.

### Part 3: the webhook receiver
- OAI-3.1: POST /api/webhooks/openai is registered before the API router, so it has no login and no CSRF check, and reads the raw body.
- OAI-3.2: Standard Webhooks signing is checked by hand (webhook-id, webhook-timestamp, webhook-signature; HMAC-SHA256 of "id.timestamp.body" with the base64 key after whsec_). I did not use the openai SDK's unwrap: the SDK is not a dependency here, and the manual check is short and tested. Events older than 5 minutes are refused with 400; a bad signature is 400; several signatures (key rotation) are accepted if one matches.
- OAI-3.3: Each event id is stored once (openai_events); a repeat is answered as a duplicate. The answer goes out before the work, which runs after it.
- OAI-3.4: response.completed fetches the response and finishes its job (and the waiting chat answer; the owner is told if they asked). response.failed/cancelled/incomplete mark the job failed with the reason, and the chat answer offers Retry. batch.completed downloads the results file into the job; batch.failed/expired/cancelled mark it and tell the admins.
- OAI-3.5: "Run in background" in the admin chat starts a background response (store on, background mode) and shows a waiting note; it completes through the webhook.
- OAI-3.6: Admin → AI shows the webhook address, whether the secret is set, the last event, the last refused signature, failures, and recent events. The "send a test" step is done in OpenAI's dashboard, which the page explains.
- OAI-3.7: Not built: a batch submission UI (the batch handling is in the receiver; nothing in the app starts a batch yet).

## Seven phases (2026-11-24)

### Phase 1: keys on the Oracle server, managed from Admin

| # | Decision | Reason |
|---|---|---|
| KS-1 | **A `secrets` table in the app's SQLite file**, one row per key: the value encrypted with AES-256-GCM under `ENCRYPTION_KEY` (the existing `encrypt()`), the last 4 characters, who changed it and when, and the last test. | One place on the server's own disk, included in every backup, unreadable without the master key. |
| KS-2 | **`secret(name)`: the key store first, then the environment.** A saved key is also written to `process.env`, so the many places that read `process.env` directly see it at once; every worker re-checks a version (count and newest change) every 3 seconds. | Live in every worker with no restart or redeploy, without rewriting hundreds of reads in one go; new code calls `secret()`. |
| KS-3 | **`ENCRYPTION_KEY` and host settings never go in** (also the database settings and Node's own options). | The master key cannot encrypt itself, and a bad host setting from a browser could lock the app out of its data. |
| KS-4 | **Values never reach a browser**: Admin shows the last 4 characters of secrets (plain settings such as addresses in full). The old `.env` export of real values now answers 410; the old masked view showed the first 3 characters too and now shows the last 4 only. | As asked: entered once in a password field, never shown again. |
| KS-5 | **Admin plus step-up for all of Keys** (the existing 15-minute password and 2FA unlock of Admin → Database), also for the older save, import and Stripe setup endpoints. One audit entry and one owner email per change; the email never holds the value. | Keys are the most powerful thing in Admin. |
| KS-6 | **Test calls** are read-only requests to each provider (a list of models, the account, one quote); the answer is scrubbed of the value. | A real check without side effects. |
| KS-7 | **"Copy to the server .env"** writes an encrypted request on the data volume; the host's update script decrypts it inside the app container and pipes the lines into `migrate.sh set-env` with no restart. Not through the `oracle-migrate` workflow input. | Workflow inputs are visible in a run's details, so a value must never pass through one; this reuses the same set-env step on the server. |
| KS-8 | The older encrypted blob of saved settings (`site_settings.env`) is moved into the table once at start. | Nothing saved earlier is lost. |

## One disclaimer, the mobile website, the Android app (2026-11-23)

| # | Decision | Reason |
|---|---|---|
| D-FOOT-1 | **The `<footer>` in public/app.html is the app's only copy** of the legal links and disclaimer, signed in and out, desktop and phone, with every rule for it in layout.css (hidden until the app knows who is signed in, never in popouts, above the tab bar with the safe area). The menu's `.navfoot` and the sign-up page's repeated sentence are gone; the sign-up page keeps its risk and security links. | Three style sheets fought over it (theme.css hid it, layout.css showed it, styles.css set it again) and the menu built a second copy, so signed-in users saw it twice. One copy in one place cannot drift. |
| D-FOOT-2 | Guarded twice: `test/footer.test.js` (no second copy in any app source, footer rules only in layout.css) and the mobile suite (the disclaimer counted on every page in the browser, signed in and out, English and Yiddish; hidden copies count too). | A source test catches a copy before it ships; the browser test catches one built at run time or translated. A hidden copy is one CSS rule away from showing twice. |
| D-MOB-1 | **44 px for the app's own controls** (header, tab bar, menu, the title's "i" and gear, page tabs) on phones and on every touch screen (`pointer: coarse`, so a phone held sideways too); fields 16 px on touch screens; checkbox rows 44 px on touch screens only. Page content keeps the theme's sizes (D-13). | These are the controls used on every page. Growing all content buttons pushed disclosures 100–290 px lower (D-13); touch-only checkbox rows leave desktop layouts and the golden gate (mouse) unchanged. |
| D-MOB-2 | Phone header: icons only; the connection badge leaves it except its **LIVE** warning; the owner's "View as" picker shows only while in use. | At 375 px the header ran off the screen (search and theme cut off). The mode button already says paper or live; a real-money warning must stay in view. |
| D-MOB-3 | The background-loading card sits under the side menu and above the tab bar on phones. | It covered the menu's last items. |
| D-MOB-4 | **Mobile suite** `test/e2e/mobile.mjs`: 6 phone sizes (360–414 portrait, 740 landscape), dark and Yiddish on two, plus the phone flows; its own CI job. `--base URL` is read-only (no account created; signs in only with the SMOKE test account), run by `live-mobile.yml`. Small targets inside page content are reported, not failed. | Every page and the main flows on real phone sizes in every push; the live check can never change data or write to a customer. |
| D-MOB-5 | **One minified style sheet** for the app page (built at start with the JS bundle), and `html.was-in` when the page request carries a session cookie (only its presence is read), so the header and menu hold their place from the first paint. | The dashboard's mobile score was 88–89: three render-blocking unminified sheets and a 0.074 layout shift on every load. Now 90 (sign-in 95), accessibility and best practices 100. |
| D-MOB-6 | The "i" joins a page's title as soon as the title is drawn, not after the page's data. | On a slow phone Research and Compare had no "i" for 8+ s (it also failed CI before this work). |
| AN-1 | The Android app talks to **https://app.brightolio.com** whenever `APP_URL` is empty, Render or sslip (the variable still holds the Render address). | The main address, served by the Oracle server; the old fallback was the raw server address and the default the Render one. |
| AN-2 | A **503 with `shed`** is retried quietly up to 3 times (Retry-After, max 8 s, growing), then a calm note with Try again; same rules and wording as the website, unit-tested. | The server refuses only non-critical calls and a refused call did not run, so a retry never doubles an order. |
| AN-3 | The disclaimer and the four links appear **once in the app** (More → About), worded exactly as the site's footer; a JVM test reads app.html and fails on a difference or a second use. | Same wording everywhere; the old app text named one broker and differed from the site. |
| AN-4 | Edge to edge with safe-drawing insets on every screen, Back returns to Home first (and cancels two-factor), wrapping chips at large font sizes, Try again when offline. | Android 15 draws apps edge to edge; without insets the sign-in screen sat under the status bar and the keyboard covered fields. |
| AN-5 | **Google Play upload only on a manual run with "Upload to Google Play" ticked**; pushes build, run the unit tests and refresh the APK download. | Nothing should reach Play by accident from an ordinary push. |
| D-DEP-1 | **Live verification uses the main address** (https://app.brightolio.com) when `APP_URL` is empty, Render or the server's direct address. Only `/healthz` and `/internal` calls (deploy.yml, the scheduler) keep the direct address. | The server answers pages on its direct address with a 301 to the main one, so the smoke test failed every check and rolled back every release to one old image. |
| D-DEP-2 | **A rollback that does not help is undone**: if the previous version fails the same smoke test, the new version goes back in and the run fails for a person to look at. | A broken check, address or outside service must not keep old code running silently for hours, as it did here. |

## Finishing the move to Oracle Cloud (2026-11-23)

Supersedes OR-12 (no rollback to Turso any more: restore a backup or rebuild the server instead) and
OR-13 (Render is no longer a standby app but a redirect).

| # | Decision | Reason |
|---|---|---|
| OR-14 | The site runs now on a **fresh database with every id counter at 10,000,000** (82 tables rebuilt with AUTOINCREMENT while empty), and the old data is merged in after Turso's reset. | Turso blocks reads and syncs until December 1; waiting would keep the site down, and getting around the block (or paying for overages) is not allowed. Separate id ranges make the later merge clash-free. |
| OR-15 | **Render serves no app**: `src/render-redirect.js` answers every path with a 301 to the same path on Oracle (only the path and query are kept; `//host` paths go to `/`), `/healthz` 200 for Render's check. render.yaml starts it with no build. It is also **the first import of server.js**, so a Render service that still runs `node server.js` redirects too and never opens a database or starts the app. | Old links and bookmarks keep working; nothing can run twice; it works whether or not Render follows render.yaml. |
| OR-16 | Workflows use the Oracle address: `APP_URL` only when it is set and is not the Render address, else `https://<ORACLE_HOST with dashes>.sslip.io`. The Render deploy hook is used only by the manual `render-redirect.yml`. A failed live check goes back to the server's previous image over SSH. | The workflow token cannot change repository variables, so nothing may depend on `APP_URL` being updated. |
| OR-17 | The moved banner comes from `/auth/me` (`notices`) while `TURSO_MERGE_PENDING=1`; per-person notices are a `user_settings` row `notice`, shown as a banner with a close button. Never email or text. | There is no in-app notification table; `notifyUser` sends email or SMS, which the merge must never do. |
| OR-18 | `POST /internal/check-trade`: a check account on the reserved `.invalid` domain, made directly in the database (no welcome email), buys and sells 1 SPY on paper. Verify uses it; during maintenance the trade must be refused. | There are no SMOKE_* secrets, and a check must never email anyone. |
| OR-19 | **The scheduled merge** runs every 6 hours from 2026-12-01 00:30 UTC, gated by the date and by `TURSO_MERGE_PENDING` on the server; on success it turns itself off through the API. Failures share one issue (comments after the first). | The brief; 6 hours keeps retries cheap and the issue list clean. |
| OR-20 | **The merge is rehearsed on a copy while the site stays up**; only then is the app stopped for the real merge, after an exact copy (SHA-256 checked). `turso-merge` itself works on a copy and replaces the live file only after every check. | Two independent guarantees that a failure leaves the live file exactly as it was; the site is down only for the seconds of the real merge. |
| OR-21 | **Same person** = same email, else phone, Google or GitHub id. The old account keeps id and history; the new account's rows move to it; on a clash the old row stays (its paper account, its history), except settings tables, where the newer value wins; the newer password and two-factor are kept; one `account_merged` audit row each. | The brief: one account, nothing lost, the person signs in with what they used last. |
| OR-22 | **Paused, not changed**: each automation is switched off exactly the way its job checks it (`active`, `enabled`, `deployed`, `daily`, `mode='manual'`, `status='paused'`, `paused=1`), and the previous value is kept in `merge_paused`. Scheduled orders whose time passed get "missed, not run (server move)". | Nothing runs late or by surprise, and every setting can be put back exactly. |
| OR-23 | **No silent loss**: `INSERT OR IGNORE` is checked by counting: any old row that does not land (other than live site settings) stops the merge. Cleared token columns take their column default (e.g. `locked_until` 0), not NULL. | A NOT NULL or UNIQUE failure would otherwise drop rows quietly (found by the tests: old accounts were being skipped). |
| OR-24 | Not copied: sessions, app handoffs, reset/verification links, phone codes, caches, job slots, the old `maintenance` and `hosting` site settings. A marker (`old_data_merged_at`) makes a second run change nothing. | Everyone signs in again; the live server's own settings win; reruns are safe. |
| OR-25 | **Before deleting anything**: the final copy of `pull.db`, encrypted like the backups, checked by decrypting it, kept 90 days on the server (and off-site when set). The Turso database is deleted only by matching its host name to the old `DATABASE_URL`, tokens revoked first; without `TURSO_API_TOKEN`, one issue with the three dashboard steps. | The brief; never delete the wrong database. |
| OR-26 | **Turso-only code is marked `merge-only`** and removed after the merge by `scripts/old-db-cleanup.sh` in one commit (tested: the suite passes after it). Workflow files keep their merge steps (inert), because a workflow's own token may not edit workflow files. Turso wording everywhere else (examples, labels, private README, privacy page, setup checklist) was replaced now; the libSQL client stays for the local file and for a shared server (deploy/k8s). | The merge tooling is needed until December; everything else had no reason to wait. |

## Load shedding and the memory leak (2026-11-23)

| # | Decision | Reason |
|---|---|---|
| LS-1 | **Fix the leak at its source**: SEC company facts are trimmed (only the ~30 figures the app reads, 10-K/10-Q of the last 12 years, 8 fields per row) before they are cached, under a new key (`sec:facts2:`); the old `sec:facts:` rows are deleted at start and the file is compacted once when most of it is free. | Whole documents were 7–9 MB each and filled the heap to 941 of 1048 MB and the database to 553 MB; raising limits alone would only have moved the crash. |
| LS-2 | `dbCached`'s memory front holds at most 64 MB of JSON (`MEM_CACHE_MAX_MB`) and never a value over 1 MB (logged once per key prefix). | A size cap, not just a count cap (2000 entries), so no cached value can fill the heap again. |
| LS-3 | The heap limit is **V8's real `heap_size_limit`** (`HEAP_LIMIT_MB` overrides), and the Oracle container runs with `--max-old-space-size=1536` (2 GB container). | 450 MB was Render's; on the VM V8 lets the heap grow towards its own limit before collecting, so 450 MB said "full" while the process had room. |
| LS-4 | **Only API calls can be shed.** Everything else (pages, the app shell, scripts, styles, images, fonts, the manifest, the service worker, Google sign-in) is critical; orders, risk, security, sign-in and webhooks stay critical as before. | A page that does not load is worse than any slowness, and static files cost almost nothing to serve. |
| LS-5 | **Hysteresis**: a level turns on only after the load stayed at or above it for 5 s (`SHED_SUSTAIN_MS`) and off after 3 s below (`SHED_CALM_MS`), sampled every 500 ms; the event-loop delay is the p90 of the last 2 s (not 10 s). Tests and drills that pin the load skip the wait. | One garbage-collection pause or slow query must not turn people away for 10 seconds. |
| LS-6 | A refused call gets `Retry-After` of 3–5 s (spread out). The front end retries it quietly up to 3 times (`public/shed-retry.js`), then shows "This is taking longer than usual. Trying again…" with a Try again button on the page, never an error popup. A browser opening a refused address directly gets a small HTML page that reloads itself. | The server is busy, not the market; people should not see raw JSON or a scary message. |
| LS-7 | `MAX_INFLIGHT` default 400 (was 200), `LAG_LIMIT_MS` 500, `SHED_AT` 0.85, all settings in `.env.example`; `/internal/load` and oracle-migrate `diagnose-load` show the parts of the load. | The VM has 2 CPUs and 2 GB for the app alone, more than Render's free instance; the diagnosis made the cause visible in minutes. |
| LS-8 | update.sh counts a deploy only when the app container runs the **new image ID** and answers /healthz. Otherwise it tries one more recreate after 10 s, then rolls back. oracle-migrate gains `deploy-now` (a deploy in the open, with its log and the app's start-up log). | The old container also answers /healthz, so a failed recreate was logged "Deployed" while 4-hour-old code kept running, and none of the fixes were live until a forced deploy. |

## One address: app.brightolio.com (2026-11-23)

| # | Decision | Reason |
|---|---|---|
| OR-27 | `PUBLIC_URL=https://app.brightolio.com` on the server, and a 301 from its other addresses (GET/HEAD only; not /healthz, /internal, localhost or posts). | Google sign-in is registered for that address only; one address also keeps cookies and links together. |
| OR-28 | While app.brightolio.com's DNS points at Render, Render **forwards** it to the Oracle app with the edge secret and `x-edge-host` (Caddy replaces X-Forwarded-Host), after the server confirms the secret. Only requests plainly for `*.onrender.com` are redirected to app.brightolio.com. | The VM has no Cloudflare token, so the DNS could not be changed from here; Cloudflare does not pass the custom host name the way the first version assumed, which caused a short redirect loop (fixed in a910bd3). |
| OR-29 | The server's redirect is on only while `PUBLIC_URL/internal/edge-check` answers with this process's boot id (checked every 5 minutes). | A redirect to an address that does not reach the server could loop; this makes that impossible. |
| OR-30 | Deploys take a lock (flock), remove renamed leftover containers, and retry then roll back a failed start; `repair` step. | The timer's deploy and a workflow's deploy collided and left the app down for a few minutes. |

## Move to Oracle Cloud Always Free (2026-11-23)

| # | Decision | Reason |
|---|---|---|
| OR-1 | The database becomes **one SQLite file on the VM's boot volume** (`/opt/brightfolio/data/quantpocket.db`, `DB_FILE=/app/data/quantpocket.db` in the container), with WAL, `busy_timeout=5000`, `synchronous=NORMAL`. `PERSISTENT_DISK=1` tells the start-up check and `/healthz/full` that this file lasts. | Turso's read limit took production down; a local file has no read bill and one server needs no network database. WAL lets readers run during writes; NORMAL is safe with WAL (at most the last transaction lost on a power cut, never corruption). |
| OR-2 | **Copy by sync, not by reads**: `scripts/turso-pull.mjs` is a libSQL embedded replica (`syncUrl` = Turso) that only calls `sync()` until no frames are left, then `integrity_check` and row counts on the file alone. Fallback b: `turso db export` with a `TURSO_API_TOKEN` secret. Fallback c: say that switching overages on briefly costs a few cents. | Turso blocks SQL reads over the limit; replica syncs are billed separately. Not waiting for the reset was the brief. |
| OR-3 | **Hourly `VACUUM INTO` backups made by the app**, each checked with `integrity_check` before it counts; 48 hourly, 30 daily (the first backup of each day), 10 manual. The daily one is gzipped, AES-256-GCM encrypted (key from `BACKUP_KEY`, else `ENCRYPTION_KEY`) and PUT to an Object Storage **pre-authenticated request URL** (`OCI_BACKUP_PAR_URL`); without it the status says "no off-site copy". | `VACUUM INTO` is SQLite's own consistent online copy, so the live file is never copied while it changes. A write-only PAR needs no OCI SDK or API keys in the app. |
| OR-4 | **Host actions are request files.** The app (user 1000, read-only container) writes `data/.deploy-request`, `.restart-request` or `.restore-request`; `update.sh` (root, every 2 minutes) carries them out and logs to `data/host-actions.log` and `data/.host.json`. `update.sh` now installs its own newer copy and `compose.yml`. | Giving the container the Docker socket would give it root on the VM. A 2-minute delay is fine for these actions. |
| OR-5 | `restore.sh` checks the backup alone first, keeps the current file (`.before-restore-<time>`), swaps, removes `-wal`/`-shm`, and puts the kept file back if the app does not answer. | A restore must never leave the server worse than before. |
| OR-6 | **Maintenance mode** (`MAINTENANCE=1`, or the run-time switch from Admin or `/internal/maintenance`): the scheduler returns `paused`, `placeOrder` and paper limit/stop orders answer 503 with a plain message, every API answer carries `X-Maintenance: 1` and the app shows a banner. The switch is kept in memory first, so it works while the database refuses. | The brief: no trading while the data moves. |
| OR-7 | **`STANDBY=1` is final**: such a server never runs jobs, whatever its database's hosting settings say. Render gets it at run time from `/internal/standby` (and saved on Render through its API when `RENDER_API_KEY` is set there). | After the move Render and Oracle no longer share a database; Render's Turso copy is old, and once the read limit resets Render would otherwise trade on stale data. |
| OR-8 | **`/healthz` runs no query.** It reports what the app's own statements saw last (`dbHealth()`); `/healthz/full` still queries. | A health check that reads spends reads, and a restart (Render's answer to a failing check) does not fix a database outage; it made the VM's deploy roll back while Turso refused reads. |
| OR-9 | **Admin step-up for server settings**: `/api/admin/server/*` needs the admin role and a password (plus 2FA when on) confirmed in the last 15 minutes for this session (`POST /unlock`); restore also needs the typed word RESTORE. Answers 403 (not 401, which signs the app out). Every action is in the audit log. Keys are reported by name and set/missing only. | The brief; the existing `secureConfirm` dialog is reused. |
| OR-10 | **The migration runs as `oracle-migrate.yml` + `deploy/vm/migrate.sh`.** The VM script reads its own `CRON_SECRET` from `.env`, so the workflow never handles it; Render calls use the `CRON_SECRET` secret. `set-env` masks every value and also reads `ORACLE_SET_ENV` (a secret), because workflow inputs are visible in the run's details. | Never print a secret; inputs are not secret. |
| OR-11 | Verify fails on: `/internal/verify` problems (schema, credentials not opening with this `ENCRYPTION_KEY`, no users, missing required keys), fewer rows than copied in any lasting table (sessions, job runs and caches may shrink), a failed login, or an order not refused while maintenance is on. The paper trade itself runs right after maintenance is off. | Orders are refused during maintenance by design, so a real paper trade can only be checked after it. |
| OR-12 | `switch-db` comments the Turso lines out (`#TURSO# DATABASE_URL=…`) instead of deleting them, and `oracle.yml settings` keeps that state. | Going back is one sed (`rollback`). |
| OR-13 | Render stays as a **standby that serves pages only** (maintenance and STANDBY on); neither Render nor the Turso database is deleted. | The brief; it is the way back. |

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

## Four-phase job: clock, page help, OFI lab, live pairs (2026-11-22)

### Phase 1: Home clock

- C-1: **One market calendar for the server and the browser.** The calendar moved from src/market-calendar.js to public/market-calendar.js, unchanged (it has no imports, so the browser loads it as a module). src/market-calendar.js now only re-exports it, so the old server imports keep working.
  - src/desk.js had its own hard-coded holiday and early-close lists for 2026–2027. They are gone; `HOLIDAYS` and `EARLY_CLOSE` are now built from the shared rules for older callers.
  - The date picker (clock.js) and the schedule's first-day rule (when.js) use the same file, so they no longer fetch /api/trading-calendar. The route stays for anything else that calls it.
- C-2: **One label, from one function.** `marketStatus()` in the shared calendar returns the status and the label ("Market closed: weekend · opens Monday 9:30 AM", "Market open · closes 4:00 PM", and so on). It is used by /desk/session, the Home clock, the order desk strip and the Market overview badge.
  - On weekends and holidays the next open names the weekday, as in the brief's examples; on evenings it says "tomorrow" when it is.
  - An early-close day says "closes 1:00 PM (early close)", and after hours end at 5 PM that day instead of 8 PM.
- C-3: **The clock never shows "open" before the server answers.** The shared calendar gives the state at once, and the /desk/session answer replaces it until the next open or close (this covers unscheduled closures listed in EXTRA_CLOSED on the server).
- C-4: **One clock and one timer.** `homeClock()` removes every #homeClock in the document and stops the previous timer before it draws. The timer lives in one module-level object (`CLOCK`), each loop only continues while it is the current clock, and it stops on leaving Home.
  - The clock is made once, right after the title. The extra "move it into the title row" call is gone.
  - On Home, the quick ticket's order desk strip leaves out its market-status part, so only the clock shows it. On the Trade page the strip keeps it.
- C-5: **Yiddish patterns were broken in the browser.** `public/i18n.js` called function patterns through `String.replace`, which passes `(match, group1, …)`. Every translation file writes them as `m => m[1]`, so they printed wrong letters. The app now passes the match array, which fixes every existing function pattern, and the clock labels are translated in public/i18n/yi-clock.js.
- C-6: **Where translations live.** i18n/ only holds the retired Yiddish label export (`RETIRED` in src/readme-auto.js); the live translations are in public/i18n/, which is where new text goes.

### Phase 2: Page help (the "i")

- H-1: **The guide moved from the page to a panel behind an "i".**
  - `addInfo(view, route)` in pages/guides.js draws a round "i" inside the page title, before the gear: title, then "i", then gear. It is the same size as the gear.
  - It is idempotent, and a watcher in app.js puts it back when a page redraws its own title, so a page always has exactly one.
  - The old `pageGuide()` is kept as a no-op for older callers, and Home's empty guide slot is gone.
- H-2: **The panel is a `<dialog>`: a drawer on the right on desktop, a sheet from the bottom on phones.**
  - It is mirrored in right-to-left languages: the drawer opens on the left.
  - A drawer keeps the page visible beside the help, which reads more professional than a centered pop-up on a wide screen. On a phone a bottom sheet is the platform's norm.
  - It is a modal dialog, so focus stays inside. It closes with ✕, Esc or a click on the backdrop, and focus returns to the "i".
- H-3: **First-time hint instead of an open card.** A page not yet opened shows a dot on its "i" (a gentle pulse, off under reduced motion) and, once, "New here? Tap i". Opening the panel marks the page as seen (the same `qp_guide_<route>` key as before, so pages people already dismissed stay quiet).
  - The Settings switches (`qp_guides`, `qp_help`) now only turn off the hint, never the "i"; the wording in Settings says so.
- H-4: **Every page has guide text.** 41 menu pages and tabs had none. Short plain-language guides were written for them in pages/guides-more.js, merged into the guides; an existing guide wins.
- H-5: **What moved and what stayed.**
  - Moved to the panel, through `<template data-info>` (a page can add its own beginner notes to its panel this way):
    - the Investing toolkit's per-tab lesson card;
    - Portfolio & risk's "Why it matters" note.
  - Stayed on the page, because none of them is beginner help:
    - the Playbooks API reference (technical reference);
    - the security lessons (they are that page's content);
    - the admin error explainer;
    - "The risks in plain words" and every risk or legal disclosure.

### Phase 3: Order flow (OFI) lab

- O-1: **Place in the menu:** Automate → Pairs & stat arb (the "Quant lab" pages: Pairs trading, Statistical arbitrage) gets a third tab, "Order flow (OFI) lab" (`#/pairs/ofi`).
- O-2: **One copy of the math.** The math lives in public/hfofi.js, re-exported by src/hfofi.js (the same pattern as the market calendar), so the browser and the server run the same code. The R project's functions are in research/hf-ofi/R/ofi.R; test/hfofi.test.js checks the JavaScript against numbers exported from R (R/export_expected.R) to 6 decimal places:
  - the first 60 values and the sums of every factor;
  - all 32 regressions;
  - the thresholds;
  - the positions and the gross and net statistics in and out of sample.
- O-3: **The original hf.Rmd is not in the repository**, so the brief is the specification. Where the brief left a choice, this is what was decided (in the README and the report too):
  - VOI and OFI start at the second update;
  - OFI-N is right-aligned (NA until N values);
  - "rolling differences" means each factor minus its value N updates earlier;
  - the position decided at an update earns the mid return to the next update;
  - percentiles are R type 7.
- O-4: **The look-ahead fix.** The 20th/80th percentiles come from the in-sample part (default: the first half) only, and the out-of-sample part is traded with them. A test shows that changing the out-of-sample data does not move the thresholds.
- O-5: **Costs.** Every change of position pays a fee (1 bp of the price by default) plus slippage (1 tick of size 1).
  - Statistics are shown gross and net: trades, hit rate, average per trade, total, max drawdown.
  - Sharpe = mean / sd of per-update returns × √(updates per day × 252), with updates per day = the updates in the session.
  - On the synthetic sample the strategy makes money gross and loses net, in and out of sample. The report and the page show that as it is.
- O-6: **Data.**
  - The real file (data/df_rb2305_am1.Rds) is git-ignored; the report stops with a clear message without it, or uses the synthetic sample (seeded, R/make_sample.R), which every figure labels.
  - The app accepts CSV only (RDS is an R format a browser cannot read), up to 20 MB, checked in the browser before reading.
  - Alpaca quotes come from the new `quotesRange()` (US equities, labelled so on the page), for 5–120 minutes of a trading day; weekends and holidays are refused with the shared calendar.
- O-7: **Downloads.** The R project is zipped on the fly by a small zip writer (no new dependency), without any data or rendered output. The PDF rendered from the sample is committed at research/hf-ofi/out/hf.pdf.
- O-8: **R was installed in this container** (R 4.3, tidyverse, rmarkdown, patchwork, RcppRoll, conflicted, pandoc and LaTeX from apt), and the report rendered.
  - paletteer is not packaged for apt, so it is an optional dependency; without it the report uses a fixed Tableau palette.
  - pdflatex needed the symbols − ≥ ≤ × √ Δ · declared in the report header.
- O-9: **Simulation only.** The lab never places orders, and the page shows the brief's academic-exercise line at the top and at the end.

### Phase 4: Live ratio pair bots

- P-1: **A second model in the pairs engine, not a separate project.** "Statistical (OLS z-score)" stays in src/pairs.js (daily bars, once a day). The new "Live ratio" model is in src/pairslive-math.js (pure functions) and src/pairslive.js (engine and routes). Both use placeOrder, the risk checks and the order queue, and the new page reuses the pair scanner for suggestions and the OLS daily backtest for the side-by-side comparison.
  - The Python project's design was not in the repository, so its description was turned into exact rules:
    - beta = mean(A) / mean(B) over the history window;
    - volatility ratio = sd(% changes of A) / sd(% changes of B);
    - divergence = A / (beta × B) − 1, in percent;
    - enter at ±entry%, exit inside ±exit% (or when it crosses over), stop at ±stop%;
    - the legs are sized by the volatility ratio (A gets 1 / (1 + ratio) of the money, B the rest), so both carry about the same risk.
- P-2: **Live data.** History comes from 1-minute closes (Alpaca bars, standing in for midpoints). Live prices are quote midpoints from the Alpaca stream: `watch()` lets the server follow symbols like a browser does, on the one shared connection. When the stream is quiet or not available (another brokerage, no data key), the last price is polled at each run.
  - Settings: the history window (30–1,440 minutes), the bar length (1, 5 or 15 minutes), recalculation every 1–15 minutes, and the thresholds.
- P-3: **Accounts.** The picker lists only the member's connected accounts (accountsFor), and every order goes placeOrder → checkOrder → order queue.
  - Before Start: the account must be connected and shorting allowed. That means margin switched on, even on Paper, because the practice account follows the same rule. On Alpaca the account must allow shorting and each symbol must be shortable and easy to borrow; another brokerage must support short sales. Otherwise nothing starts and the page lists why.
- P-4: **Two legs.** Buying power and every risk limit are checked for both legs before either is sent. The short leg goes first, as it is the one most likely to be refused.
  - If the second leg fails, the first is closed at once; if it fills partly, the first is reduced to the same fraction. The member is notified.
  - A close that fails stays in the bot's state and is retried at the next run.
- P-5: **Limits.**
  - Per pair: max loss and max position.
  - Per member: a daily loss over all live-ratio bots, and orders per minute (PAIRS_LIVE_MAX_ORDERS_PER_MIN, default 20, for brokers' rate limits).
  - The pattern-day-trader rule on real margin accounts under $25,000.
  - The kill switch: the bot pauses, and it sends no orders, because checkOrder blocks automated sells too. The member closes by hand.
  - Hours: regular hours on trading days only (the shared calendar from Phase 1), no new positions and everything closed `closeBeforeMin` minutes before the close (1 PM on early-close days) unless "hold overnight" is on. Closing never waits for history: a bug found in the session test, fixed.
- P-6: **Paper first.** A new bot is always created on Paper. Moving it to real money needs, as for Playbooks:
  - Pro;
  - a connected account;
  - an intraday backtest in the last 30 days;
  - at least PAIRS_LIVE_MIN_PAPER_DAYS trading days on Paper (default 5);
  - no open positions;
  - the step-up check, the password, and an explicit "I understand" confirm.
  It then waits stopped until the member presses Start.
- P-7: **Intraday backtest.** It uses Alpaca bars at the chosen bar length over 3–30 days, refits the model on past bars only, and charges a fee, slippage and a yearly borrow fee on the short leg. It is shown next to the OLS model's daily walk-forward backtest for the same pair, and labelled hypothetical.
- P-8: **Settings documentation.** The two new variables are in render.yaml and the private README (src/readme-auto.js, Admin → README). The public README.md is checked after every push to name no setting or key (scripts/readme-check.mjs), so they are not there.
- P-9: **The clean check keeps research/.** The R project is used offline and as a download, not imported by the app. The Phase 3 push had failed the CI clean check for that reason, which stopped the deploy for that push.

## Growth features: plan, data and menu (2026-11-22)

- G-1: **Plan names.** The brief asks for Free, Pro and Premium; the product has Starter, Pro, Elite and Ultimate (prices and Stripe products exist). Free = Starter and Pro = Pro; Premium means Elite and Ultimate, shown as one "Premium" tier label next to the plan names on the pricing page. No plan was renamed, so subscriptions and Stripe prices are unchanged.
- G-2: **One stock page.** It extends the Stock & fund analyzer (`#/analyze?symbol=`) with sections: Overview, Valuation, Fundamentals, Earnings, Dividends, Technicals, Supply & demand. A section is chosen with `&view=`, so old links keep working. No second stock page was made. Data: `src/stock.js` (SEC company facts and submissions, bars, quotes, Finnhub when keyed).
- G-3: **Menu placement** (STRUCTURE_AUDIT.md, "Growth features"):
  - Research → Stock & fund analyzer: the stock page, plus a "Compare" tab (`#/analyze/compare`).
  - Research → Scanners: a "Growth at a price" tab (`#/scanner/valuescan`).
  - Research → Research & news: "Rates vs stocks" (`#/research/rates`).
  - Track & plan → Risk: "Diversification" (`#/riskview/diversify`).
  - Automate → Alerts & signals: "AI morning picks" (`#/signals/newspicks`).
  - Automate → Bots: "AI intraday" (`#/bots/intraday`).
  - Invest → Portfolios: the AI tab is renamed "AI long/short portfolios".
  - Invest → Investing toolkit: "Passive investing" (`#/wealth/passive`) and "Dividends & income" (`#/wealth/dividends`).
  - Trade tools: "Active trading desk" (`#/active`), a new entry (the group goes from 6 to 7 items).
  - Funds compare lives on Low-cost funds, and futures specs on Futures, bonds & more.
- G-4: **Honest limits.**
  - No market depth: top of book only, said on the page.
  - Buy and sell volume is estimated from where bars close.
  - No futures or mutual-fund trading through the connected broker: research and paper, the closest ETF, and the brokers that do trade them.
  - No HFT: an "AI intraday" engine every 5 minutes within rate limits and the pattern-day-trader rule.
  - Forward P/E and expected EPS only with a Finnhub key; the next earnings date is estimated without one.
- G-5: **Naming (LEGAL_REVIEW.md).** "AI hedge funds" becomes "AI long/short portfolios" in the menu and on the page. They are rule-based portfolios in the member's own account, not funds, not pooled money, and not regulated products. The route `#/aifunds` stays.

- G-6: **What free members see (the sample before the paywall).** Free members see the real thing with less of it, never a fake preview:
  - stock page: two years of statements instead of five, and no AI summary;
  - supply & demand: no volume profile;
  - diversification: one suggestion of up to three;
  - dividends: safety scores for the first three holdings;
  - AI morning picks and AI intraday: the picks, the rules and the full record are free to read; using AI morning picks is Pro (real money Elite), using AI intraday is Elite, as PLAN_GROWTH.md set;
  - saved scanner filters and alerts: Pro.
  Each locked part names the plan that unlocks it and opens the upgrade window (the server answers 402 with `upgrade` and `feature`).
- G-7: **AI morning picks.** Ranked at 9:00 New York time from today's headlines and the pre-market move of 30 large US stocks. They are placed at 9:35 (automatic mode) or when the member approves. All are closed by 15:50 or at the stop.
  - Guards, all on the server: the kill switch, once a day, the daily budget (never above cash), the per-stock limit, a stop under each entry, the daily loss limit and the pattern-day-trader rule.
  - The practice account is the default. A real account needs the Elite plan, the password and the step-up check.
  - The public record keeps every pick and its open-to-close result, losses included, and shows the hit rate, the losing picks and the worst day.
- G-8: **AI intraday is a separate, ready-made engine, not a second copy of Bots.** The existing intraday bots (src/scanner.js) run rules the member writes, every 15 minutes or hourly. AI intraday is one fixed, published rule set (20-bar average, last bar and RSI 50–70 to enter; stop, target, RSI above 75 or back under the average to exit). It shares placeOrder, the kill switch and the risk limits with Bots and sits in the same Bots hub.
  - It runs every 5 minutes at the fastest (each member picks 5–60), with one decision per stock per run, so it is never called high-frequency trading.
  - Limits: new positions only from 9:45 to 15:45, everything closed at 15:50. Plus a minimum time between orders, a daily order cap, a cap per position and on open positions, a stop, a target, the daily loss limit and the pattern-day-trader rule (checked before a buy, so a protective sell is never blocked).
  - The kill switch stops buys, never a protective sell.
  - The ex-dividend option holds a stock from the dividend list overnight only when its ex-date is the next trading day. The page says the price usually drops by about the dividend that day.
- G-9: **AI long/short portfolios.** Each position is capped at 25% by default (the member can choose 10–50%) and the excess stays in cash.
  - Every weekly turn records the value, so the page shows the real record and its largest fall.
  - The backtest is labelled hypothetical. It covers about 6 months, because the rules need over a year of history to start; it assumes 0.05% cost per change and is compared with SPY.
  - Fees in plain words: no management or performance fee; brokerage borrow fees, margin interest and options costs still apply.
  - Approving real-account trades now passes the step-up check.
- G-10: **Mutual funds: the closest ETF.** Index mutual funds map to an ETF on the same index or market. For target-date and actively managed funds the ETF is only "similar in mix" or "similar in style", and the compare table says an active fund cannot be copied.
- G-11: **Futures stay research and practice only** (Alpaca has no futures).
  - Equity-index expiries are computed exactly (third Friday of the quarter), with the usual roll about 8 days before.
  - For the other contracts only the contract months are shown; their last-trading and first-notice days are left to the exchange calendar instead of being guessed.
  - The list of brokerages that offer futures names no fees or approvals.
- G-12: **Dividends & income.** Payments come from Alpaca corporate actions when market data is set up (funds included), otherwise from the dividend per share in SEC annual reports. The source is shown on each row.
  - The monthly forecast repeats the last 12 months of payments. Holdings with only a yearly figure are listed under the chart and counted in the yearly total, never spread over invented months.
  - Reminders the day before an ex-dividend date or an earnings report are opt-in.
- G-13: **Active trading desk.** It uses the brokerage's own day-trade count where Alpaca reports one; otherwise it says the brokerage keeps the official count. The risk line is "Day trading is risky and often loses money", with no statistic Brightolio cannot source.

- G-14: **Free / Pro / Premium on Plans & billing.** Each plan card and the comparison header show the tier (Free under Starter, Premium under Elite and Ultimate). A second group of rows, "Research and AI", lists the growth features by plan. A test keeps each row equal to the server's own check (for example, AI intraday is Elite, and free members get one diversification suggestion).
  - The homepage table is unchanged, because homepage copy waits for sign-off (LEGAL_REVIEW.md L18).
  - Annual plans and the trial were already on the page (P2-5, P2-6).
- G-15: **Linking.** Each stock-page section links to its matching tools:
  - Valuation → the scanner, Rates vs stocks and Compare;
  - Earnings → the calendar;
  - Dividends → the member's dividend income and DRIP;
  - Technicals → the full chart and AI intraday.
  Scanner matches can be saved as an Alpaca watchlist in one click; without a connection the page says watchlists live in Alpaca and links to Accounts. Saved filters already alert daily.
- G-16: **Upgrade prompts stay at the point of need** (P2-8). Every new paid action returns 402 with `upgrade` and `feature`, which opens the upgrade window naming the plan. No banners were added.

## Pro polish: trust and revenue (2026-11-20)

- P2-1: The review (PRO_REVIEW.md) found a mature landing page and pricing. The weak points were smaller and closer to the money: the upgrade window, the plan choice inside the app, sign-up, the first steps on Home, page titles and three accessibility failures. Those were fixed first; a rebuild of what works was not attempted.
- P2-2: No new marketing claims on the homepage. LEGAL_REVIEW.md L9–L12 show that a redesigned homepage was held back for legal sign-off. This round only adds a header link to the existing Security section and, under the final sign-up box, the footer's own first risk sentence (L13). Product screenshots, a shorter phone layout and customer stories are listed in PRO_REVIEW.md for after sign-off; customer stories only with real, consenting members.
- P2-3: "Most popular" became "Recommended" in the app and on the homepage. Nothing in the code backs "most popular", so it was an unverifiable claim; "Recommended" is an honest editorial label. A test keeps "Most popular" out.
- P2-4: The comparison table has one source for the app (src/fees.js COMPARE, served in /config), and a test keeps it equal to the homepage's table (scripts/home.py MATRIX), so the two can never disagree. It is open by default for Starter members and folded for members who already pay.
- P2-5: Yearly prices are shown as the monthly amount, large, with "billed $530 yearly" right under it, so the yearly charge is never hidden. In Monthly view each card says "or $44.17/month billed yearly".
- P2-6: The upgrade window offers the next plan up from the member's own, with that plan's real prices from /config. It replaces the hard-coded $29 fallback and the "Pro feature" title that was wrong for Pro members. Monthly is selected by default, and the yearly choice is the member's.
  - The trial is offered only to members who have not used one.
  - A payment problem, or the top plan, gets a plain message with no sales pitch.
- P2-7: Members who already pay (active, trialing or past_due) change plan in the Stripe billing portal. The app sends them there, and /billing/checkout refuses a second subscription (409). Before, a second checkout started a second subscription while the first kept billing. The portal must allow plan switches (NEEDS_REVIEW.md N-16).
- P2-8: Upgrade prompts stay at the moment a paid feature is used (the server's 402), with no banners added elsewhere: an honest prompt at the point of need, never a random interruption.
- P2-9: Sign-up has an `h1` and a short panel of facts already on the site (plan data, Security page, the not-a-broker line, the risk link). Logged as L14 for sign-off. This resolves N-4 for Create account (N-17).
- P2-10: Page titles use the menu or tab name, so they match what the member clicked, rather than the h1, which can include a pill such as "Paper".
- P2-11: Badge contrast is fixed by mixing the colour toward the text colour in the shared layer (layout.css), so it holds in light and dark themes without touching the theme palette.
- P2-12: Empty states use one `.empty` component with the next step. On Home, the step jumps to the ticket. Others: "No orders here" on Orders, and "Nothing billed yet" on Billing history.
- P2-13: Get started now leads to the first trade, then the first strategy, then a backtest, with security steps after. The first-trade step jumps to the ticket and puts the cursor in Symbol. After the first practice trade, one "Next step" line points to the strategy library until it is opened.
- P2-14: The performance-fee rate per plan is not shown at the point of choice. It is charged only in registered-adviser mode (off by default), members see their own rate, and the owner made the rates private (test/batch22). Recorded for an owner decision (N-15).
- P2-15: A menu error when the session ended mid-load (signed out in another tab) was fixed: render stops and the 401 handler's sign-in page shows.

## Equalize positions: choose the holdings (2026-11-20)

- E-1: Money for the included holdings. Without "cash to keep", it is what they are worth together now. With "cash to keep", it is the account value less that cash and less the excluded holdings' value. In both cases it is split evenly among them. Excluded holdings are never passed to the planner, so it cannot place an order for one.
- E-2: The server validates `exclude`: it must be a list, at most 500 entries, upper-cased and de-duplicated, and every symbol must be held in the account. Otherwise the request is refused with "Not held in this account: …". Excluding an option or a short is accepted and changes nothing, because they are never traded anyway.
- E-3: The run rebuilds the plan on the server from the account and the exclude list. An `orders` field sent by the browser is dropped. The password and "I understand" step is unchanged (secureConfirm only gained an optional onOpen hook to update its own content).
- E-4: Remembered exclusions are kept per account on the server (setting `equalize:exclude`), so they follow the user across devices. They are saved when the user changes a box (preview with remember) and when trades are placed. Symbols no longer held are dropped. A remembered list that would leave fewer than two holdings is not applied automatically.
- E-5: "Reset to all" shows only while something is left out. It does the same as Select all, and the next recount saves the empty list.
- E-6: Recount is debounced by 350ms with a sequence number, so a late answer never overwrites a newer choice. While it runs, the button says "Updating…" and is disabled, and Enter cannot place trades.
- E-7: With fewer than two boxes ticked, nothing is sent to the server. The summary says "Pick at least two holdings" and the button is disabled with the same words.
- E-8: When the remembered list leaves nothing to trade, the dialog still opens (with "No trades needed"), so the user can tick holdings back in. Without exclusions the old "Every holding already has about the same amount" message is kept.
- E-9: The sticky footer shows "To buy" and "To sell" totals (from the server plan) above Cancel and Place.
- E-10: Translations: Yiddish strings and patterns in public/i18n/yi-equalize.js, and the button and label words in the eight simple languages. i18n/yiddish-labs is a retired one-time translation workspace (README RETIRED list), so it was not changed.

## Home: one layout for every account, priority order (2026-11-19)

- H-1: One renderer for every account type. Practice and the other brokerages read `/account` (homeBasic); Alpaca reads `/alpaca/account`, `/alpaca/positions` and `/alpaca/portfolio/history` (homeAlpaca), so it keeps intraday history, margin numbers and today's change per position. `#/portfolio` now redirects to Home.
- H-2: The task text was cut off after "follow DESIGN_" and "Push deploy". I read these as "follow DESIGN_SYSTEM.md" and "push to main, which deploys".
- H-3: Time ranges are 1D, 1W, 1M, 3M, 6M, 1Y and All. 6M was kept because Alpaca already had it and removing a range would drop a feature. Practice accounts have only one point a day, so their ranges filter the daily history, and 1D compares with the day before. The choice is remembered in this browser (qp_period), and `?period=` still works.
- H-4: Total P/L means "since the account started" for practice and the other brokerages (as before), and "unrealized P/L on what you hold" for Alpaca, which reports no starting value. The tile's tooltip says which.
- H-5: "Open positions" became a count next to the Positions heading. The positions table keeps its data in 6 columns, so it fits the wide column without scrolling: quantity and average cost sit under the symbol, the P/L percentage under the P/L. It shows the 10 largest, with "All N positions →" when there are more.
- H-6: Today's change per position: a new `dayPl` on `/account` positions, from market-data snapshots (last price against the previous close). It is computed only when market data is on, and shows "-" otherwise. Alpaca uses its own intraday P/L.
- H-7: The sort order is remembered in this browser (qp_home_sort), because it is a viewing convenience.
- H-8: "Action needed" combines pending strategy approvals and "trading is blocked" (Alpaca) in one banner. Other pages keep their approvals banner (approvalsBanner, now built from approvalItems).
- H-9: Hiding "Get started" is saved to the account (the portfolio preference onboardHidden) as well as this browser, so it stays hidden on every device. Settings now saves the portfolio preference with the existing value spread first, so it never clears that flag.
- H-10: The account switcher in the title row lists the accounts you can trade. With several Alpaca accounts it adds "All accounts" and your groups, which open the All accounts page; this replaces the Alpaca "This account / All accounts / groups" chips. The header's Paper/Live switch is unchanged.
- H-11: The Alpaca "Market is open · closes 4 PM" line was dropped, because the title-row clock shows the New York time and session for every account.
- H-12: Alpaca accounts now have the quick ticket on Home (it already supports Alpaca orders, including real-money confirmation) and Recent orders. The Cancel button in Recent orders shows only for practice orders, because it cancels through the practice-order route.
- H-13: Skeletons: My day reserves 290px and Why my P/L moved 370px, the heights measured in the browser with a few positions, and Recent orders 132px. A P/L card for many holdings can grow taller than its slot; only the Balances & margin card below it in the right column moves then.
- H-14: Resizing the window redraws only the chart (an event Home listens to). It used to redraw the whole page, except on Alpaca, which redrew its own chart.
- H-15: Values under half a cent are shown as zero, because float leftovers showed "-$0.00".
- H-16: The Home spacing rule targeted `#view > .dash`, which never matched (pages sit in a wrapper inside #view). It is now `#view .dash`, so the 16px gaps apply.

## App structure: menu by goal, merged pages, redirects (2026-11-18)

- M-1: The audit (STRUCTURE_AUDIT.md) lists all 94 pages. Its sources are the code, FEATURES.md, the page guides and a browser crawl of every page against the mock broker, because the guides describe what each page is for in the members' words.
- M-2: Six member groups named for what members want to do (Research, Trade tools, Invest, Automate, Track & plan, Account & help), 5 to 7 entries each, so they fall inside the 6–8 groups and ~8 items asked for. The everyday Core list (Home … Market overview) is unchanged, because the phone tab bar and new members rely on it.
- M-3: A "merge" is a page with tabs whose tabs stay separate pages (HUBS in public/app.js): each tab keeps its own code, data, settings, query string and gear, so nothing is moved or rewritten and nothing can be lost. This is the pattern Marketplace and My business already used.
- M-4: Tab addresses are `#/<entry>/<tab>` (for example `#/bots/aibots`). A `?tab=` query could not be used, because many pages already use `tab` for their own tabs (AI bots, Investing toolkit, Learn, Insights…).
- M-5: Old addresses redirect with location.replace (the Back button does not loop), and the query string is kept (`#/aibots?tab=mine` → `#/bots/aibots?tab=mine`). The first tab of each merged page keeps its old address (`#/bots`), so the busiest pages never redirect.
- M-6: Bots = My bots, AI bots and Forecasts & AI agents. AI hedge funds went to Portfolios rather than Bots, because the page builds and holds a long/short portfolio. Signal fleet went to Alerts & signals rather than Bots, because it sends signals to accounts.
- M-7: Strategies = Strategy library, Playbooks and Backtest. The shared strategies and AI bots stay in the Marketplace, where members expect everything they can copy, and they are linked both ways (Related rows, plus "All shared strategies in the Marketplace →").
- M-8: Signals = Alerts to trades, AI signals and Signal fleet. Signal channels stay in the Marketplace (shared by members) and are linked from all three.
- M-9: Portfolios = rule-based Portfolios, Automated portfolios (robo), AI hedge funds and Rules across accounts, because all four hold a target mix and rebalance. Institutional portfolios went to Research & news: 13F holdings are research, not something you invest in.
- M-10: Risk = Portfolio & risk, Risk controls and Margin center. Short selling stays in Trade tools (it plans a trade) and links to Margin center and Risk controls.
- M-11: Research & news = Plain-language research, News & sentiment, Market intelligence and Institutional portfolios. Stock & fund analyzer = Analyzer and Earnings vs expectations, because the analyzer already shows earnings. AI assistant = Assistant and AI tools.
- M-12: Developers = Developer API, Agents & API, Code lab, Cloud algorithms and the new Alpaca AI & CLI tools tab. It sits in Automate, because a sixth or seventh group for 2–4 developer pages would be nearly empty. Pairs & stat arb (the old Quant lab trading pages) sits there too.
- M-13: Investing = Investing toolkit (Habits & tools, S&P 500 plan, Low-cost funds) and Futures, bonds & more (Futures, funds & savings; Bonds, rates & crypto; Tokenized securities). Long-term view went to Performance, because it reports results rather than offering a way to invest. Execution & routing also went to Performance (fill quality).
- M-14: Accounts = All accounts, Choose your brokerage and Alpaca account. Taxes = Taxes and Tax autopilot, and the autopilot tab hides while that add-on is off, as its menu entry did. Security & protection = Security & help and Investor protection. Text commands and Phone hotline became one Phone & text page, because they opened with the same setup card.
- M-15: Split: Bonds, rates & crypto held two jobs. Its developer half (Alpaca MCP server, trading CLI, the owner's Broker MCP, connecting AI agents) moved, unchanged, to a new page `#/alpaca-dev`, the Alpaca AI & CLI tools tab of Developers. The investor half keeps a one-line pointer to it.
- M-16: Settings was not split. It is long, but it already has a section jump menu and page-specific settings already live behind each page's gear. Splitting it into pages would break the links into its sections.
- M-17: The Playbooks page's own tab strip dropped its Developer API tab, because Developer API is now a tab of Developers and showed the Playbooks tabs there. The strip now wraps on phones (it overflowed at 375px).
- M-18: Tab labels reuse the pages' existing menu names, so search words, the README overview check and the existing Yiddish and simple translations still match. The only new names are the six groups, the merged entries, "My bots", "Alpaca AI & CLI tools" and the Related link texts.
- M-19: Breadcrumbs: the app has none. The tab strip names the merged page (aria-label) and the menu highlights its entry, and search lists every tab as "Group › Entry", so that covers where you are. I did not add a breadcrumb row, because it would push every page's content down.
- M-20: Related links sit at the end of each page (a "Related" row, one line), because placing them at the top would move every page's content and disclosures down. The exceptions are a single strategy and a single Playbook: their Related row sits at the top and jumps to their own backtest, run settings (the bot) and sharing (Marketplace listing or Playbook library), as asked.
- M-21: AI signals link to the alert-to-trade setup with one sentence under the signals table, not a link per row: alert-to-trade is a single setup (a webhook), not something set per signal.
- M-22: Translations: Yiddish for every new string (public/i18n/yi-structure.js). In the eight simple-translation languages I added rows only for the new group and entry names, because simple.js translates menus and page names only and never had the old page names either.
- M-23: Internal links that still point to old addresses (for example `#/backtest?run=1` from the bot list) are left as they are and go through the redirect, because rewriting dozens of links would add risk and change nothing for members. Only the two self-checks on a page's own address (Backtest, Cloud algorithms) were changed to accept both forms.
- M-24: Retirement & IRAs: its two tables were not in a scrolling box and made the page 1,307px wide at 1280px. They are now wrapped (found by the click-through; it was there before this change).
- M-25: Admin groups and My business are unchanged and still separate. Only the owner sees them, and the owner-only check now runs on the page a route draws, so a tab address cannot reach an owner page.

## Standing checks and Playbooks (2026-11-17)

- C-1: Check 1 is the workflow named "CI" (web-ci.yml): changed .js/.mjs syntax, the tests picked by scripts/ci-select.mjs (tests importing a changed module or touched test files, plus core, security, health, and order/money/auth/payment tests when those files change; the whole suite when package.json, the lockfile, server.js or src/db.js change), security and clean checks, and scripts/boot-check.mjs (server.js against the mock broker, /healthz).
- C-2: The full e2e left Check 1 (it takes ~12 minutes) and runs in the deep check; e2e.yml still runs on push in parallel and does not gate the deploy.
- C-3: deploy.yml reverts the deployed commit on main (a new revert commit, never a force-push) and opens an issue when the live /healthz/routing check fails; it never reverts a revert, and starts CI on the revert because workflow-token pushes start no workflows.
- C-4: deep-check.yml runs after "Deploy to Render" succeeds on main: full tests, e2e, npm audit (high), then the Claude Code bug hunt over the diff since the last commit tagged deep-checked-*; one at a time (concurrency group), skipped when a newer commit is on main, stops with an issue after 3 Deepfix/Autofix commits in a row, writes BUG_REPORT.md.
- P-1: Block-based strategies are called "Playbooks". They are stored in user_strategies with template_id 'playbook' (no new table), so they share the engine, Reality Check, trailing stops, strategy_runs and the daily model record.
- P-2: One JSON format (src/rotation/playbook-core.js) for the editor, the AI builder, the backtester (engine.js kind 'playbook') and the executor; conditions use only the indicators in src/rotation/indicators.js; a vote condition ("k of n") keeps the existing designs convertible.
- P-3: Validation lists every problem at once; a ticker is "real" when price history loads for it (unknown tickers are rejected before saving AI output or deploying).
- P-4: Versions are a JSON column (user_strategies.versions, last 50); deploy and publish need a backtest of the current version.
- P-5: Playbooks run 20 minutes before each day's real close (13:00 on early-close days), never in the last 5 minutes, at most once a day (claim key playbook:<id>:<day>); a rebalance day the server slept through is logged as expired and the user notified the next morning; nothing is ever traded late.
- P-6: The old strategy runner (runAuto) and the strategies list skip Playbooks, so nothing runs twice and the strategies page shows only its own kinds.
- P-7: Copies of ready-made or shared Playbooks follow real accounts by approval unless the business runs in adviser mode, the same rule as the ready-made strategies.
- P-8: The library seed is the public blueprints with their example tickers, converted to Playbooks; pullback and macro designs have no Playbook equivalent and are left out; the owner-only original strategies are never published.
- P-9: Three reports from different people hide a library entry until an admin restores or unpublishes it.
- P-10: Discovery filters on backtested drawdown (low 15%, medium 30%, high any; 5 points tighter under 3 years) and leaves out leveraged funds unless risk is high; it is labelled education, not advice.

- P-11: The editor moves blocks by drag and drop and by buttons and Alt+Up/Down (keyboard and phones); undo/redo keeps 100 steps in the page; the server re-checks every save, so the editor's live check is a convenience.
- P-12: Votes ("k of n") come from converted designs and are shown read-only in the editor (edited in the JSON); new conditions are single comparisons.
- P-13: Playbooks live in the Automation menu; the Library, Discover and Developer API are tabs on the same page. (Since 2026-11-18: Automate → Strategies → Playbooks; Developer API is a tab of Developers, see M-17.)
- A-1: Business account types (LLC, partnership, family office) are account metadata with entity name and type, offered only where BROKER_SUPPORT allows: the practice account now; no live broker connection in Brightolio is confirmed for entity accounts, so none is offered there until the owner sets BROKER_ACCOUNT_TYPES. IRA labels stay available on every account, as before.
- K-1: API keys share the api_tokens table with the agent tokens (kind 'api' vs 'agent', additive columns); the agent token list, count and MCP sign-in only see kind 'agent'.
- K-2: Scopes: read (always), write (create, edit, backtest), trade (deploy, pause, resume, skip, rebalance, close); per-key limit 1-600 requests a minute; revoked keys are kept, marked revoked.
- K-3: Real-money deploy, resume, rebalance and close are refused over the API (403): they need the website's step-up confirmation, which an API key cannot give. Practice-account trading works over the API through the same handlers and placeOrder.
- K-4: The docs are the in-app page #/developers (/developers redirects there), built from public/openapi.json, so the docs and the spec cannot drift apart.
- U-1: The Scheduled trades page redraws itself after saving only while it is still open; a late redraw used to wipe the page the user had moved to (found by the Playbooks e2e).

## Scheduled trades (2026-11-16)

- S-1: US market calendar computed from the NYSE rules (holidays, observed days, 13:00 early closes, a list for unscheduled closures) in src/market-calendar.js, so no yearly table needs updating; used by the session checks, repeats, "before the close", "next open" and the date picker.
- S-2: Every scheduled order has a grace window (default 15 min, shorter for "N minutes before the close"); missed by more, it expires with a note and a notification and is never sent late; a repeating order moves to its next run.
- S-3: The window counts from the order's time, or from the next open when the market is closed then, so an order timed before the open runs at the open (as before) and is not treated as late.
- S-4: "At the close" and "at the next open" use Alpaca's closing and opening auction orders (time in force cls / opg, whole shares, sent 30 and 50 minutes ahead, before the 15:50 and 9:28 cut-offs taken from Alpaca's order documentation as known; the docs could not be fetched from this environment). Paper and other brokers have no auction order: the review screen says so and a timed market order is sent instead.
- S-5: The existing test that ran a 10-day-late scheduled order now uses an order 5 minutes late: the double-run assertion is unchanged, and sending a 10-day-late order is exactly what the new rule forbids (covered by test/schedule.test.js).
- S-6: POST /schedule on any account other than the practice account goes through stepUpGuard, the same check as /orders.
- S-7: The calendar endpoint is /api/trading-calendar (the /api/market router requires sign-in; the calendar is public data).
- S-8: The "When" fieldset sets min-width: 0 and its chips wrap: a fieldset's default minimum width made the order desk wider than a phone screen, which pushed the sticky Trade bar off-screen.
- S-9: POST /schedule/preview returns an incomplete or past choice as {error} (shown on the form), not as HTTP 400; POST /schedule still refuses it with 400. The "At a date and time" picker starts on the next weekday whose 9:30 open is still ahead.
- S-10: The e2e gives its throwaway test account the Pro plan only around the scheduling steps (written straight into that run's temporary database, as Admin → Users would), then sets it back to free so the later free-plan checks are unchanged; the Close later step buys its own paper position first.
- S-11: Run history is a JSON column (scheduled_orders.history, newest last, at most 50 entries) added with ALTER TABLE, not a new table, to keep the database change to additive ALTER TABLE entries; last_result is kept and holds the latest line, so older screens still work.
- S-12: Schedule notifications go through src/notify-user.js (text for verified paid users with credits, otherwise email) on create, edit, run, failure, expiry and end date.
- S-13: Edit (PUT /schedule/:id) re-runs the same validation as create and is conditional on the run time it read, so it cannot collide with a run in progress; a finished or cancelled schedule cannot be edited. Step-up applies when the schedule is on, or is moved to, a real-money account.
- S-14: Pausing needs no step-up (it makes an order safer); resuming a real-money schedule does. A resumed order whose time passed by more than its window expires (never sent late).
- S-15: An end date applies to repeating schedules only and ends after that New York day; a run after it is never scheduled.
- S-16: A price condition ('above' / 'below' a level) is checked with the last price when the order runs; not met, nothing is sent, the history says why and the user is told; with no price available it fails safe (nothing sent).
- S-17: Scale-out closes the position in 2 to 10 steps, 5 minutes to a day apart: each step sells an equal part of what is held at that moment (the last step the rest), so no step can exceed the position; if the position is gone, the schedule ends with a note. A scale-out never uses the closing auction (its later steps run at other times) and never repeats.
- S-18: Stop, stop-limit, trailing-stop and bracket orders are now read by placeOrder itself (advancedOf in src/brokers.js), so the order desk's existing routes are unchanged and scheduled orders reach them through placeOrder with source 'schedule' and every guard; limitOf still rejects these types on its own (an existing test relies on it). Shares only; brackets take whole shares and need take-profit above stop-loss for a buy (below for a sell).
- S-19: On the practice account, scheduled stop and stop-limit orders go to its existing order book (src/paperorders.js); trailing-stop and bracket orders are Alpaca only, and other brokers get a clear refusal. These types are never auction orders: "At the close" / "At the next open" send them as timed orders, and the review says so.
## Deploys

- D-1 (2026-11-16): released flag removal, permanent layout layer, Chat, planning tools, AI explainers, comms drawer for users with a number, previous homepage kept, post-deploy smoke/rollback workflows; merge commit f392309; gates npm test 354/0, e2e 435 exit 0, security:check 0; no revert. The page-snapshot gate still flags Admin → SEO (Feature flags card gone) and the owner to-do list (flag steps gone): intentional, snapshot update for those two pages left for the owner.
- D-2 (2026-11-17): released scheduled trades slices 1-2 (market calendar with holidays and early closes, grace window and expiry, Alpaca auction orders, step-up on real-money schedules, the When choice on the quick ticket, order desk, positions and Scheduled trades page, clock and date pickers, Close later); merge commit 12e1b50; gates npm test 365/0, e2e 438 exit 0, security:check 0; CI, e2e, Deploy to Render (routing and database checks) and Verify live site (smoke plus 15-minute watch) passed; no revert. Follow-up aa35073 removed a node_modules symlink committed by mistake in c71fc5f. Not done: the signed-in paper schedule/edit/cancel/run check on the live site, because the SMOKE_EMAIL / SMOKE_PASSWORD repo secrets are empty and the live host is not reachable from this environment; the same flows are covered by test/schedule.test.js and the e2e against the mock broker.
- D-3 (2026-11-17): released scheduled trades part 3 release A (edit and pause, end date, run history, notifications via notify-user); merge commit f02d0e2; gates npm test 368/0, e2e 439 exit 0, security:check 0; CI, e2e and Deploy to Render (routing and database checks) passed; its live-site watch was cancelled when D-4 deployed 12 minutes later, and D-4's watch covered the same site; no revert.
- D-4 (2026-11-17): released release B (price condition, scale-out closes, a3d3fb6) and release C (stop, stop-limit, trailing-stop and bracket orders through placeOrder, f1f2a34) together as b089e52, to save one 15-minute pipeline cycle; gates npm test 373/0, e2e 440 exit 0, security:check 0; CI, e2e, Deploy to Render (routing and database checks) and Verify live site (smoke plus 15-minute watch) passed; no revert. The signed-in paper schedule/edit/cancel/run check on the live site is still not possible from here (SMOKE_EMAIL / SMOKE_PASSWORD secrets empty, live host unreachable); the same flows run in the e2e against the mock broker on every push.
- D-5 (2026-11-17): applied the previous session's three unpushed commits from patches 0001-0003 (fast Check 1 + deep check + revert-on-failed-live-check CI; Playbooks backend; Playbooks UI, business accounts, developer API v1) on main e108c38 with git am (clean, no conflicts) and pushed straight to main as the owner asked; local gates before push: npm test 389 pass / 0 fail / 3 todo, security-check and the new boot-check passed; e2e left to CI.
