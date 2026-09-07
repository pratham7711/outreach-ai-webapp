// Applies the CreatorSocialAccount multi-account schema change to whichever
// database this deployment is pointed at.
//
// Why a route and not a migration: production's Vercel build command is plain
// `next build`, so migrations never run there, prod was built with `db push` and
// has no _prisma_migrations table at all (`migrate deploy` must never be aimed
// at it), and the prod DATABASE_URL is a Vercel "sensitive" variable — it is
// write-only and cannot be read back, so a laptop cannot connect to prod even
// with the credentials in hand. Running the DDL from inside prod, where
// DATABASE_URL is already in the environment, is the only route left. This is
// the same reasoning, and the same shape, as app/api/admin/cc-sync.
//
// Safety properties:
//   - Inert unless ADMIN_MIGRATE_TOKEN is set: without it every method 404s, so
//     the route does not exist as far as an unauthenticated caller can tell.
//   - No arbitrary-SQL path and nothing is read from the request body. The only
//     DDL it can run is the fixed, reviewed list in
//     lib/platforms/accountSchemaDdl.ts, which the tracked migration also uses.
//   - Every statement is idempotent, so a re-run is a no-op rather than an
//     error, and a partial run can simply be repeated.
//   - GET is read-only: it reports what the database currently has, so the
//     change can be verified before and after without running anything.
//
// Retire it by removing ADMIN_MIGRATE_TOKEN from the Vercel project once the
// columns are in place.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import {
  CREATOR_ACCOUNT_DDL,
  CREATOR_ACCOUNT_COLUMNS,
  CREATOR_ACCOUNT_INDEX_NAME,
} from "@/lib/platforms/accountSchemaDdl";

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

/**
 * What the database actually has right now.
 *
 * Reported rather than inferred from the statement list, because an idempotent
 * `ADD COLUMN IF NOT EXISTS` succeeds whether or not it did anything — "the DDL
 * ran" is not evidence that the column exists.
 */
async function inspect() {
  const columns = await db.$queryRawUnsafe<{ column_name: string; data_type: string; is_nullable: string }[]>(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'CreatorSocialAccount'
      ORDER BY column_name`,
  );
  const indexes = await db.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'CreatorSocialAccount'
      ORDER BY indexname`,
  );

  const present = new Set(columns.map((c) => c.column_name));
  const missingColumns = CREATOR_ACCOUNT_COLUMNS.filter((c) => !present.has(c));
  const hasNewIndex = indexes.some((i) => i.indexname === CREATOR_ACCOUNT_INDEX_NAME);
  const hasOldIndex = indexes.some(
    (i) => i.indexname === "CreatorSocialAccount_creatorId_platform_key",
  );

  return {
    /* The one question the caller is actually asking. */
    ready: missingColumns.length === 0 && hasNewIndex && !hasOldIndex,
    missingColumns,
    hasNewIndex,
    hasOldIndex,
    columns: columns.map((c) => `${c.column_name} ${c.data_type}${c.is_nullable === "NO" ? " NOT NULL" : ""}`),
    indexes: indexes.map((i) => i.indexname),
    accountRows: await db.creatorSocialAccount.count(),
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
    for (const stmt of CREATOR_ACCOUNT_DDL) {
      await db.$executeRawUnsafe(stmt);
      applied.push(stmt.replace(/\s+/g, " ").trim());
    }
    const after = await inspect();
    return NextResponse.json({
      ok: after.ready,
      statements: applied.length,
      applied,
      before: { ready: before.ready, missingColumns: before.missingColumns, hasOldIndex: before.hasOldIndex },
      after,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
