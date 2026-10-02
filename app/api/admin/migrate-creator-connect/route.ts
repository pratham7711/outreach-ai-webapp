import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { CONNECT_TABLES, CREATOR_CONNECT_DDL } from "@/lib/creators/connectSchemaDdl";
import { backfillMetaGrantors } from "@/lib/platforms/metaGrantor";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Applies the creator-connection tables (CreatorAccountState,
 * CreatorConnectToken) on any database, production included, where
 * `migrate deploy` must never run. Same shape and ADMIN_MIGRATE_TOKEN gate as
 * /api/admin/migrate-creator-roster: GET reports, POST applies and reports.
 *
 * POST ?step=backfill-grantors runs the one-off grantor backfill instead
 * (lib/platforms/metaGrantor.ts): for Meta rows connected before the grantor id
 * was recorded, it asks Meta who granted each still-working token. It writes
 * only CreatorAccountState, skips rows already filled, and takes ?limit=
 * (default 200) and ?after=<id>: each answer carries `nextAfterId`, which is
 * passed back as ?after= until it comes back null.
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
    [...CONNECT_TABLES],
  );
  const present = new Set(rows.map((r) => r.table_name));
  const missingTables = CONNECT_TABLES.filter((t) => !present.has(t));
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
    if (request.nextUrl.searchParams.get("step") === "backfill-grantors") {
      const limit = Number(request.nextUrl.searchParams.get("limit") ?? "200");
      const result = await backfillMetaGrantors({
        limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 200,
        afterId: request.nextUrl.searchParams.get("after"),
      });
      return NextResponse.json({ ok: true, backfill: result });
    }
    const before = await inspect();
    // One statement per call: executeRawUnsafe uses the extended protocol.
    for (const stmt of CREATOR_CONNECT_DDL) await db.$executeRawUnsafe(stmt);
    return NextResponse.json({ ok: true, before, after: await inspect() });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
