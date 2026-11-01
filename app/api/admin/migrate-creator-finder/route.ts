import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
import { db } from "@/lib/db";
import {
  PROSPECT_COLUMNS,
  PROSPECT_DDL,
  PROSPECT_EVENT_COLUMNS,
  PROSPECT_EVENT_TABLE,
  PROSPECT_TABLE,
} from "@/lib/creatorFinder/prospectDdl";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Creates the Creator Finder tables on production, where `migrate deploy` must
 * never run. Same shape and the same ADMIN_MIGRATE_TOKEN gate as
 * /api/admin/migrate-song-streams: GET reports and changes nothing, POST
 * applies and reports before and after. The routes that use the tables answer
 * "not set up yet" until this has run, so it can run at any time after the
 * deploy.
 */
function authorize(request: NextRequest) {
  const token = process.env.ADMIN_MIGRATE_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!bearerMatches(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function missing(table: string, expected: string[]) {
  const columns = await db.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${table}' ORDER BY column_name`,
  );
  const present = new Set(columns.map((c) => c.column_name));
  return expected.filter((c) => !present.has(c));
}

async function inspect() {
  const missingColumns = [
    ...(await missing(PROSPECT_TABLE, PROSPECT_COLUMNS)).map((c) => `${PROSPECT_TABLE}.${c}`),
    ...(await missing(PROSPECT_EVENT_TABLE, PROSPECT_EVENT_COLUMNS)).map((c) => `${PROSPECT_EVENT_TABLE}.${c}`),
  ];
  const ready = missingColumns.length === 0;
  return { ready, missingColumns, prospects: ready ? await db.creatorProspect.count() : 0 };
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
    for (const stmt of PROSPECT_DDL) await db.$executeRawUnsafe(stmt);
    return NextResponse.json({ ok: true, before, after: await inspect() });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
