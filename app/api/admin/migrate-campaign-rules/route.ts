import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
import { db } from "@/lib/db";
import {
  CAMPAIGN_RULES_COLUMNS,
  CAMPAIGN_RULES_DDL,
  CAMPAIGN_RULES_TABLE,
  POST_ANNOTATION_COLUMNS,
  POST_ANNOTATION_TABLE,
} from "@/lib/campaigns/rulesDdl";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Applies the CampaignRules and PostAnnotation tables on production, where
 * `migrate deploy` must never run. Same shape and the same ADMIN_MIGRATE_TOKEN
 * gate as /api/admin/migrate-song-streams: GET reports, POST applies and reports.
 */
function authorize(request: NextRequest) {
  const token = process.env.ADMIN_MIGRATE_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!bearerMatches(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function missing(table: string, wanted: string[]) {
  const columns = await db.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
    table,
  );
  const present = new Set(columns.map((c) => c.column_name));
  return wanted.filter((c) => !present.has(c));
}

async function inspect() {
  const rules = await missing(CAMPAIGN_RULES_TABLE, CAMPAIGN_RULES_COLUMNS);
  const annotations = await missing(POST_ANNOTATION_TABLE, POST_ANNOTATION_COLUMNS);
  return {
    ready: rules.length === 0 && annotations.length === 0,
    missingColumns: { [CAMPAIGN_RULES_TABLE]: rules, [POST_ANNOTATION_TABLE]: annotations },
    rows: {
      [CAMPAIGN_RULES_TABLE]: rules.length === 0 ? await db.campaignRules.count() : 0,
      [POST_ANNOTATION_TABLE]: annotations.length === 0 ? await db.postAnnotation.count() : 0,
    },
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
    for (const stmt of CAMPAIGN_RULES_DDL) await db.$executeRawUnsafe(stmt);
    return NextResponse.json({ ok: true, before, after: await inspect() });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
