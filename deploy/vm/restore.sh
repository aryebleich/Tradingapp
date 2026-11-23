#!/usr/bin/env bash
# Puts a backup back as the live database on the VM:  sudo restore.sh <backup.db>
#   1. checks the backup on its own (PRAGMA integrity_check must say ok) before touching anything
#   2. stops the app, keeps the current database as quantpocket.db.before-restore-<time>
#   3. copies the backup in, removes the old -wal and -shm files, gives it to the app user (1000)
#   4. starts the app and waits for /healthz; if it does not answer, the kept file goes back
# A backup file ending in .gz.enc (the off-site copy) must be decrypted first (see MIGRATION_ORACLE.md).
# APP and DB can be set for a test run (the defaults are the VM's paths); NO_DOCKER=1 skips the app.
set -euo pipefail
APP=${APP:-/opt/brightfolio}
DB=${DB:-$APP/data/quantpocket.db}
SRC=${1:-}
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then echo "usage: restore.sh <backup.db>" >&2; exit 2; fi
command -v sqlite3 >/dev/null || { echo "sqlite3 is needed: sudo apt-get install -y sqlite3" >&2; exit 2; }
ok=$(sqlite3 -readonly "$SRC" 'PRAGMA integrity_check;' 2>&1 | head -1)
[ "$ok" = "ok" ] || { echo "The backup failed its integrity check ($ok); nothing was changed." >&2; exit 1; }
tables=$(sqlite3 -readonly "$SRC" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';")
echo "Backup OK: $tables tables."
app() { [ -n "${NO_DOCKER:-}" ] && return 0; (cd "$APP" && docker compose "$@"); }
health() { [ -n "${NO_DOCKER:-}" ] && return 0; for _ in $(seq 1 40); do curl -fs http://127.0.0.1:3000/healthz >/dev/null && return 0; sleep 2; done; return 1; }
app stop app
KEPT=""
if [ -f "$DB" ]; then KEPT="$DB.before-restore-$(date -u +%Y%m%dT%H%M%S)"; cp -p "$DB" "$KEPT"; [ -f "$DB-wal" ] && cp -p "$DB-wal" "$KEPT-wal"; echo "Kept the current database as $(basename "$KEPT")"; fi
rm -f "$DB-wal" "$DB-shm"
cp "$SRC" "$DB.restoring" && mv -f "$DB.restoring" "$DB"
[ -n "${NO_DOCKER:-}" ] || chown 1000:1000 "$DB"
app start app
if health; then echo "Restored $(basename "$SRC"); the app answers."; exit 0; fi
echo "The app did not answer after the restore; putting the kept database back." >&2
if [ -n "$KEPT" ]; then app stop app; rm -f "$DB-wal" "$DB-shm"; cp -p "$KEPT" "$DB"; [ -f "$KEPT-wal" ] && cp -p "$KEPT-wal" "$DB-wal"; app start app; fi
exit 1
