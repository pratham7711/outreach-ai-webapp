import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { TRACKER_INDEXES, TRACKER_INDEX_DDL } from "@/lib/ops/trackerIndexDdl";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Applies the tracker-table indexes on production, where `migrate deploy` must
 * never run. Same shape and ADMIN_MIGRATE_TOKEN gate as
 * /api/admin/migrate-ops-guards: GET reports, POST applies and reports.
 * Indexes only -- no table, column or row is touched.
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
  const rows = await db.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
    [...TRACKER_INDEXES],
  );
  const present = new Set(rows.map((r) => r.indexname));
  const missingIndexes = TRACKER_INDEXES.filter((i) => !present.has(i));
  return { ready: missingIndexes.length === 0, missingIndexes };
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
    // One statement per call: executeRawUnsafe uses the extended protocol.
    for (const stmt of TRACKER_INDEX_DDL) await db.$executeRawUnsafe(stmt);
    return NextResponse.json({ ok: true, before, after: await inspect() });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
