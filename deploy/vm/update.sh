#!/usr/bin/env bash
# Deploys the newest commit on main when there is one (run every 2 minutes by a systemd timer, as
# root). The new image is built first; the running app is replaced only if the build succeeds and
# the new container answers /healthz, otherwise the previous version keeps running.
# It also carries out the requests Admin leaves on the data volume (the app cannot act as root):
#   data/.deploy-request   deploy now (even when there is no new commit)
#   data/.restart-request  restart the app container
#   data/.restore-request  restore the named backup from data/backups (deploy/vm/restore.sh)
# What it did goes to data/host-actions.log and data/.host.json (shown in Admin → Hosting).
# When a new commit changes this script or compose.yml, the new copies are installed and run.
set -euo pipefail
APP=/opt/brightfolio
DATA=$APP/data
# One deploy at a time (the timer and a workflow's prep can start together): the second one waits.
exec 9>/run/brightfolio-update.lock
flock -w 600 9 || { echo "Another deploy is still running." >&2; exit 0; }
# A recreate that was interrupted leaves the old container renamed (<id>_brightfolio-app-1), which
# blocks the next one: remove such leftovers (never the running app container itself).
stale() { docker ps -a --format '{{.Names}}' | grep -E '^[0-9a-f]{12}_brightfolio-app-1$' || true; }
for c in $(stale); do docker rm -f "$c" >/dev/null 2>&1 || true; done
mkdir -p "$DATA" && chown 1000:1000 "$DATA"
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$DATA/host-actions.log"; }
hostjson() { printf '{"commit":"%s","at":%s,"ok":%s,"action":"%s"}\n' "$1" "$(date +%s)000" "$2" "$3" > "$DATA/.host.json"; chown 1000:1000 "$DATA/.host.json"; }
take() { local f="$DATA/.$1-request"; [ -f "$f" ] || return 1; rm -f "$f"; }

if [ -f "$DATA/.restore-request" ]; then
  name=$(head -c 200 "$DATA/.restore-request" | tr -cd 'A-Za-z0-9._-'); rm -f "$DATA/.restore-request"
  if [ -n "$name" ] && [ -f "$DATA/backups/$name" ]; then
    log "restore $name requested from Admin"
    if bash "$APP/src/deploy/vm/restore.sh" "$DATA/backups/$name" >>"$DATA/host-actions.log" 2>&1; then log "restore ok"; else log "restore FAILED (see above)"; fi
  else log "restore: no backup named '$name'"; fi
fi
if take restart; then log "restart requested from Admin"; (cd "$APP" && docker compose restart app) && log "restart ok"; fi
take deploy && { log "deploy requested from Admin"; FORCE=1; }
# Admin → Keys "Copy to the server .env": the app leaves an encrypted request (data/.env-request);
# only the app can decrypt it (ENCRYPTION_KEY), so it prints the KEY=value lines and migrate.sh's
# set-env writes them (values never logged). No restart: the key already works from the key store.
if [ -f "$DATA/.env-request" ]; then
  if (cd "$APP" && docker compose exec -T app node scripts/env-request.mjs) | NO_DOCKER=1 bash "$APP/src/deploy/vm/migrate.sh" set-env >/dev/null 2>&1; then log "keys copied to .env from Admin"; else log "copying keys to .env FAILED"; fi
  rm -f "$DATA/.env-request"
fi

cd "$APP/src"
G() { sudo -u brightfolio git "$@"; } # the checkout belongs to the app user
G fetch -q --depth 1 origin main
NEW=$(G rev-parse origin/main); CUR=$(cat "$APP/.deployed" 2>/dev/null || true)
[ "$NEW" = "$CUR" ] && [ -z "${FORCE:-}" ] && exit 0
G reset -q --hard origin/main
# A newer copy of this script: install it (a rename, so this running copy is not changed) and run it.
if ! cmp -s deploy/vm/update.sh /usr/local/bin/brightfolio-update; then
  cp deploy/vm/update.sh /usr/local/bin/brightfolio-update.new && chmod 755 /usr/local/bin/brightfolio-update.new && mv -f /usr/local/bin/brightfolio-update.new /usr/local/bin/brightfolio-update
  log "installed the new update script"; FORCE=1 exec /usr/local/bin/brightfolio-update
fi
cmp -s deploy/vm/compose.yml "$APP/compose.yml" || cp deploy/vm/compose.yml "$APP/compose.yml"
# Caddy reaches the app's processes through deploy/vm/caddy-app.caddy (the leader on 3000, helpers
# beside it): installed when it changes, the site block made to import it once, checked before the
# reload, and put back as it was if Caddy refuses it.
CF=/etc/caddy/Caddyfile CA=/etc/caddy/brightolio-app.caddy
if [ -f "$CF" ] && command -v caddy >/dev/null && ! { cmp -s deploy/vm/caddy-app.caddy "$CA" && grep -q "import $CA" "$CF"; }; then
  cp -p "$CF" "$CF.before-app" 2>/dev/null || true
  if [ -f "$CA" ]; then cp -p "$CA" "$CA.before"; fi
  cp deploy/vm/caddy-app.caddy "$CA"
  if ! grep -q "import $CA" "$CF"; then
    # The block written by setup.sh: reverse_proxy 127.0.0.1:3000 { flush_interval -1 }
    perl -0pi -e "s{\n\treverse_proxy 127\.0\.0\.1:3000 \{\n\t\tflush_interval -1\n\t\}\n}{\n\timport $CA\n}" "$CF"
  fi
  if grep -q "import $CA" "$CF" && caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1 && systemctl reload caddy; then log "Caddy now reaches every app process"
  else cp -p "$CF.before-app" "$CF" 2>/dev/null || true; if [ -f "$CA.before" ]; then cp -p "$CA.before" "$CA"; fi; systemctl reload caddy || true; log "Caddy routing NOT changed (validation failed); still one upstream"; fi
fi
command -v sqlite3 >/dev/null || { apt-get install -y -qq sqlite3 >/dev/null 2>&1 || true; }
docker build -q --pull --build-arg GIT_COMMIT="$NEW" -t brightfolio:new . >/dev/null
cd "$APP"
docker tag brightfolio:latest brightfolio:previous 2>/dev/null || true
docker tag brightfolio:new brightfolio:latest
# The commit is built into the image (GIT_COMMIT); the old marker in .env is removed.
sed -i '/^RENDER_GIT_COMMIT=/d' .env
if ! docker compose up -d --force-recreate app; then
  for c in $(stale); do docker rm -f "$c" >/dev/null 2>&1 || true; done
  docker compose up -d --force-recreate app || true
fi
# A deploy counts only when the app container really runs the new image and answers /healthz: if the
# recreate failed, the old container still answers, and that must not be logged as "Deployed".
want=$(docker image inspect -f '{{.Id}}' brightfolio:new)
running() { docker inspect -f '{{.Image}}' "$(docker compose ps -q app 2>/dev/null | head -1)" 2>/dev/null || true; }
for i in $(seq 1 30); do
  if [ "$(running)" != "$want" ]; then
    # Still the old container after 10 s: one more recreate (leftovers removed first).
    if [ "$i" = 5 ]; then for c in $(stale); do docker rm -f "$c" >/dev/null 2>&1 || true; done; docker compose up -d --force-recreate app || true; fi
    sleep 2; continue
  fi
  if curl -fs http://127.0.0.1:3000/healthz >/dev/null; then echo "$NEW" > "$APP/.deployed"; log "Deployed ${NEW:0:7}"; hostjson "$NEW" true deploy; docker image prune -f >/dev/null; exit 0; fi
  sleep 2
done
if ! docker image inspect brightfolio:previous >/dev/null 2>&1; then echo "The app did not start yet: check $APP/.env (DB_FILE or DATABASE_URL, ENCRYPTION_KEY), then run: sudo FORCE=1 brightfolio-update" >&2; docker compose logs --tail 20 app >&2 || true; hostjson "$NEW" false deploy; exit 1; fi
log "The new version ${NEW:0:7} did not start; going back to the previous one."
for c in $(stale); do docker rm -f "$c" >/dev/null 2>&1 || true; done
docker tag brightfolio:previous brightfolio:latest && docker compose up -d --force-recreate app
hostjson "$NEW" false rollback
exit 1
