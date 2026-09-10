// Applies the identity-owned-connections EXPAND schema change to whichever
// database this deployment is pointed at, and reports what the database
// actually has.
//
// Same reasoning and same shape as app/api/admin/migrate-creator-accounts:
// production's Vercel build command is plain `next build` so migrations never
// run there, prod has no _prisma_migrations table (`migrate deploy` must never
// be aimed at it), and the prod DATABASE_URL is a Vercel "sensitive" variable
// that cannot be read back — so a laptop cannot connect to prod even holding
// the credentials. Running the DDL from inside prod is the only route left.
//
// Safety properties:
//   - Inert unless ADMIN_MIGRATE_TOKEN is set: without it every method 404s.
//   - No arbitrary-SQL path and nothing is read from the request body. The only
//     DDL it can run is the fixed, reviewed list in
//     lib/platforms/identitySchemaDdl.ts, which the tracked migration also uses.
//   - Every statement is idempotent, so a re-run is a no-op and a partial run
//     can simply be repeated.
//   - Purely additive: no NOT NULL, no DROP, no data written. Nothing in the
//     shipped code reads these columns yet, which is what makes this deployable
//     ahead of the code that will — and it has to be, because shipping the read
//     code first makes /api/portal/insights and /api/portal/connections 500 on
//     "column does not exist".
//   - GET is read-only, so the change can be verified before and after without
//     running anything. `accountRows` is here because it is the number that
//     decides plain versus CONCURRENTLY index creation, and it cannot be read
//     from anywhere else.
//
// Retire it by removing ADMIN_MIGRATE_TOKEN from the Vercel project once the
// columns are in place.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import {
  IDENTITY_ACCOUNT_COLUMNS,
  IDENTITY_CREATOR_COLUMNS,
  IDENTITY_DDL,
  IDENTITY_INDEX_NAMES,
  IDENTITY_RETAINED_KEY,
} from "@/lib/platforms/identitySchemaDdl";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Constant-time, and length-safe: timingSafeEqual throws on a length mismatch. */
function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(`Bearer ${expected}`);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorize(request: NextRequest) {
  const token = process.env.ADMIN_MIGRATE_TOKEN;
  if (!token) {
    return { ok: false as const, res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  if (!tokenMatches(request.headers.get("authorization"), token)) {
    return { ok: false as const, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true as const };
}

async function columnsOf(table: string) {
  const rows = await db.$queryRawUnsafe<{ column_name: string; data_type: string; is_nullable: string }[]>(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY column_name`,
    table,
  );
  return rows;
}

/**
 * What the database actually has right now.
 *
 * Reported rather than inferred from the statement list, because an idempotent
 * `ADD COLUMN IF NOT EXISTS` succeeds whether or not it did anything — "the DDL
 * ran" is not evidence that the column exists.
 */
async function inspect() {
  const accountColumns = await columnsOf("CreatorSocialAccount");
  const creatorColumns = await columnsOf("Creator");
  const indexes = await db.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename IN ('CreatorSocialAccount', 'Creator')
      ORDER BY indexname`,
  );
  const constraints = await db.$queryRawUnsafe<{ conname: string; convalidated: boolean }[]>(
    `SELECT c.conname, c.convalidated FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE c.contype = 'f' AND t.relname IN ('CreatorSocialAccount', 'Creator')
        AND c.conname LIKE '%creatorUserId_fkey'
      ORDER BY c.conname`,
  );

  const accountPresent = new Set(accountColumns.map((c) => c.column_name));
  const creatorPresent = new Set(creatorColumns.map((c) => c.column_name));
  const indexNames = new Set(indexes.map((i) => i.indexname));

  const missingColumns = [
    ...IDENTITY_ACCOUNT_COLUMNS.filter((c) => !accountPresent.has(c)).map(
      (c) => `CreatorSocialAccount.${c}`,
    ),
    ...IDENTITY_CREATOR_COLUMNS.filter((c) => !creatorPresent.has(c)).map((c) => `Creator.${c}`),
  ];
  const missingIndexes = IDENTITY_INDEX_NAMES.filter((n) => !indexNames.has(n));
  const unvalidatedForeignKeys = constraints.filter((c) => !c.convalidated).map((c) => c.conname);

  /* The legacy key is the only thing still validating org-owned rows, which
     carry creatorUserId NULL and are therefore invisible to the new unique
     key. Losing it here would be silent. */
  const retainedLegacyKey = indexNames.has(IDENTITY_RETAINED_KEY);

  return {
    ready:
      missingColumns.length === 0 &&
      missingIndexes.length === 0 &&
      constraints.length === 2 &&
      unvalidatedForeignKeys.length === 0 &&
      retainedLegacyKey,
    missingColumns,
    missingIndexes,
    foreignKeys: constraints.map((c) => `${c.conname}${c.convalidated ? "" : " (NOT VALID)"}`),
    unvalidatedForeignKeys,
    retainedLegacyKey,
    accountRows: await db.creatorSocialAccount.count(),
    /* Backfill sizing, read before anything is written. */
    accountsWithIdentity: accountPresent.has("creatorUserId")
      ? await db.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT COUNT(*)::bigint AS n FROM "CreatorSocialAccount" WHERE "creatorUserId" IS NOT NULL`,
        ).then((r) => Number(r[0]?.n ?? 0))
      : null,
    accountsAwaitingReseal: accountPresent.has("tokenAad")
      ? await db.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT COUNT(*)::bigint AS n FROM "CreatorSocialAccount" WHERE "tokenAad" IS DISTINCT FROM 'row'`,
        ).then((r) => Number(r[0]?.n ?? 0))
      : null,
  };
}

export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return auth.res;
  try {
    return NextResponse.json({ ok: true, ...(await inspect()) });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return auth.res;

  try {
    const before = await inspect();
    const applied: string[] = [];
    /* One statement per call: Prisma's executeRawUnsafe uses the extended
       protocol, which permits exactly one. */
    for (const stmt of IDENTITY_DDL) {
      await db.$executeRawUnsafe(stmt);
      applied.push(stmt.replace(/\s+/g, " ").trim());
    }
    const after = await inspect();
    return NextResponse.json({
      ok: after.ready,
      statements: applied.length,
      applied,
      before: {
        ready: before.ready,
        missingColumns: before.missingColumns,
        missingIndexes: before.missingIndexes,
      },
      after,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
