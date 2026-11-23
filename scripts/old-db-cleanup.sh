#!/usr/bin/env bash
# After the old data was merged and the old database deleted (run once by
# .github/workflows/oracle-merge-scheduled.yml, which commits the result): removes the code that only
# the merge needed. Everything marked "merge-only" goes: lines ending in "merge-only", and blocks
# between ">>> merge-only" and "<<< merge-only". Workflow files are not changed here (a workflow's
# own token may not edit them); the merge steps left in them do nothing once the merge has run.
set -euo pipefail
cd "$(dirname "$0")/.."
git rm -q --ignore-unmatch scripts/turso-pull.mjs scripts/turso-merge.mjs scripts/final-copy.mjs test/merge.test.js test/old-db.test.js
for f in deploy/vm/migrate.sh src/auth.js server.js src/server-admin.js; do
  sed -i -e '/>>> merge-only/,/<<< merge-only/d' -e '/merge-only/d' "$f"
done
# Admin → Database: the "merge pending" banner (a line of HTML, so no marker on it).
sed -i '/db\.mergePending ?/d' public/pages/admin-ops.js
git rm -q --ignore-unmatch scripts/old-db-cleanup.sh
echo "Removed the merge-only code."
