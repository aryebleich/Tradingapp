#!/usr/bin/env bash
# The database move on the Oracle VM, one step at a time (run as root by
# .github/workflows/oracle-migrate.yml; can also be run by hand: sudo bash migrate.sh <step>).
#   prep             newest code, this repo's update.sh and compose.yml installed, sqlite3, deploy
#   maintenance-on   MAINTENANCE=1 in .env (holds across restarts) and the switch on the running app
#   pull             copy Turso into data/pull.db by sync (scripts/turso-pull.mjs in the app image)
#   check-pull       integrity_check of data/pull.db (after a copy made another way)
#   switch-db        data/pull.db becomes data/quantpocket.db; DATABASE_URL and DATABASE_AUTH_TOKEN
#                    are commented out in .env (kept, marked #TURSO#, for going back), DB_FILE and
#                    PERSISTENT_DISK=1 are added; the app restarts
#   verify           /internal/verify: database, schema, row counts, credentials, keys (JSON)
#   report           the pull report (JSON: method, time, row counts)
#   activate <url> [render-url]  register this server (and Render) in its database and make it active
#   maintenance-off  MAINTENANCE removed from .env, app restarted, the switch off
#   rollback         back to Turso: the #TURSO# lines return, DB_FILE and PERSISTENT_DISK go, restart
#   set-env          KEY=value lines on standard input replace those keys in .env, then restart
#   backup | status
# Never prints a value from .env.
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
    setv MAINTENANCE 1
    call POST /internal/maintenance '{"on":true,"reason":"moving the database to this server"}' && echo || echo "(the app is not answering now; MAINTENANCE=1 applies when it starts)"
    ;;
  pull)
    mkdir -p "$DATA" && chown 1000:1000 "$DATA"
    t0=$(date +%s); set +e
    out=$(cd "$APP" && docker compose run --rm -T --no-deps app node scripts/turso-pull.mjs /app/data/pull.db 2>/dev/null | tail -1); code=$?
    set -e
    printf '%s\n' "$out" > "$DATA/pull-report.json"; chown 1000:1000 "$DATA/pull-report.json"
    echo "$out"; echo "copy time: $(( $(date +%s) - t0 )) s"
    exit "$code"
    ;;
  check-pull)
    [ -f "$DATA/pull.db" ] || { echo "No $DATA/pull.db" >&2; exit 1; }
    ok=$(sqlite3 -readonly "$DATA/pull.db" 'PRAGMA integrity_check;' | head -1)
    echo "integrity_check: $ok"; [ "$ok" = ok ]
    ;;
  switch-db)
    [ -f "$DATA/pull.db" ] || { echo "No $DATA/pull.db: run the pull first" >&2; exit 1; }
    ok=$(sqlite3 -readonly "$DATA/pull.db" 'PRAGMA integrity_check;' | head -1)
    [ "$ok" = ok ] || { echo "pull.db fails its integrity check ($ok)" >&2; exit 1; }
    timer stop
    (cd "$APP" && docker compose stop app >/dev/null 2>&1) || true
    # One consolidated file (the replica's own log folded in), made by SQLite itself.
    rm -f "$DATA/quantpocket.db.new"
    sqlite3 "$DATA/pull.db" "VACUUM INTO '$DATA/quantpocket.db.new'"
    [ "$(sqlite3 -readonly "$DATA/quantpocket.db.new" 'PRAGMA integrity_check;' | head -1)" = ok ]
    if [ -f "$DATA/quantpocket.db" ]; then mv -f "$DATA/quantpocket.db" "$DATA/quantpocket.db.before-switch-$(date -u +%Y%m%dT%H%M%S)"; fi
    rm -f "$DATA/quantpocket.db-wal" "$DATA/quantpocket.db-shm"
    mv -f "$DATA/quantpocket.db.new" "$DATA/quantpocket.db"
    chown -R 1000:1000 "$DATA"
    for k in DATABASE_URL DATABASE_AUTH_TOKEN; do sed -i "s/^$k=/#TURSO# $k=/" "$ENVF"; done
    setv DB_FILE /app/data/quantpocket.db
    setv PERSISTENT_DISK 1
    restart
    timer start
    echo "Switched: the app now uses $DATA/quantpocket.db ($(du -h "$DATA/quantpocket.db" | cut -f1)); the Turso settings are kept, commented out."
    ;;
  verify) call GET /internal/verify; echo ;;
  report) cat "$DATA/pull-report.json" ;;
  activate)
    url=${2:?the https address of this server}; render=${3:-}
    servers="{\"id\":\"oracle\",\"kind\":\"oracle-vm\",\"name\":\"Oracle Cloud\",\"url\":\"$url\"}"
    [ -n "$render" ] && servers="$servers,{\"id\":\"render\",\"kind\":\"render\",\"name\":\"Render (standby)\",\"url\":\"$render\"}"
    call POST /internal/hosting "{\"servers\":[$servers],\"active\":\"oracle\"}"; echo
    call POST /internal/hosting/activate '{"id":"oracle"}'; echo
    ;;
  maintenance-off)
    unsetv MAINTENANCE
    restart
    call POST /internal/maintenance '{"on":false}'; echo
    ;;
  rollback)
    timer stop
    sed -i 's/^#TURSO# //' "$ENVF"
    unsetv DB_FILE; unsetv PERSISTENT_DISK
    restart || true
    timer start
    echo "Rolled back: the app uses Turso again (DATABASE_URL). The local file stays in $DATA for later."
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
  status)
    echo "--- health"; curl -sS --max-time 10 http://127.0.0.1:3000/healthz || true; echo
    echo "--- database settings"; for k in DATABASE_URL DB_FILE PERSISTENT_DISK MAINTENANCE STANDBY; do if grep -q "^$k=" "$ENVF"; then echo "$k: set"; elif grep -q "^#TURSO# $k=" "$ENVF"; then echo "$k: kept, commented out"; else echo "$k: -"; fi; done
    echo "--- data"; find "$DATA" -maxdepth 1 -type f -printf '%s %f\n' | sort -k2
    echo "--- backups"; find "$DATA/backups" -maxdepth 1 -name '*.db' -printf '%T@ %f\n' 2>/dev/null | sort -rn | head -5 | cut -d' ' -f2; head -30 "$DATA/backups/status.json" 2>/dev/null || true
    echo "--- host actions"; tail -5 "$DATA/host-actions.log" 2>/dev/null || true
    ;;
  *) echo "unknown step: $step" >&2; exit 2 ;;
esac
