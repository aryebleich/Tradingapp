# MIGRATION_ORACLE.md: Brightolio on Oracle Cloud

On 2026-11-22 the Turso database (organization thecompountproject) went over the free quota and
Turso blocked the whole account: every SQL read and every replica sync is refused
("403: SQL read operations are forbidden") until the monthly reset on December 1, 2026. That took
the site down. Brightolio now runs entirely on the Oracle Cloud Always Free server, with its own
database file. The data from before November 22 comes back by itself after the reset (below), and
then nothing is left on Turso.

No money was spent: no Turso overages, no plan upgrade, nothing on Oracle beyond Always Free.

## What runs where (2026-11-23)

| | Now |
|---|---|
| The site | **https://app.brightolio.com** (the Oracle VM `138.2.233.183`, Ubuntu 24.04, ARM, Always Free, Docker, Caddy HTTPS; its own address https://138-2-233-183.sslip.io redirects there) |
| Database | SQLite file `/opt/brightfolio/data/quantpocket.db` (WAL) on the VM's boot volume: `DB_FILE=/app/data/quantpocket.db`, `PERSISTENT_DISK=1`. Started fresh on 2026-11-23 with every id counter at 10,000,000 |
| Jobs (bots, scheduled trades, alerts, Playbooks, pairs) | the VM's own scheduler; it is the only active server (Admin → Hosting). GitHub's `scheduler.yml` also ticks it every 10 minutes as a backup clock (each job claims its slot first, so nothing runs twice) |
| Backups | every hour, `VACUUM INTO` + `integrity_check`: 48 hourly and 30 daily in `/opt/brightfolio/data/backups`. A daily encrypted copy goes to Oracle Object Storage once `OCI_BACKUP_PAR_URL` is set (it is not set yet: Admin → Database says so) |
| Keys | `/opt/brightfolio/.env` (mode 600), written from the `ORACLE_ENV` secret by `oracle.yml`; changed with `oracle-migrate.yml` step `set-env` |
| Deploys | the VM's `brightfolio-update` timer: every 2 minutes it builds the newest `main` and switches only when `/healthz` answers. `deploy.yml` then checks paper/live routing and the database on it; `post-deploy.yml` smoke-tests and, on two failures in a row, goes back to the previous image |
| Render | being left (2026-11-25). Nothing in the app, the workflows or Admin uses it. Until the DNS change in issue #55, Render still passes app.brightolio.com on to Oracle; then its custom domain is removed and the service suspended (by the owner, in the Render dashboard). |
| Turso | blocked until 2026-12-01; holds the data from before November 22 until the scheduled merge has copied it, then it is deleted |
| `APP_URL` variable | still the old Render address until the owner sets it to https://app.brightolio.com (the workflow token cannot change repository variables); every workflow uses https://app.brightolio.com unless `APP_URL` is a brightolio.com address, and the server's own address only for direct checks |

## The main address: app.brightolio.com

Google sign-in, Stripe, OpenAI and every link use `https://app.brightolio.com` (`PUBLIC_URL`). The
server's own address and its bare IP send visitors there (see "One address" below). How it got here,
including the time Render passed the address on, is in docs/archive/MIGRATION_ORACLE-render-era.md.

## Workflow runs

| # | Workflow, step | Run | Result |
|---|---|---|---|
| 0 | oracle.yml check | [45096424308](https://github.com/aryebleich/Tradingapp/actions/runs/45096424308) | Connected, ports 80/443 open, Caddy up; the app answered 503 because Turso refused reads |
| 1 | oracle.yml settings | [45098085152](https://github.com/aryebleich/Tradingapp/actions/runs/45098085152) | Settings written, 489263a deployed; `/healthz` 200 (it runs no query) |
| 2 | oracle-migrate maintenance-on | [45098275849](https://github.com/aryebleich/Tradingapp/actions/runs/45098275849) | VM in maintenance; Render did not answer (asleep / redeploying) |
| 3 | oracle-migrate pull | [45098845966](https://github.com/aryebleich/Tradingapp/actions/runs/45098845966) | Refused: `Sync(PullFrame(403, "SQL read operations are forbidden"))`. Replica syncs are blocked too; not worked around |
| 4 | oracle-migrate fresh-db | [45207972368](https://github.com/aryebleich/Tradingapp/actions/runs/45207972368) | New database: 112 tables, 82 counters at 10,000,000, integrity ok; the earlier local file (0 users) kept as `quantpocket.db.before-switch-20261123T154207`; verify OK |
| 5 | oracle-migrate status | [45208641780](https://github.com/aryebleich/Tradingapp/actions/runs/45208641780) | Database `file`, maintenance on, first hourly and daily backups made |
| 6 | oracle-migrate activate | [45209120935](https://github.com/aryebleich/Tradingapp/actions/runs/45209120935) | Oracle is the active server (`thisHostActive: true`); no Cloudflare edge or DNS is set up, so nothing else to point |
| 7 | oracle-migrate maintenance-off | [45212795298](https://github.com/aryebleich/Tradingapp/actions/runs/45212795298) | Maintenance off; verify OK; the paper-trade check failed (the check account had no paper account) → fixed in 0374725 |
| 8 | oracle-migrate verify | [45213418154](https://github.com/aryebleich/Tradingapp/actions/runs/45213418154) | **OK**: `/healthz/full` ok, file database, schema complete, active, maintenance off, a paper trade (buy and sell 1 SPY) filled |
| 9 | render-redirect | [45213426249](https://github.com/aryebleich/Tradingapp/actions/runs/45213426249) | Render deployed the redirect: `/app?from=render`, `/`, `/terms`, `/api/auth/me` → 301 to the same path on Oracle |

## The merge (automatic, from December 1)

`.github/workflows/oracle-merge-scheduled.yml` runs every 6 hours from **2026-12-01 00:30 UTC**
(00:30, 06:30, 12:30, 18:30). It is skipped before then and once `TURSO_MERGE_PENDING` is gone
from the server, so after one success nothing runs again. Each run:

1. **merge-turso** (`deploy/vm/migrate.sh`): maintenance on (trading paused, orders refused) →
   the old database copied once into `data/pull.db` by replica sync only, `integrity_check` →
   a **rehearsal** of the whole merge on a copy while the site stays up (a failure here touches
   nothing) → the app stopped for the few seconds of the real merge, an **exact copy** of the live
   file kept (`quantpocket.db.before-merge-<time>`, checked by SHA-256) → the merge
   (`scripts/turso-merge.mjs`, which itself works on a copy and replaces the live file only when every
   check passed) → the app started, `/internal/verify` → maintenance off. Any failure: the exact copy
   goes back, `TURSO_MERGE_PENDING` stays set, maintenance goes off, and the next run tries again.
2. **verify**: health, schema, credentials, a paper trade.
3. **final copy**, then **delete the old database**, **remove the old settings**, **remove the
   merge-only code** (below), and the workflow turns itself off.
4. On a failure: **one** GitHub issue ("Oracle: bringing back the data from before November 22
   failed"); later failures add a comment to it.

What the merge does with the data:

- **Ids.** Old rows keep their ids (all below 10,000,000); rows made since November 23 are above it.
  An old id at or above 10,000,000 stops the merge. A live table without the raised counter (made by
  a later migration) has its clashing rows moved up by 10,000,000, with every foreign key that
  points at them. `foreign_key_check` must show nothing the old data did not already have.
- **One account per person.** Same email (any case), else the same phone, Google or GitHub id: the
  old account keeps its id and history; the new account's rows move to it (on a clash the old row
  stays, except settings, where the newer one wins); the newer password, two-factor and sign-in links
  are kept; the new account row is removed; each merge is in the audit log (`account_merged`). After
  it, no email has two accounts. A referral number or code that two different people happen to share
  moves on the new account.
- **Automations come back paused**: bots, AI funds, alerts, agents, baskets, channel follows,
  equalize, family plans, income bots, live and pair bots, rules, scanners, scheduled orders, scripts,
  signal hooks, strategies, Playbooks (`mode = 'manual'`), open signal and news trades, and the order
  queue. What each was before is kept in the `merge_paused` table. Scheduled times that passed during
  the gap are marked "missed, not run (server move)" and are never run late. Each affected person
  gets one notice **in the app only** (no email or text): "Your automations are paused after our
  move. Review and turn them back on." Paper and live accounts stay as they were; the merge sends no
  order.
- **Not copied**: sessions, app handoffs, reset and verification links, phone codes, caches and job
  slots (everyone signs in again); the old `maintenance` and `hosting` site settings (the live ones
  stay). Stored broker keys are copied as they are (the same `ENCRYPTION_KEY`), and at least one must
  decrypt or the merge stops.
- **Counts**: per table old, new, copied and merged (old + new = merged, minus account merges and
  dropped duplicates of a merged account); `integrity_check`; then the report goes to
  `data/pull-report.json` and the run's summary.

The banner "We moved to a new server. Your account history from before November 22 will be back by
December 2." is shown to signed-in people while `TURSO_MERGE_PENDING=1`, and disappears with it.

## After the merge: nothing left on Turso

- **Final copy** (before anything is deleted): `pull.db`, encrypted (gzip + AES-256-GCM with
  `BACKUP_KEY` or `ENCRYPTION_KEY`), checked by decrypting it again, at
  `/opt/brightfolio/data/final/old-db-final-<date>.db.gz.enc` (details in `final-copy.json` next to
  it), and in Object Storage under `final/` when `OCI_BACKUP_PAR_URL` is set. Kept **90 days**, then
  deleted by the hourly backup job. `pull.db` itself is removed.
- **The Turso database**: with a `TURSO_API_TOKEN` secret the workflow lists the organization's
  databases, deletes only the one whose host name is the server's old `DATABASE_URL`, after revoking
  its tokens, then revokes the API token (`brightolio-migrate`, or the `TURSO_API_TOKEN_NAME`
  variable). Without the secret it opens **one** issue with the three dashboard steps.
- **Settings**: the commented `#TURSO#` lines are removed from `/opt/brightfolio/.env`.
  `DATABASE_URL` and `DATABASE_AUTH_TOKEN` must also go from the **`ORACLE_ENV` secret** (only the
  owner can edit it); until then `oracle.yml settings` writes them back commented out, unused.
- **Code**: `scripts/old-db-cleanup.sh` removes everything marked `merge-only` (the sync copy, the
  merge, the final copy, their tests, the merge steps in `migrate.sh`, the banner and the pending
  flag) in one commit; tested before it was committed (the suite passes after it). Not removable by
  the workflow (its token may not edit workflow files): `oracle-merge-scheduled.yml` (turned off by
  then) and the merge step names in `oracle-migrate.yml`, which do nothing once the merge has run;
  delete them by hand whenever convenient.

## Restore a backup

- **Admin → Database** → a backup → Restore (password, then type RESTORE). Within 2 minutes the
  server stops the app, keeps the current file as `quantpocket.db.before-restore-<time>`, puts the
  backup in and starts again (the kept file goes back if the app does not answer).
- **Actions** → Oracle database move → step `restore`, input `backup` = the file name (Admin →
  Database lists them). Then step `verify`.
- **By hand**: `sudo bash /opt/brightfolio/src/deploy/vm/restore.sh /opt/brightfolio/data/backups/<file>.db`
- An off-site copy (`*.db.gz.enc`) is decrypted first, in the app directory with `BACKUP_KEY` or
  `ENCRYPTION_KEY` set as on the server:
  `node -e "import('./src/backup.js').then(m=>process.stdout.write(m.decryptBackup(require('fs').readFileSync(process.argv[1]))))" daily-….db.gz.enc > restored.db`

## The keys in the database (Admin → Keys, 2026-11-24)

- The keys managed in **Admin → Keys** live in the app's own database on the server (table
  `secrets`), each value encrypted with AES-256-GCM under `ENCRYPTION_KEY`. Every backup (hourly,
  daily, off-site) therefore holds them too, **still encrypted**.
- **The same `ENCRYPTION_KEY` is needed to read them after a restore.** It lives only in the server
  `.env` (from the `ORACLE_ENV` secret), never in the database: keep a copy of it somewhere safe
  outside the server. With a different key the app still starts, the stored keys read as missing
  and the `.env` values apply; add them again in Admin → Keys.
- A key that must survive restoring an *older* database (one saved before the key was added): use
  **Copy to .env** next to it in Admin → Keys. The app leaves an encrypted request on the data
  volume; the host's update script hands it to `migrate.sh set-env` within 2 minutes (no restart,
  values never logged).
- Order when both are set: the Admin value wins; removing it in Admin falls back to the `.env` value.

## Rebuild the server from a backup

If the VM is lost: make a new Always Free VM (Ubuntu 24.04, ARM; ports 22, 80, 443 open), put its
public IP in the `ORACLE_HOST` variable and its key in `ORACLE_SSH_KEY`, then:

1. Actions → Oracle server setup → `full` (installs Docker, Caddy, the app, the update timer).
2. Oracle database move → `set-env` with `DB_FILE=/app/data/quantpocket.db;PERSISTENT_DISK=1`.
3. Copy the newest backup to `/opt/brightfolio/data/backups/` (from the old server, or from Object
   Storage, decrypted as above), then `restore` with its name, then `activate` and `verify`.
4. Point `app.brightolio.com` at the new server: an A record to its IP (DNS only), then run the
   oracle-migrate step `caddy-site` so Caddy serves it.

## Decisions

DECISIONS.md, "Move to Oracle Cloud" (OR-1 to OR-13) and "Finishing the move" (OR-14 to OR-26).

## One address: https://app.brightolio.com

- **The site's address** is `PUBLIC_URL` (and `APP_DOMAIN`, which sets the Caddy site) = https://app.brightolio.com. Visitors on any other address of this server get a 301 to the same path there: its own name (`138-2-233-183.sslip.io`) and its bare IP over HTTP. Health checks, `/internal/*`, webhooks, sign-in returns and the load test (with its header) are not redirected, and a request forwarded by Render (it carries the edge secret) is never redirected, which would loop.
- **DNS**: app.brightolio.com must be an A record to the server's IP (138.2.233.183), DNS only (or proxied with SSL Full (strict)). Issue #55 has the exact record; the workflow dns-cutover.yml closes it once /healthz answers from the server (`host: oracle`).
- **The one-address redirect in the app** (server.js) is on only while the main address really reaches this server (its own check, every five minutes). Admin → Hosting shows a red warning when it does not.
- **To set up a server** (`deploy/vm/setup.sh`): the main domain defaults to app.brightolio.com (`APP_DOMAIN`), and `PUBLIC_URL`, `PUBLIC_ORIGINS` (the app domain and the GitHub Pages origin) are written from it.
- **To change the Caddy site later**: set `APP_DOMAIN` (Admin → Keys or the ops step set-env), then run the ops step `caddy-site` (Actions → Oracle database move → step caddy-site). The file is checked by Caddy before it is loaded; the old file comes back if Caddy refuses it.
- **Diagnose**: the ops step `address-diagnose` (read only) prints the settings that name an address, the DNS, the certificate each name gets, and what the main address answers.
- **Outside settings to update by hand** (the app cannot change them): Google sign-in (the authorized JavaScript origin https://app.brightolio.com and the redirect URI https://app.brightolio.com/auth/google/callback), Stripe webhook endpoints (https://app.brightolio.com/webhooks/stripe), the OpenAI webhook (https://app.brightolio.com/api/webhooks/openai), any other service registered to the server's own address, the repository variable `APP_URL` (set to https://app.brightolio.com), and the `ORACLE_ENV` secret (add `PUBLIC_URL=https://app.brightolio.com` and `PUBLIC_ORIGINS=https://app.brightolio.com,https://aryebleich.github.io` so a re-install keeps them).

## Leaving Render (2026-11-25)

- **Found**: no Render or Cloudflare API key anywhere (server .env, Admin key store, GitHub secrets); the secret RENDER_DEPLOY_HOOK_URL in GitHub; the variable APP_URL still the Render address; RENDER_GIT_COMMIT in the server .env (the deploy marker). Render held no database, disk or jobs: only the forwarder for app.brightolio.com.
- **Done in the app**: the Render key sync, the Render plans and their Admin tab, the "render" server kind, every RENDER_* fallback, RENDER_API_KEY in the key list and the setup tasks, and the Render workflow are gone. The commit comes from the image (GIT_COMMIT, set by deploy/vm/update.sh at build time). PUBLIC_URL is required in production (the app stops with the reason if it is missing). Jobs run only on the server named by HOST_ID and set as active (Oracle when nothing is set); a production server without HOST_ID never runs them. /healthz names the host.
- **Kept until the DNS change**: render.yaml and src/render-redirect.js. Render deploys every push, and while app.brightolio.com still points at it they keep the site up. The app does not load them. Delete both after issue #55 closes.
- **Owner steps** (no API key exists, so only you can): (1) the DNS record in issue #55; (2) after it closes, Render → quantpocket → Settings → Custom Domains → remove app.brightolio.com; (3) Settings → Suspend the service (Delete later, and close the account if you want); (4) GitHub → Actions secrets: delete RENDER_DEPLOY_HOOK_URL; set the variable APP_URL to https://app.brightolio.com.
