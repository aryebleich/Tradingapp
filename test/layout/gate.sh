#!/usr/bin/env bash
# The page gate: runs every page in a real browser against a local server (test mode, sandbox
# data from the Alpaca mock) and compares disclosures, figures, controls and accessibility with the
# golden baseline. Used before every merge, and on a production-mode build as "staging".
#   bash test/layout/gate.sh            # test mode
#   STAGING=1 bash test/layout/gate.sh  # production mode (NODE_ENV=production)
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=${OUT:-e2e-output/layout-gate}; mkdir -p "$OUT"; PORT=${PORT:-3195}
if [ -n "${STAGING:-}" ]; then
  node -e "import('./test/mock-alpaca.js').then(async m=>{const s=await m.startMock();require('fs').writeFileSync('$OUT/mock.url',s.url);setInterval(()=>{},1e9)})" > /dev/null 2>&1 &
  MOCK=$!
  for i in $(seq 1 50); do [ -s "$OUT/mock.url" ] && break; sleep 0.2; done
  M=$(cat "$OUT/mock.url")
  ADMIN_EMAIL=layout-owner@example.com NODE_ENV=production ALLOW_UNPATCHED_NODE=1 PORT=$PORT PUBLIC_URL=http://localhost:$PORT \
    ENCRYPTION_KEY=staging-only-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n') DB_FILE=/tmp/qp-gate-$$.db FREE_DATA=off \
    BROKER_API_KEY=BKEY BROKER_API_SECRET=BSECRET BROKER_BASE_URL=$M ALPACA_TRADING_URL=$M ALPACA_DATA_URL=$M ALPACA_DATA_SANDBOX_URL=$M \
    ALPACA_KEY_ID=DKEY ALPACA_SECRET=DSECRET ALPACA_STREAM_URL=ws://127.0.0.1:1 node server.js > "$OUT/server.log" 2>&1 &
  SRV=$!
  trap 'kill $SRV $MOCK 2>/dev/null; rm -f /tmp/qp-gate-$$.db*' EXIT
  for i in $(seq 1 100); do curl -sf localhost:$PORT/healthz > /dev/null && break; sleep 0.3; done
  echo "staging up on http://localhost:$PORT (NODE_ENV=production)"
  LAYOUT_OWNER_EMAIL=layout-owner@example.com node test/layout/run.mjs --base http://localhost:$PORT --out "$OUT" --jobs ${JOBS:-4} ${ONLY:+--only $ONLY}
else
  node test/layout/run.mjs --port $PORT --out "$OUT" --jobs ${JOBS:-4} ${ONLY:+--only $ONLY}
fi
node test/layout/compare.mjs "$OUT"
