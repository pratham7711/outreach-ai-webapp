#!/bin/bash
# Rehearses the prod DDL order (docs/reports, section 9) against the local
# server started by scripts/qa/serve-local.sh -- which only ever points at the
# e2e test database. Each admin route: GET (inspect), POST (apply), GET again.
# A second POST must be a no-op, since prod may see a route run twice.
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE="${BASE:-http://localhost:3009}"
TOKEN="$(cat .qa-local/admin-migrate-token)"
call() { curl -sS -X "$1" -H "authorization: Bearer $TOKEN" -w ' [%{http_code}]\n' "$BASE$2"; }
for route in migrate-tracker-sources migrate-creator-connect migrate-list-approval migrate-ops-guards migrate-creator-account-ids "$@"; do
  echo "== $route"
  echo -n "inspect  "; call GET "/api/admin/$route"
  echo -n "apply    "; call POST "/api/admin/$route"
  echo -n "again    "; call POST "/api/admin/$route"
  echo -n "inspect  "; call GET "/api/admin/$route"
done
echo "== creator grants: dry run, apply with backfill, dry run again"
echo -n "dry-run  "; call GET /api/admin/backfill-creator-grants
echo -n "apply    "; call POST /api/admin/migrate-creator-grants
echo -n "inspect  "; call GET /api/admin/migrate-creator-grants
echo -n "dry-run  "; call GET /api/admin/backfill-creator-grants
