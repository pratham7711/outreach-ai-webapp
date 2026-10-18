import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
import { db } from "@/lib/db";
import { SOUND_COVER_COLUMNS, SOUND_COVER_DDL } from "@/lib/sounds/coverSchemaDdl";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Applies the SoundCover table on production, where `migrate deploy` must
 * never run. Same shape and the same ADMIN_MIGRATE_TOKEN gate as
 * /api/admin/migrate-post-thumbnails: GET reports, POST applies and reports.
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
      WHERE table_schema = 'public' AND table_name = 'SoundCover' ORDER BY column_name`,
  );
  const present = new Set(columns.map((c) => c.column_name));
  const missingColumns = SOUND_COVER_COLUMNS.filter((c) => !present.has(c));
  return {
    ready: missingColumns.length === 0,
    missingColumns,
    rows: missingColumns.length === 0 ? await db.soundCover.count() : 0,
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
    for (const stmt of SOUND_COVER_DDL) await db.$executeRawUnsafe(stmt);
    return NextResponse.json({ ok: true, before, after: await inspect() });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
