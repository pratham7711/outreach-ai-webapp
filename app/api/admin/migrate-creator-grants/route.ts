import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { CREATOR_GRANT_DDL, GRANT_TABLES } from "@/lib/creators/grantSchemaDdl";
import { loadBackfillPlan, publicPlan } from "@/lib/creators/grantBackfill";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Applies the CreatorGrant table on production, where `migrate deploy` must
 * never run. Same shape and ADMIN_MIGRATE_TOKEN gate as
 * /api/admin/migrate-creator-roster: GET reports, POST applies and reports.
 *
 * One difference, and it is the reason this route is not a copy: the moment
 * the table exists the connection gate stops reading ungated and refuses every
 * connection without a grant. Creating it empty would take every existing
 * connection dark until a backfill ran. So POST plans the backfill first and
 * then creates the table AND writes those grants in one transaction (Postgres
 * DDL is transactional): the table becomes visible already granted.
 * `?backfill=0` skips the grants, for a database where that is wanted.
 *
 * A connection made between the plan and the commit gets no grant (its
 * callback saw no table). Re-run POST /api/admin/backfill-creator-grants a
 * minute after this; it only adds what is missing.
 *
 * The response carries counts per org and platform, never a handle or token.
 */
function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(`Bearer ${expected}`);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorize(request: NextRequest) {
  const token = process.env.ADMIN_MIGRATE_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!tokenMatches(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function inspect() {
  const rows = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [...GRANT_TABLES],
  );
  const present = new Set(rows.map((r) => r.table_name));
  const missingTables = GRANT_TABLES.filter((t) => !present.has(t));
  return { ready: missingTables.length === 0, missingTables };
}

export async function GET(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ ok: true, ...(await inspect()) });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    const before = await inspect();
    const withBackfill = request.nextUrl.searchParams.get("backfill") !== "0";
    const plan = withBackfill ? await loadBackfillPlan(before.ready) : null;

    /* One statement per call (executeRawUnsafe uses the extended protocol),
       all of them and the grants in a single transaction. */
    await db.$transaction([
      ...CREATOR_GRANT_DDL.map((stmt) => db.$executeRawUnsafe(stmt)),
      ...(plan && plan.rows.length > 0
        ? [db.creatorGrant.createMany({ data: plan.rows, skipDuplicates: true })]
        : []),
    ]);

    return NextResponse.json({
      ok: true,
      before,
      after: await inspect(),
      backfill: plan ? publicPlan(plan) : { skipped: true },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
