#!/usr/bin/env bash
# Phase 5/6 "staging": the merged code in production mode (NODE_ENV=production, bundled assets,
# production caching and headers) on this machine, against the Alpaca mock (sandbox data only), then
# the full layout suite against its URL. Writes everything to e2e-output/layout-staging/.
#   LIGHTHOUSE=/path/to/lighthouse bash test/layout/staging.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=e2e-output/layout-staging; mkdir -p "$OUT"; PORT=${PORT:-3172}
node -e "import('./test/mock-alpaca.js').then(async m=>{const s=await m.startMock();require('fs').writeFileSync('$OUT/mock.url',s.url);setInterval(()=>{},1e9)})" > /dev/null 2>&1 &
MOCK=$!
for i in $(seq 1 50); do [ -s "$OUT/mock.url" ] && break; sleep 0.2; done
M=$(cat "$OUT/mock.url")
NODE_ENV=production ALLOW_UNPATCHED_NODE=1 LAYOUT_V2_AUTOSTART=0 PORT=$PORT PUBLIC_URL=http://localhost:$PORT \
  ENCRYPTION_KEY=staging-only-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n') DB_FILE=/tmp/qp-staging-$$.db FREE_DATA=off \
  BROKER_API_KEY=BKEY BROKER_API_SECRET=BSECRET BROKER_BASE_URL=$M ALPACA_TRADING_URL=$M ALPACA_DATA_URL=$M ALPACA_DATA_SANDBOX_URL=$M \
  ALPACA_KEY_ID=DKEY ALPACA_SECRET=DSECRET ALPACA_STREAM_URL=ws://127.0.0.1:1 node server.js > "$OUT/server.log" 2>&1 &
SRV=$!
trap 'kill $SRV $MOCK 2>/dev/null; rm -f /tmp/qp-staging-$$.db*' EXIT
for i in $(seq 1 100); do curl -sf localhost:$PORT/healthz > /dev/null && break; sleep 0.3; done
echo "staging up on http://localhost:$PORT (NODE_ENV=production)"
node test/layout/run.mjs --pair --base http://localhost:$PORT --out "$OUT" --jobs ${JOBS:-4}
node test/layout/compare.mjs "$OUT" || STATUS=1
[ -n "${LIGHTHOUSE:-}" ] && { node test/layout/lighthouse.mjs --base http://localhost:$PORT --out "$OUT" --runs ${LH_RUNS:-3} || STATUS=1; }
exit ${STATUS:-0}
