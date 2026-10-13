import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
import { db } from "@/lib/db";
import { CREATOR_AVATAR_DDL } from "@/lib/creators/avatarSchemaDdl";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Applies the CreatorAvatar table on production, where `migrate deploy` must
 * never run. Same shape and the same ADMIN_MIGRATE_TOKEN gate as
 * /api/admin/migrate-creator-accounts: GET reports, POST applies and reports.
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
  const columns = await db.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'CreatorAvatar' ORDER BY column_name`,
  );
  const expected = ["creatorId", "data", "failedAt", "failure", "fetchedAt", "orgId", "sourceUrl"];
  const present = new Set(columns.map((c) => c.column_name));
  const missingColumns = expected.filter((c) => !present.has(c));
  return {
    ready: missingColumns.length === 0,
    missingColumns,
    rows: missingColumns.length === 0 ? await db.creatorAvatar.count() : 0,
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
    for (const stmt of CREATOR_AVATAR_DDL) await db.$executeRawUnsafe(stmt);
    return NextResponse.json({ ok: true, before, after: await inspect() });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
