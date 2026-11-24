#!/usr/bin/env bash
# The database on the Oracle VM, one step at a time (run as root by
# .github/workflows/oracle-migrate.yml, also from oracle-merge-scheduled.yml; by hand:
# sudo bash migrate.sh <step>). Never prints a value from .env.
#   repair           the app back up after an interrupted deploy (leftover containers removed)
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
#   point-domain <domain> <ip>  the domain's Cloudflare record → this server (CLOUDFLARE_API_TOKEN)
#   diagnose-load    load, heap, event-loop delay, in flight, refused requests, container memory
#   deploy-now       a deploy in the open, with the deploy log and the app's start-up log
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
  repair)
    # The app back up after an interrupted deploy: leftover renamed containers removed, the app
    # started from the current image, then a normal deploy of the newest commit.
    for c in $(docker ps -a --format '{{.Names}}' | grep -E '^[0-9a-f]{12}_brightfolio-app-1$' || true); do docker rm -f "$c" >/dev/null && echo "removed leftover container $c"; done
    (cd "$APP" && docker compose up -d app >/dev/null 2>&1) || true
    healthy && echo "The app answers."
    ;;
  prep)
    sudo -u brightfolio git -C "$APP/src" fetch -q --depth 1 origin main
    sudo -u brightfolio git -C "$APP/src" reset -q --hard origin/main
    cp "$APP/src/deploy/vm/update.sh" /usr/local/bin/brightfolio-update.new && chmod 755 /usr/local/bin/brightfolio-update.new && mv -f /usr/local/bin/brightfolio-update.new /usr/local/bin/brightfolio-update
    cp "$APP/src/deploy/vm/compose.yml" "$APP/compose.yml"
    command -v sqlite3 >/dev/null || apt-get install -y -qq sqlite3 >/dev/null
    want=$(sudo -u brightfolio git -C "$APP/src" rev-parse HEAD)
    for c in $(docker ps -a --format '{{.Names}}' | grep -E '^[0-9a-f]{12}_brightfolio-app-1$' || true); do docker rm -f "$c" >/dev/null 2>&1 || true; done
    if [ "$(cat "$APP/.deployed" 2>/dev/null)" != "$want" ]; then FORCE=1 /usr/local/bin/brightfolio-update || true; fi
    curl -fs http://127.0.0.1:3000/healthz >/dev/null || { (cd "$APP" && docker compose up -d app >/dev/null 2>&1) || true; healthy || true; }
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
  deploy-now)
    # A deploy of the newest commit in the open: its whole output, the deploy log, and the app's own
    # start-up log (lines that could hold a value are left out).
    echo "--- deploy"; FORCE=1 /usr/local/bin/brightfolio-update 2>&1 | tail -40 || true
    echo "--- deploy log"; tail -25 "$DATA/host-actions.log" 2>/dev/null || true; cat "$DATA/.host.json" 2>/dev/null; echo
    echo "--- images: $(docker images brightfolio --format '{{.Tag}}={{.ID}} {{.CreatedSince}}' | paste -sd' ' -); running: $(docker inspect -f '{{.Image}}' brightfolio-app-1 2>/dev/null | cut -c8-19)"
    echo "--- app start-up log"; (cd "$APP" && docker compose logs --tail 60 app 2>&1) | grep -viE 'key|secret|token|password|authorization' | tail -40
    ;;
  diagnose-load)
    # Six samples, ten seconds apart: the load and its parts, heap and its real limit, the event-loop
    # delay, in flight, refused requests; then the container's memory and CPU, and /metrics.
    echo "--- app container started: $(docker inspect -f '{{.State.StartedAt}}' brightfolio-app-1 2>/dev/null) (image $(cut -c1-7 "$APP/.deployed" 2>/dev/null))"
    mt=$(val METRICS_TOKEN)
    echo "--- code: checkout $(sudo -u brightfolio git -C "$APP/src" log -1 --format='%h %cd' --date=iso 2>/dev/null); checkout has it: $(grep -c "internal/load" "$APP/src/server.js")"
    echo "    images: $(docker images brightfolio --format '{{.Tag}}={{.ID}} {{.CreatedSince}}' | paste -sd' ' -)"
    echo "    container runs image: $(docker inspect -f '{{.Image}}' brightfolio-app-1 2>/dev/null | cut -c8-19); latest is $(docker image inspect -f '{{.Id}}' brightfolio:latest 2>/dev/null | cut -c8-19)"
    echo "    shed code live: $( (cd "$APP" && docker compose exec -T app grep -c "makeHysteresis" /app/src/reliability.js) 2>&1 | head -1); trimmed SEC facts live: $( (cd "$APP" && docker compose exec -T app grep -c "trimFacts" /app/src/institutions.js) 2>&1 | head -1)"
    # Which front-end files the container really serves (navfoot: gone since 5906a60; the CSS bundle since 93999e3).
    echo "    container app.js has the old menu footer: $( (cd "$APP" && docker compose exec -T app grep -c 'class="navfoot"' /app/public/app.js) 2>&1 | head -1); server.js bundles CSS: $( (cd "$APP" && docker compose exec -T app grep -c 'render-blocking request' /app/server.js) 2>&1 | head -1); checkout: $(grep -c 'render-blocking request' "$APP/src/server.js")"
    echo "    all containers: $(docker ps -a --format '{{.Names}} {{.Image}} {{.Status}} {{.Ports}}' | paste -sd';' -)"
    echo "    port 3000: $(ss -ltnp 2>/dev/null | grep ':3000 ' | sed -E 's/ +/ /g' | head -3 | paste -sd';' -)"
    echo "    localhost /app links: $(curl -sS --max-time 10 http://127.0.0.1:3000/app | grep -oE '(href|src)="/(bundle/[^"]+|[a-z]+\.css[^"]*)"' | paste -sd' ' -)"
    echo "--- the running code has /internal/load: $( (cd "$APP" && docker compose exec -T app grep -c "internal/load" /app/server.js) 2>&1 | head -1)"
    cs=$(val CRON_SECRET); echo "--- /internal/load answer:"; curl -sS -i --max-time 15 -H "authorization: Bearer $cs" http://127.0.0.1:3000/internal/load 2>&1 | head -12 | cut -c1-200 | grep -viE 'set-cookie|authorization'
    for i in 1 2 3; do echo "--- /metrics now ($i)"; curl -sS --max-time 10 ${mt:+-H "authorization: Bearer $mt"} http://127.0.0.1:3000/metrics | grep -E '^qp_(load|inflight|event_loop|heap|requests|shed|jobs)' | paste -sd' ' -; sleep 3; done
    echo "--- the machine: $(nproc) CPU cores, $(free -m | awk '/^Mem:/{print $2" MB memory, "$7" MB available"}'), swap $(free -m | awk '/^Swap:/{print $2" MB"}')"
    echo "    container limits: $(docker inspect -f 'memory {{.HostConfig.Memory}} bytes, cpus {{.HostConfig.NanoCpus}}' brightfolio-app-1 2>/dev/null)"
    echo "--- response times per route since the app started (top 30 by count; ms)"
    call GET /internal/load | jq -r '.routes[]? | "\(.count)\t p50 \(.p50)\t p95 \(.p95)\t max \(.max)\t \(.route)"' 2>/dev/null | head -30 || true
    for i in 1 2 3 4 5 6; do echo "--- sample $i"; r=$(call GET /internal/load || true); echo "$r" | jq -c '{at, load: .stats.load, parts, lagNow2s, heap, rssMb, inflight: .stats.inflight, shed: .stats.shed, requests: .stats.requests, uptimeSec: .stats.uptimeSec, nodeOptions}' 2>/dev/null || echo "  (not JSON: $(printf '%s' "$r" | head -c 160 | tr -d '\n'))"; [ "$i" -lt 6 ] && sleep 8; done
    echo "--- last refused requests"; call GET /internal/load | jq -c '.shed[]?' | tail -20 || true
    echo "--- database file (names and sizes only, never values)"
    db="$DATA/quantpocket.db"; stat -c '%s %n' "$db" "$db-wal" 2>/dev/null
    sqlite3 -readonly "$db" "SELECT 'pages', (SELECT page_count FROM pragma_page_count), 'free', (SELECT freelist_count FROM pragma_freelist_count), 'page size', (SELECT page_size FROM pragma_page_size);" 2>&1 | head -2
    sqlite3 -readonly "$db" "SELECT name, SUM(pgsize)/1048576 AS mb FROM dbstat GROUP BY name ORDER BY mb DESC LIMIT 8;" 2>&1 | head -10
    for t in cache site_settings user_settings; do echo "  largest in $t:"; sqlite3 -readonly "$db" "SELECT k, length(v) FROM $t ORDER BY length(v) DESC LIMIT 5;" 2>&1 | sed 's/^/    /' | head -6; done
    echo "  rows per table (largest):"; for t in $(sqlite3 -readonly "$db" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"); do printf '%s %s\n' "$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM \"$t\"")" "$t"; done | sort -rn | head -8 | sed 's/^/    /'
    echo "--- the main address (pages must be 200 HTML, API calls never a 503)"
    for p in / /app /app.html /app.js /styles.css /manifest.webmanifest /sw.js /api/news /api/insights /api/market/overview /api/auth/me; do
      printf '  %-24s %s\n' "$p" "$(curl -sS -o /dev/null -w '%{http_code} %{content_type} %{time_total}s' --max-time 30 "https://app.brightolio.com$p")"
    done
    echo "--- container"; docker stats --no-stream --format '{{.Name}} cpu {{.CPUPerc}} mem {{.MemUsage}} ({{.MemPerc}})' 2>/dev/null || true
    echo "--- /metrics"; curl -sS --max-time 10 ${mt:+-H "authorization: Bearer $mt"} http://127.0.0.1:3000/metrics | grep -v '^#' | head -20
    echo "--- recent app log (warnings and errors, no values)"; (cd "$APP" && docker compose logs --since 30m app 2>/dev/null | grep -iE 'slow|error|warn|heap|memory|lag' | grep -viE 'key|secret|token|password' | tail -15) || true
    ;;
  point-domain)
    # point-domain <domain> <server ip>: the domain's Cloudflare record → this server. First DNS only
    # (so Caddy can get its certificate directly), then, once https://<domain> answers from here with
    # a valid certificate, through Cloudflare again (proxied). Uses CLOUDFLARE_API_TOKEN from .env.
    d=${2:?domain}; ip=${3:?server ip}; tok=$(val CLOUDFLARE_API_TOKEN)
    [ -n "$tok" ] || { echo "No CLOUDFLARE_API_TOKEN in this server's settings." >&2; exit 4; }
    cf() { curl -sS --max-time 30 -H "authorization: Bearer $tok" -H 'content-type: application/json' "$@"; }
    apex=$(echo "$d" | awk -F. '{print $(NF-1)"."$NF}')
    zone=$(val CLOUDFLARE_ZONE_ID); [ -n "$zone" ] || zone=$(cf "https://api.cloudflare.com/client/v4/zones?name=$apex" | jq -r '.result[0].id // empty')
    [ -n "$zone" ] || { echo "Cloudflare: no zone for $apex that this token can see (it needs Zone → DNS → Edit)." >&2; exit 4; }
    recs=$(cf "https://api.cloudflare.com/client/v4/zones/$zone/dns_records?name=$d")
    echo "Before: $(echo "$recs" | jq -c '[.result[] | {type, content, proxied}]')"
    set_rec() { # proxied true|false
      local body id; body=$(jq -n --arg n "$d" --arg ip "$ip" --argjson p "$1" '{type:"A", name:$n, content:$ip, proxied:$p, ttl:1, comment:"Brightolio: the Oracle server"}')
      for id in $(echo "$recs" | jq -r '.result[] | select(.type=="CNAME" or .type=="AAAA" or (.type=="A" and .content!=$ip)) | .id' --arg ip "$ip"); do cf -X DELETE "https://api.cloudflare.com/client/v4/zones/$zone/dns_records/$id" >/dev/null; done
      id=$(cf "https://api.cloudflare.com/client/v4/zones/$zone/dns_records?name=$d&type=A" | jq -r '.result[0].id // empty')
      if [ -n "$id" ]; then cf -X PUT --data "$body" "https://api.cloudflare.com/client/v4/zones/$zone/dns_records/$id" | jq -c '{success, errors}'
      else cf -X POST --data "$body" "https://api.cloudflare.com/client/v4/zones/$zone/dns_records" | jq -c '{success, errors}'; fi
      recs=$(cf "https://api.cloudflare.com/client/v4/zones/$zone/dns_records?name=$d")
    }
    set_rec false
    grep -q "$d" /etc/caddy/Caddyfile || { echo "Caddy does not serve $d yet (oracle.yml with domain=$d adds it)." >&2; exit 1; }
    systemctl reload caddy || true
    for _ in $(seq 1 30); do
      if curl -fsS --max-time 10 --resolve "$d:443:127.0.0.1" "https://$d/healthz" >/dev/null 2>&1; then echo "Caddy has a valid certificate for $d."; break; fi
      sleep 10
    done
    curl -fsS --max-time 10 --resolve "$d:443:127.0.0.1" "https://$d/healthz" >/dev/null || { echo "No certificate for $d yet; the record stays DNS only (Caddy keeps trying)." >&2; exit 1; }
    set_rec true
    echo "After: $(echo "$recs" | jq -c '[.result[] | {type, content, proxied}]')"
    ;;
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
    echo "--- address: PUBLIC_URL=$(val PUBLIC_URL)"
    echo "--- database settings"; for k in DATABASE_URL DB_FILE PERSISTENT_DISK MAINTENANCE STANDBY; do if grep -q "^$k=" "$ENVF"; then echo "$k: set"; else echo "$k: -"; fi; done
    echo "--- data"; find "$DATA" -maxdepth 1 -type f -printf '%s %f\n' | sort -k2
    echo "--- backups"; find "$DATA/backups" -maxdepth 1 -name '*.db' -printf '%T@ %f\n' 2>/dev/null | sort -rn | head -5 | cut -d' ' -f2; head -30 "$DATA/backups/status.json" 2>/dev/null || true
    echo "--- host actions"; tail -5 "$DATA/host-actions.log" 2>/dev/null || true
    ;;
  *) echo "unknown step: $step" >&2; exit 2 ;;
esac
