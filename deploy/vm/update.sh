#!/usr/bin/env bash
# Deploys the newest commit on main when there is one (run every 2 minutes by a systemd timer).
# The new image is built first; the running app is replaced only if the build succeeds and the
# new container answers /healthz, otherwise the previous version keeps running.
set -euo pipefail
APP=/opt/brightfolio
cd "$APP/src"
G() { sudo -u brightfolio git "$@"; } # the checkout belongs to the app user
G fetch -q --depth 1 origin main
NEW=$(G rev-parse origin/main); CUR=$(cat "$APP/.deployed" 2>/dev/null || true)
[ "$NEW" = "$CUR" ] && [ -z "${FORCE:-}" ] && exit 0
G reset -q --hard origin/main
docker build -q --pull -t brightfolio:new . >/dev/null
cd "$APP" && mkdir -p data && chown 1000:1000 data
docker tag brightfolio:latest brightfolio:previous 2>/dev/null || true
docker tag brightfolio:new brightfolio:latest
grep -q '^RENDER_GIT_COMMIT=' .env && sed -i "s/^RENDER_GIT_COMMIT=.*/RENDER_GIT_COMMIT=$NEW/" .env || echo "RENDER_GIT_COMMIT=$NEW" >> .env
docker compose up -d --force-recreate app
for i in $(seq 1 30); do curl -fs http://127.0.0.1:3000/healthz >/dev/null && { echo "$NEW" > "$APP/.deployed"; echo "Deployed ${NEW:0:7}"; docker image prune -f >/dev/null; exit 0; }; sleep 2; done
if ! docker image inspect brightfolio:previous >/dev/null 2>&1; then echo "The app did not start yet: check $APP/.env (DATABASE_URL, DATABASE_AUTH_TOKEN, ENCRYPTION_KEY), then run: sudo FORCE=1 brightfolio-update" >&2; docker compose logs --tail 20 app >&2 || true; exit 1; fi
echo "The new version did not start; going back to the previous one." >&2
docker tag brightfolio:previous brightfolio:latest && docker compose up -d --force-recreate app
exit 1
