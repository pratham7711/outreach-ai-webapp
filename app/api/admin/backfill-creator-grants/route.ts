import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { grantTablesReady } from "@/lib/creators/grantTables";
import { applyBackfill, loadBackfillPlan, publicPlan } from "@/lib/creators/grantBackfill";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Grants for connections made before grants were kept (lib/creators/grantBackfill).
 *
 * Dry run by default: GET answers what a POST would write, per org and
 * platform, and why anything would be left out. POST writes it. Re-runnable:
 * a connection that already holds a live grant in its org is counted as
 * existing and left alone.
 *
 * Counts only — never a handle, a token or a connection id. Same
 * ADMIN_MIGRATE_TOKEN gate as the migrate routes.
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

export async function GET(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    const tableExists = await grantTablesReady({ fresh: true });
    const plan = await loadBackfillPlan(tableExists);
    return NextResponse.json({ ok: true, dryRun: true, tableExists, ...publicPlan(plan) });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    const result = await applyBackfill();
    if (!result) {
      return NextResponse.json(
        {
          error: "CreatorGrant does not exist yet. POST /api/admin/migrate-creator-grants creates it and backfills in one step.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, created: result.created, ...publicPlan(result.plan) });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
