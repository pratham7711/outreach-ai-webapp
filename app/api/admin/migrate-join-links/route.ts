import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
import { db } from "@/lib/db";
import { JOIN_LINK_DDL, JOIN_LINK_TABLES } from "@/lib/creators/joinLinkDdl";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Creates OrgJoinLink, CreatorEmailVerification and CreatorJoinRecord on production, where
 * `migrate deploy` must never run. Same ADMIN_MIGRATE_TOKEN gate as
 * /api/admin/migrate-song-links: GET reports and changes nothing, POST applies
 * and reports before and after. Additive only; safe to run at any time after
 * the code that reads the table is deployed.
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
  const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (${JOIN_LINK_TABLES.map((t) => `'${t}'`).join(", ")})`,
  );
  const present = new Set(tables.map((t) => t.table_name));
  const missingTables = JOIN_LINK_TABLES.filter((t) => !present.has(t));
  const ready = missingTables.length === 0;
  return {
    ready,
    missingTables,
    links: ready ? await db.orgJoinLink.count() : 0,
    verifiedCreators: ready ? await db.creatorEmailVerification.count() : 0,
  };
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
    for (const stmt of JOIN_LINK_DDL) await db.$executeRawUnsafe(stmt);
    return NextResponse.json({ ok: true, before, after: await inspect() });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
