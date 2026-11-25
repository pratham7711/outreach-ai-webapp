import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
import { db } from "@/lib/db";
import { CONNECTION_HEALTH_DDL, CONNECTION_HEALTH_TABLES } from "@/lib/creators/connectionHealthDdl";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Creates CreatorConnectionHealth on production, where `migrate deploy` must
 * never run. Same ADMIN_MIGRATE_TOKEN gate as /api/admin/migrate-creator-connect:
 * GET reports and changes nothing, POST applies and reports before and after.
 * Additive only (one new table); until it exists connection expiry is simply
 * not recorded and nothing else changes.
 */
function authorize(request: NextRequest) {
  const token = process.env.ADMIN_MIGRATE_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!bearerMatches(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function inspect() {
  const rows = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [...CONNECTION_HEALTH_TABLES],
  );
  const present = new Set(rows.map((r) => r.table_name));
  const missingTables = CONNECTION_HEALTH_TABLES.filter((t) => !present.has(t));
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
    // One statement per call: executeRawUnsafe uses the extended protocol.
    for (const stmt of CONNECTION_HEALTH_DDL) await db.$executeRawUnsafe(stmt);
    return NextResponse.json({ ok: true, before, after: await inspect() });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
