#!/usr/bin/env bash
# The database on the Oracle VM, one step at a time (run as root by
# .github/workflows/oracle-migrate.yml, also from oracle-merge-scheduled.yml; by hand:
# sudo bash migrate.sh <step>). Never prints a value from .env.
#   prep             newest code, this repo's update.sh and compose.yml installed, sqlite3, deploy
#   status           health, database settings (names only), data files, backups, host actions
#   maintenance-on   MAINTENANCE=1 in .env (holds across restarts) and the switch on the running app
#   maintenance-off  MAINTENANCE removed from .env, app restarted, the switch off
#   fresh-db         a new database file with the full schema and every id counter at 10,000,000
#                    (scripts/fresh-db.mjs) becomes data/quantpocket.db
# >>> merge-only
#                    (on the move: the Turso lines in .env are commented out as #TURSO# and
#                    TURSO_MERGE_PENDING=1 is set until the old data is merged)
# <<< merge-only
# >>> merge-only
#   pull             copy the old database into data/pull.db by sync only (scripts/turso-pull.mjs),
#                    with the Turso address kept in .env; integrity_check
#   merge-turso      maintenance on → pull → a rehearsal of the merge on a copy (the site stays up) →
#                    the app stopped, an exact copy of the live file kept → the merge
#                    (scripts/turso-merge.mjs) → the app started, /internal/verify → maintenance off.
#                    Any failure: the exact copy goes back, TURSO_MERGE_PENDING stays set
#   final-copy       after the merge: the final encrypted copy of pull.db (scripts/final-copy.mjs,
#                    kept 90 days, also off-site when OCI_BACKUP_PAR_URL is set), then pull.db removed
#   clean-old-settings  the commented Turso lines removed from .env (after the old database is gone)
#   finalize         final-copy, then clean-old-settings
#   old-db-host      the old database's host name, for the workflow that deletes it (never logged there)
# <<< merge-only
#   verify           /internal/verify: database, schema, row counts, credentials, keys (JSON)
#   check-trade      a paper trade end to end (/internal/check-trade: buy and sell 1 SPY on paper)
#   report           the last pull and merge report (JSON) # merge-only
#   activate <url>   register this server in its own database and make it the active server
#   set-env          KEY=value lines on standard input replace those keys in .env, then restart
#   backup           one backup now
#   restore <file>   put a backup from data/backups back (deploy/vm/restore.sh)
set -euo pipefail
APP=${APP:-/opt/brightfolio}
ENVF=$APP/.env
DATA=$APP/data
step=${1:-status}

val() { grep -m1 "^$1=" "$ENVF" 2>/dev/null | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
unsetv() { sed -i "/^$1=/d" "$ENVF"; }
setv() { unsetv "$1"; printf '%s=%s\n' "$1" "$2" >> "$ENVF"; }
call() { # call METHOD PATH [JSON] : the app on this server, with its own CRON_SECRET (never printed)
  local cs; cs=$(val CRON_SECRET)
  [ -n "$cs" ] || { echo "CRON_SECRET is not in $ENVF" >&2; return 1; }
  curl -sS --max-time 60 -X "$1" -H "authorization: Bearer $cs" -H 'content-type: application/json' ${3:+--data "$3"} "http://127.0.0.1:3000$2"
}
healthy() { for _ in $(seq 1 45); do curl -fs http://127.0.0.1:3000/healthz >/dev/null && return 0; sleep 2; done; echo "The app does not answer /healthz" >&2; return 1; }
restart() { [ -n "${NO_DOCKER:-}" ] && return 0; (cd "$APP" && docker compose up -d --force-recreate app >/dev/null 2>&1); healthy; }
timer() { systemctl "$1" brightfolio-update.timer 2>/dev/null || true; }
# >>> merge-only
old_val() { grep -m1 "^#TURSO# $1=" "$ENVF" 2>/dev/null | sed -e "s/^#TURSO# $1=//" -e 's/^"//' -e 's/"$//' || true; }
in_app() { # in_app <command...> : a one-off container of the app image, with the data volume
  (cd "$APP" && docker compose run --rm -T --no-deps "$@" 2>/dev/null | tail -1)
}
pull_old() { # copy the old database into data/pull.db (exit 3 = refused)
  local turl ttok; turl=$(old_val DATABASE_URL); ttok=$(old_val DATABASE_AUTH_TOKEN)
  [ -n "$turl" ] || { echo '{"ok":false,"error":"no old database address kept in .env"}'; return 1; }
  mkdir -p "$DATA" && chown 1000:1000 "$DATA"
  DATABASE_URL="$turl" DATABASE_AUTH_TOKEN="$ttok" in_app -e DATABASE_URL -e DATABASE_AUTH_TOKEN app node scripts/turso-pull.mjs /app/data/pull.db
}
# <<< merge-only
maint_on() { setv MAINTENANCE 1; call POST /internal/maintenance "{\"on\":true,\"reason\":\"${1:-maintenance}\"}" >/dev/null || true; }
maint_off() { # a restart only when the running app has MAINTENANCE=1 in its environment
  unsetv MAINTENANCE
  if [ -z "${NO_DOCKER:-}" ] && (cd "$APP" && docker compose exec -T app sh -c '[ "$MAINTENANCE" = 1 ]') >/dev/null 2>&1; then restart || true; fi
  call POST /internal/maintenance '{"on":false}' >/dev/null || true
}

case "$step" in
  prep)
    sudo -u brightfolio git -C "$APP/src" fetch -q --depth 1 origin main
    sudo -u brightfolio git -C "$APP/src" reset -q --hard origin/main
    cp "$APP/src/deploy/vm/update.sh" /usr/local/bin/brightfolio-update.new && chmod 755 /usr/local/bin/brightfolio-update.new && mv -f /usr/local/bin/brightfolio-update.new /usr/local/bin/brightfolio-update
    cp "$APP/src/deploy/vm/compose.yml" "$APP/compose.yml"
    command -v sqlite3 >/dev/null || apt-get install -y -qq sqlite3 >/dev/null
    want=$(sudo -u brightfolio git -C "$APP/src" rev-parse HEAD)
    if [ "$(cat "$APP/.deployed" 2>/dev/null)" != "$want" ]; then FORCE=1 /usr/local/bin/brightfolio-update || true; fi
    echo "Code: ${want:0:7}, deployed: $(cut -c1-7 "$APP/.deployed" 2>/dev/null)"
    ;;
  maintenance-on)
    maint_on "${2:-maintenance}"; echo "Maintenance on."
    ;;
# >>> merge-only
  pull)
    t0=$(date +%s); set +e; out=$(pull_old); code=$?; set -e
    printf '{"pull":%s}\n' "${out:-null}" > "$DATA/pull-report.json"; chown 1000:1000 "$DATA/pull-report.json"
    echo "$out" | sed -E 's/"counts":\{[^}]*\}/"counts":{…}/'; echo "copy time: $(( $(date +%s) - t0 )) s"
    exit "$code"
    ;;
  check-pull)
    [ -f "$DATA/pull.db" ] || { echo "No $DATA/pull.db" >&2; exit 1; }
    ok=$(sqlite3 -readonly "$DATA/pull.db" 'PRAGMA integrity_check;' | head -1)
    echo "integrity_check: $ok"; [ "$ok" = ok ]
    ;;
# <<< merge-only
  fresh-db)
    [ -f "$DATA/quantpocket.db" ] && [ "$(val PERSISTENT_DISK)" = 1 ] && { echo "This server already runs on its own database file; nothing to do." ; exit 0; }
    timer stop
    (cd "$APP" && docker compose stop app >/dev/null 2>&1) || true
    mkdir -p "$DATA" && chown 1000:1000 "$DATA"
    rm -f "$DATA/fresh.db" "$DATA/fresh.db-wal" "$DATA/fresh.db-shm"
    out=$(cd "$APP" && docker compose run --rm -T --no-deps -e DATABASE_URL= -e DATABASE_AUTH_TOKEN= app node scripts/fresh-db.mjs /app/data/fresh.db 2>/dev/null | tail -1)
    echo "$out"
    case "$out" in *'"ok":true'*) ;; *) echo "The new database could not be made; nothing was changed." >&2; timer start; (cd "$APP" && docker compose start app >/dev/null 2>&1) || true; exit 1 ;; esac
    if [ -f "$DATA/quantpocket.db" ]; then
      old="$DATA/quantpocket.db.before-switch-$(date -u +%Y%m%dT%H%M%S)"
      sqlite3 "$DATA/quantpocket.db" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null 2>&1 || true
      echo "The earlier local file had: $(sqlite3 -readonly "$DATA/quantpocket.db" "SELECT COUNT(*) FROM users;" 2>/dev/null || echo '?') users (kept as $(basename "$old"))"
      mv -f "$DATA/quantpocket.db" "$old"; rm -f "$DATA/quantpocket.db-wal" "$DATA/quantpocket.db-shm"
    fi
    mv -f "$DATA/fresh.db" "$DATA/quantpocket.db"; rm -f "$DATA/fresh.db-wal" "$DATA/fresh.db-shm"
    chown -R 1000:1000 "$DATA"
    for k in DATABASE_URL DATABASE_AUTH_TOKEN; do sed -i "s/^$k=/#TURSO# $k=/" "$ENVF"; done # merge-only
    setv DB_FILE /app/data/quantpocket.db
    setv PERSISTENT_DISK 1
    setv TURSO_MERGE_PENDING 1 # merge-only
    restart
    timer start
    echo "Started on a new database file."
    ;;
# >>> merge-only
  merge-turso)
    [ "$(val TURSO_MERGE_PENDING)" = 1 ] || { echo "Nothing to merge (TURSO_MERGE_PENDING is not set)."; exit 0; }
    [ "$(val PERSISTENT_DISK)" = 1 ] || { echo "Run fresh-db first." >&2; exit 1; }
    t0=$(date +%s); started=$(date -u +%FT%TZ)
    maint_on "bringing back the data from before November 22"
    set +e; pulled=$(pull_old); code=$?; set -e
    echo "$pulled" | sed -E 's/"counts":\{[^}]*\}/"counts":{…}/'
    if [ "$code" != 0 ]; then printf '{"pull":%s,"merge":null,"at":"%s"}\n' "${pulled:-null}" "$started" > "$DATA/pull-report.json"; maint_off; echo "The old database cannot be copied yet (exit $code); nothing changed, the site runs as before." >&2; exit "$code"; fi
    # A rehearsal on a copy while the site stays up: a failure here touches nothing.
    rm -f "$DATA/rehearsal.db"*
    sqlite3 "$DATA/quantpocket.db" "VACUUM INTO '$DATA/rehearsal.db'"; chown 1000:1000 "$DATA/rehearsal.db"
    rehearsal=$(in_app app node scripts/turso-merge.mjs /app/data/rehearsal.db /app/data/pull.db); rm -f "$DATA/rehearsal.db"*
    case "$rehearsal" in *'"ok":true'*) ;; *) printf '{"pull":%s,"rehearsal":%s,"at":"%s"}\n' "$pulled" "${rehearsal:-null}" "$started" > "$DATA/pull-report.json"; maint_off; echo "The rehearsal of the merge failed: $rehearsal" >&2; echo "The live database was not touched." >&2; exit 1 ;; esac
    # The real merge: the app stopped for its few seconds; an exact copy kept.
    timer stop
    (cd "$APP" && docker compose stop app >/dev/null 2>&1) || true
    sqlite3 "$DATA/quantpocket.db" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null
    keep="$DATA/quantpocket.db.before-merge-$(date -u +%Y%m%dT%H%M%S)"
    cp -p "$DATA/quantpocket.db" "$keep"; sum=$(sha256sum "$keep" | cut -d' ' -f1)
    put_back() {
      rm -f "$DATA/quantpocket.db-wal" "$DATA/quantpocket.db-shm"; cp -p "$keep" "$DATA/quantpocket.db"
      [ "$(sha256sum "$DATA/quantpocket.db" | cut -d' ' -f1)" = "$sum" ] && echo "The live database is back exactly as it was." >&2
      setv TURSO_MERGE_PENDING 1; maint_off; timer start
    }
    merged=$(in_app app node scripts/turso-merge.mjs /app/data/quantpocket.db /app/data/pull.db)
    case "$merged" in *'"ok":true'*) ;; *) echo "The merge failed: $merged" >&2; printf '{"pull":%s,"merge":%s,"at":"%s"}\n' "$pulled" "${merged:-null}" "$started" > "$DATA/pull-report.json"; put_back; exit 1 ;; esac
    chown -R 1000:1000 "$DATA"
    unsetv TURSO_MERGE_PENDING
    if ! restart || ! v=$(call GET /internal/verify) || ! printf '%s' "$v" | grep -q '"ok":true'; then
      echo "Verify failed after the merge: ${v:-no answer}" >&2; (cd "$APP" && docker compose stop app >/dev/null 2>&1) || true
      printf '{"pull":%s,"merge":%s,"verify":%s,"at":"%s"}\n' "$pulled" "$merged" "${v:-null}" "$started" > "$DATA/pull-report.json"; put_back; exit 1
    fi
    printf '{"pull":%s,"merge":%s,"verify":%s,"at":"%s","seconds":%s,"keptBeforeMerge":"%s"}\n' "$pulled" "$merged" "$v" "$started" "$(( $(date +%s) - t0 ))" "$(basename "$keep")" > "$DATA/pull-report.json"
    chown 1000:1000 "$DATA/pull-report.json"
    timer start
    maint_off
    echo "Merged. The file before the merge is kept as $(basename "$keep")."
    echo "$merged"
    ;;
  final-copy)
    [ "$(val TURSO_MERGE_PENDING)" = 1 ] && { echo "The merge has not run yet." >&2; exit 1; }
    if [ -f "$DATA/pull.db" ]; then
      out=$(in_app app node scripts/final-copy.mjs /app/data/pull.db)
      echo "$out"
      case "$out" in *'"ok":true'*) ;; *) echo "The final copy failed; pull.db is kept." >&2; exit 1 ;; esac
      printf '%s\n' "$out" > "$DATA/final/final-copy.json"; chown -R 1000:1000 "$DATA/final"
      rm -f "$DATA/pull.db" "$DATA/pull.db-wal" "$DATA/pull.db-shm" "$DATA/pull.db-info" "$DATA/pull.db-client_wal_index"
    else echo "No pull.db (the final copy was made already)."; cat "$DATA/final/final-copy.json" 2>/dev/null || true; fi
    ;;
  clean-old-settings)
    [ "$(val TURSO_MERGE_PENDING)" = 1 ] && { echo "The merge has not run yet." >&2; exit 1; }
    if grep -q '^#TURSO# ' "$ENVF"; then sed -i '/^#TURSO# /d' "$ENVF"; echo "The old database settings were removed from .env (no restart needed: the app does not use them)."; else echo "No old database settings in .env."; fi
    ;;
  finalize)
    bash "$0" final-copy && bash "$0" clean-old-settings
    ;;
  old-db-host)
    u=$(old_val DATABASE_URL); u=${u#libsql://}; u=${u#https://}; printf '%s\n' "${u%%/*}"
    ;;
# <<< merge-only
  check-trade) call POST /internal/check-trade; echo ;;
  verify) call GET /internal/verify; echo ;;
  report) cat "$DATA/pull-report.json" ;; # merge-only
  activate)
    url=${2:?the https address of this server}
    call POST /internal/hosting "{\"servers\":[{\"id\":\"oracle\",\"kind\":\"oracle-vm\",\"name\":\"Oracle Cloud\",\"url\":\"$url\"}],\"active\":\"oracle\"}"; echo
    call POST /internal/hosting/activate '{"id":"oracle"}'; echo
    ;;
  maintenance-off)
    maint_off; echo "Maintenance off."
    ;;
  set-env)
    n=0
    while IFS= read -r line || [ -n "$line" ]; do
      line=${line%$'\r'}; [ -z "$line" ] && continue
      k=${line%%=*}; v=${line#*=}
      [[ "$k" =~ ^[A-Z][A-Z0-9_]{1,63}$ ]] || { echo "skipped a line: '$k' is not a setting name" >&2; continue; }
      case "$k" in NODE_ENV|PORT|HOSTNAME|PATH|HOME|NODE_OPTIONS|LD_PRELOAD) echo "skipped $k (set by the host)" >&2; continue ;; esac
      if [ -z "$v" ]; then unsetv "$k"; echo "$k: removed"; else setv "$k" "$v"; echo "$k: set"; fi
      n=$((n + 1))
    done
    [ "$n" -gt 0 ] && restart && echo "Restarted with $n changed setting(s)."
    ;;
  backup) call POST /internal/backup; echo ;;
  restore)
    f=${2:?the backup file name in data/backups}; f=$(basename "$f")
    [ -f "$DATA/backups/$f" ] || { echo "No backup named $f" >&2; exit 1; }
    timer stop; bash "$APP/src/deploy/vm/restore.sh" "$DATA/backups/$f"; timer start
    ;;
  status)
    echo "--- health"; curl -sS --max-time 10 http://127.0.0.1:3000/healthz || true; echo
    grep -q '^TURSO_MERGE_PENDING=1' "$ENVF" && echo "The data from before November 22 is still to be merged (oracle-merge-scheduled.yml)." # merge-only
    echo "--- database settings"; for k in DATABASE_URL DB_FILE PERSISTENT_DISK MAINTENANCE STANDBY; do if grep -q "^$k=" "$ENVF"; then echo "$k: set"; else echo "$k: -"; fi; done
    echo "--- data"; find "$DATA" -maxdepth 1 -type f -printf '%s %f\n' | sort -k2
    echo "--- backups"; find "$DATA/backups" -maxdepth 1 -name '*.db' -printf '%T@ %f\n' 2>/dev/null | sort -rn | head -5 | cut -d' ' -f2; head -30 "$DATA/backups/status.json" 2>/dev/null || true
    echo "--- host actions"; tail -5 "$DATA/host-actions.log" 2>/dev/null || true
    ;;
  *) echo "unknown step: $step" >&2; exit 2 ;;
esac
