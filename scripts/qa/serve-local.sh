#!/bin/bash
# Build and serve this checkout on :3009 against the e2e TEST database only --
# how the overnight demo-ready build was shown working (docs/reports/).
#
#   scripts/qa/serve-local.sh build   # npm run build, then serve
#   scripts/qa/serve-local.sh         # serve the existing build
#
# Refuses unless TEST_DATABASE_URL is the e2e project (ep-little-recipe). The
# tokens it needs are random, made on first run, and kept in .qa-local/ (mode
# 600, gitignored). No alert mail is sent: ALERT_EMAIL_TO is empty. Nothing here
# runs a cron, so the Plan B address is never called by the server itself.
set -euo pipefail
cd "$(dirname "$0")/../.."
TEST_URL=$(grep -E '^TEST_DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
case "$TEST_URL" in *ep-little-recipe*) ;; *) echo "refusing: TEST_DATABASE_URL is not the e2e database" >&2; exit 2;; esac
mkdir -p .qa-local && chmod 700 .qa-local
token() { [ -f ".qa-local/$1" ] || (openssl rand -hex 24 > ".qa-local/$1" && chmod 600 ".qa-local/$1"); cat ".qa-local/$1"; }
export DATABASE_URL="$TEST_URL"
export PLATFORM_ADMIN_EMAILS="admin@demo.com"
export ALERT_EMAIL_TO=""
export TRACKER_PLAN_B_HEALTH_TOKEN="$(token planb-health-token)"
export TRACKER_PLAN_B_URL="http://127.0.0.1:8787"
export TRACKER_PLAN_B_TOKEN="$(token planb-worker-token)"
export ADMIN_MIGRATE_TOKEN="$(token admin-migrate-token)"
export OPS_SCHEDULER_TOKEN="$(token ops-scheduler-token)"
export PORT=3009
if [ "${1:-start}" = "build" ]; then
  npm run build > .qa-local/build.log 2>&1 || { echo "build failed: .qa-local/build.log" >&2; exit 1; }
fi
exec npm start
