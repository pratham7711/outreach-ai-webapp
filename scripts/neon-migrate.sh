#!/usr/bin/env bash
#
# Move a Neon database to another Neon project (region change) by logical
# dump/restore. Carries schema and data verbatim, so it does not depend on
# Prisma migration history — production has no _prisma_migrations table
# (it was applied with `prisma db push`), which makes `migrate deploy`
# unsafe there. See docs/DB_MIGRATION_RUNBOOK.md.
#
# Usage:
#   export OLD_DB='postgresql://...ap-southeast-1...'   # source, DIRECT endpoint
#   export NEW_DB='postgresql://...us-east-1...'        # target, DIRECT endpoint
#   scripts/neon-migrate.sh preflight    # check only, changes nothing
#   scripts/neon-migrate.sh run          # dump, restore, verify
#
# Credentials are read from the environment and never printed — only hostnames
# are echoed, and any URL appearing in tool output is redacted. The dump is
# written outside the repository.
#
set -uo pipefail

BIN=${PG_BIN:-/opt/homebrew/opt/libpq/bin}
PSQL="$BIN/psql"
PGDUMP="$BIN/pg_dump"
PGRESTORE="$BIN/pg_restore"
OUTDIR=${OUTDIR:-$HOME/neon-migration}
MODE=${1:-preflight}

die() { echo "ERROR: $*" >&2; exit 1; }
host_of() { printf '%s' "$1" | sed -E 's#.*@([^/?]+).*#\1#'; }
redact() { sed -E 's#postgres(ql)?://[^ ]+#<redacted>#g'; }

for b in "$PSQL" "$PGDUMP" "$PGRESTORE"; do
  [ -x "$b" ] || die "$b not found. Run: brew install libpq"
done
[ -n "${OLD_DB:-}" ] || die "OLD_DB is not set"
[ -n "${NEW_DB:-}" ] || die "NEW_DB is not set"

# pg_dump/pg_restore need a real session: the pooler is transaction-scoped and
# cannot hold the locks a restore takes. Prisma-only query params (pgbouncer,
# connection_limit) are not libpq options, so keep only sslmode.
sanitize() {
  local u=$1 name=$2 base params ssl
  case $u in
    *-pooler*) die "$name points at the pooler endpoint. Use the DIRECT endpoint (drop '-pooler')." ;;
  esac
  base=${u%%\?*}
  params=""
  case $u in *\?*) params=${u#*\?} ;; esac
  case $params in
    *sslmode=*) ssl=$(printf '%s' "$params" | sed -E 's/.*sslmode=([^&]+).*/\1/') ;;
    *)          ssl=require ;;
  esac
  printf '%s?sslmode=%s' "$base" "$ssl"
}

SRC=$(sanitize "$OLD_DB" OLD_DB) || exit 1
DST=$(sanitize "$NEW_DB" NEW_DB) || exit 1

SRC_HOST=$(host_of "$SRC")
DST_HOST=$(host_of "$DST")
echo "source : $SRC_HOST"
echo "target : $DST_HOST"
[ "$SRC_HOST" != "$DST_HOST" ] || die "source and target are the same host"

q() { PGCONNECT_TIMEOUT=30 "$PSQL" "$1" -Atc "$2" 2>&1; }

check() {
  local url=$1 label=$2 out
  out=$(q "$url" 'select 1')
  if [ "$out" != "1" ]; then
    echo "$label: UNREACHABLE"
    printf '%s\n' "$out" | redact | head -3
    return 1
  fi
  echo "$label: ok (postgres $(q "$url" 'show server_version'))"
  return 0
}

counts() {
  q "$1" "select 'orgs='||(select count(*) from \"Organization\")
       ||' users='||(select count(*) from \"User\")
       ||' campaigns='||(select count(*) from \"Campaign\")
       ||' creators='||(select count(*) from \"Creator\")
       ||' posts='||(select count(*) from \"Post\")
       ||' snapshots='||(select count(*) from \"PostMetricSnapshot\")"
}

enum_count() { q "$1" "select count(*) from pg_type where typtype='e'"; }
ext_list()   { q "$1" "select coalesce(string_agg(extname, ',' order by extname), '(none)') from pg_extension"; }

echo
echo "== connectivity =="
check "$SRC" source || die "source unreachable. If Neon reports a data-transfer quota error, upgrade the plan FIRST — a dump is a large read and cannot run while reads are blocked."
check "$DST" target || die "target unreachable"

echo
echo "== target must be empty =="
n=$(q "$DST" "select count(*) from information_schema.tables where table_schema='public'")
echo "public tables in target: $n"
[ "$n" = "0" ] || die "target already has $n tables. Refusing to overwrite — use a fresh project or drop the schema."

echo
echo "== source inventory =="
echo "size   : $(q "$SRC" 'select pg_size_pretty(pg_database_size(current_database()))')"
SRC_COUNTS=$(counts "$SRC")
echo "counts : $SRC_COUNTS"
echo "enums  : $(enum_count "$SRC")"
echo "exts   : $(ext_list "$SRC")"

if [ "$MODE" = preflight ]; then
  echo
  echo "PREFLIGHT OK — nothing changed. Re-run with: scripts/neon-migrate.sh run"
  exit 0
fi
[ "$MODE" = run ] || die "unknown mode '$MODE' (use preflight or run)"

mkdir -p "$OUTDIR"
DUMP="$OUTDIR/neon-$(date +%Y%m%d-%H%M%S).dump"

echo
echo "== dump =="
if ! "$PGDUMP" "$SRC" --format=custom --no-owner --no-privileges --file="$DUMP" 2>&1 | redact; then
  die "pg_dump failed"
fi
[ -s "$DUMP" ] || die "dump is empty or missing"
echo "wrote $DUMP ($(du -h "$DUMP" | cut -f1))"

echo
echo "== restore =="
# --exit-on-error so a partial restore fails loudly instead of looking fine.
if ! "$PGRESTORE" --dbname="$DST" --no-owner --no-privileges --exit-on-error "$DUMP" 2>&1 | redact; then
  die "restore failed — target may be partially populated. Drop and recreate its schema before retrying."
fi

echo
echo "== verify =="
DST_COUNTS=$(counts "$DST")
echo "source : $SRC_COUNTS"
echo "target : $DST_COUNTS"
[ "$SRC_COUNTS" = "$DST_COUNTS" ] || die "ROW COUNT MISMATCH — do NOT repoint production. Investigate first."
echo "MATCH — row counts identical."
echo "enums  : source=$(enum_count "$SRC") target=$(enum_count "$DST")"
echo "exts   : source=$(ext_list "$SRC") target=$(ext_list "$DST")"

cat <<EOF

DONE. Dump retained at:
  $DUMP

Next (docs/DB_MIGRATION_RUNBOOK.md step 5) — note the POOLER url for the app:
  vercel env rm  DATABASE_URL production
  vercel env add DATABASE_URL production
  vercel --prod

Keep the old Neon project for 7 days as a rollback window.
EOF
