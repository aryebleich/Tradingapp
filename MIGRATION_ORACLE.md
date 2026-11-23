# MIGRATION_ORACLE.md: from Render + Turso to the Oracle Cloud VM

Started 2026-11-23, after the Turso database (organization thecompountproject) hit its monthly read
limit and refused every SQL read, which took production down. Brightolio now runs on the Oracle
Cloud Always Free VM, with its database as a SQLite file on the VM's own disk. Render is kept as a
standby that serves pages only, and the Turso database is kept as it was. Neither was deleted.

## What runs where

| | Before | Now |
|---|---|---|
| App server | Render free web service (`quantpocket.onrender.com`) | Oracle VM `138.2.233.183` (Ubuntu 24.04, ARM), Docker, Caddy HTTPS at `https://138-2-233-183.sslip.io` |
| Database | Turso (libsql://…, billed per row read) | SQLite file `/opt/brightfolio/data/quantpocket.db` (WAL), `DB_FILE=/app/data/quantpocket.db`, `PERSISTENT_DISK=1` |
| Background jobs (bots, scheduled trades, alerts, Playbooks, pairs) | Render, woken by the GitHub cron | The VM's own scheduler (never sleeps); only the active server runs jobs |
| Backups | Turso's own | Hourly `VACUUM INTO`, 48 hourly + 30 daily in `/opt/brightfolio/data/backups`, daily encrypted copy to Oracle Object Storage when `OCI_BACKUP_PAR_URL` is set |
| Keys | Render environment | `/opt/brightfolio/.env` on the VM (mode 600), written from the `ORACLE_ENV` secret by `oracle.yml`; changed with `oracle-migrate.yml` step `set-env` |
| Deploys | Render auto-deploy | The VM's `brightfolio-update` timer: every 2 minutes, builds the newest `main`, switches only when `/healthz` answers, otherwise keeps the previous version |
| Render | active | standby: `STANDBY=1` (never runs jobs), maintenance on (refuses orders) |

## The steps (GitHub Actions)

Workflows: `.github/workflows/oracle.yml` (server setup and settings) and
`.github/workflows/oracle-migrate.yml` (the move; the VM side is `deploy/vm/migrate.sh`).

| # | Workflow, step | Run | Result |
|---|---|---|---|
| 0 | oracle.yml check | [45096424308](https://github.com/aryebleich/Tradingapp/actions/runs/45096424308) | Connected (Ubuntu 24.04), ports 80/443 open, Caddy up; the app answered 503 because Turso refused reads |
| 1 | oracle.yml settings | [45098085152](https://github.com/aryebleich/Tradingapp/actions/runs/45098085152) | Settings written, new version 489263a deployed; `/healthz` 200 (query-free) while Turso still refuses reads |
| 2 | oracle-migrate maintenance-on | [45098275849](https://github.com/aryebleich/Tradingapp/actions/runs/45098275849) | VM: `MAINTENANCE=1` and the switch on. Render did not answer within 90 s (redeploying / asleep); it cannot trade while Turso refuses its reads, and render.yaml now sets STANDBY=1 |
| 3 | oracle-migrate pull | [45098845966](https://github.com/aryebleich/Tradingapp/actions/runs/45098845966) | **Refused.** Method a (sync): `Sync(PullFrame(403, "Operation was blocked: SQL read operations are forbidden"))` — Turso blocks replica syncs too while over the read limit. Method b not tried: no `TURSO_API_TOKEN` secret |

**Status: waiting for the owner.** Turso refuses both SQL reads and syncs until the monthly reset
or until overages are on. The VM stays in maintenance (safe: it cannot read Turso anyway).
To continue, one of:
1. **Recommended:** Turso dashboard → organization thecompountproject → Billing → turn on overages
   (the copy reads each row once: a few cents at $1 per billion rows read), then run
   oracle-migrate `pull` again. Overages can be turned off right after `switch-db`.
2. Add a `TURSO_API_TOKEN` secret (`turso auth api-tokens mint brightolio-migrate`; GitHub →
   Settings → Secrets and variables → Actions) and run `pull` again for method b
   (`turso db export`). It uses the same sync channel, so it will likely be refused the same way.

## How the data was copied

(filled in below with the method that worked, the time and the row count of every table)

## Going back to Render

Only if the VM cannot be fixed. The Turso database still holds the data as it was on 2026-11-23,
before the move; anything written on the VM after that is only on the VM, so bring it back first.

1. **Maintenance on the VM:** Actions → Oracle database move → `maintenance-on`.
2. **Bring the newer data back to Turso** (skip if nothing important happened since the move):
   download the newest backup (Admin → Database → Download, or `scp` from
   `/opt/brightfolio/data/backups/`), then load it into a new Turso database:
   `turso db create brightolio-back --from-file hourly-….db` and use its URL and a new token
   (`turso db tokens create brightolio-back`) as `DATABASE_URL` / `DATABASE_AUTH_TOKEN` on Render.
   Turso's read limit must allow it again (the monthly reset, or overages on).
3. **Render out of standby:** remove the `STANDBY` line from `render.yaml` and push (or Render →
   the service → Environment → delete `STANDBY`), then redeploy. Render's maintenance switch is in
   memory, so the restart clears it; if `MAINTENANCE` is set there, delete it too.
4. **Make Render active:** Admin → Hosting (opened on Render) → Render → Make active. With the
   Cloudflare edge set up, this also points the edge at Render; otherwise share the Render address.
5. **The VM to Turso or off:** Actions → Oracle database move → `rollback` (the VM's commented
   `#TURSO#` lines come back, `DB_FILE` and `PERSISTENT_DISK` go), or stop the VM's app
   (`sudo docker compose -f /opt/brightfolio/compose.yml stop app`).
6. Set the `APP_URL` repository variable back to `https://quantpocket.onrender.com`.

## Restoring a backup on the VM

- Admin → Database → a backup → Restore (password, then type RESTORE). Within 2 minutes the server
  stops the app, keeps the current file as `quantpocket.db.before-restore-<time>`, puts the backup
  in, and starts again (the kept file goes back if the app does not answer).
- By hand: `sudo bash /opt/brightfolio/src/deploy/vm/restore.sh /opt/brightfolio/data/backups/<file>.db`
- An off-site copy (`*.db.gz.enc`) is decrypted with the same key first:
  `node -e "import('./src/backup.js').then(m=>process.stdout.write(m.decryptBackup(require('fs').readFileSync(process.argv[1]))))" daily-….db.gz.enc > restored.db`
  (in the app directory, with `BACKUP_KEY` or `ENCRYPTION_KEY` set as on the server).
