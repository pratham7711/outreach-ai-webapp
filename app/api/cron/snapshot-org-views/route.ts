import { NextRequest, NextResponse } from "next/server";
import { snapshotOrgViews } from "@/lib/analytics/orgViewsSnapshot";
import { createLogger } from "@/lib/observability/logger";
import { alertOps } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* One grouped query and one upsert per org. Nothing here talks to a platform,
   so this is fast -- the ceiling is generous only so a very large instance is
   not cut off mid-loop and left with a partial day. */
export const maxDuration = 120;

/**
 * The daily measurement behind "Views over time".
 *
 * Fixed time, 03:30 UTC (see vercel.json), chosen to sit just after the hourly
 * sync-posts run at :00 has refreshed what it can and before snapshot-sounds at
 * 04:00. The reading is therefore taken against numbers that are at most half an
 * hour stale, every day, at the same hour -- which is what makes consecutive
 * points comparable. A rollup taken at a drifting time would put a day's growth
 * partly in the neighbouring bucket.
 */
export async function GET(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/snapshot-org-views" } });

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    log.warn("auth failed", { reason: "bad-or-missing-cron-secret" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    const result = await snapshotOrgViews({ dryRun });

    /* Alerted on, because a silent gap here is invisible in a way the old
       derived chart never was. The derived version always drew something from
       whatever posts existed; a measured series simply has no point for a day
       the cron missed, and a reader cannot tell a missing measurement from a
       flat one. */
    if (!dryRun && result.orgs > 0 && result.written === 0) {
      await alertOps({
        source: "cron/snapshot-org-views",
        title: `Daily views snapshot wrote nothing for ${result.orgs} org(s)`,
        severity: "critical",
        facts: result,
      });
    }

    return NextResponse.json({ ...result, dryRun });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("snapshot-org-views cron failed", { error: message });
    await alertOps({
      source: "cron/snapshot-org-views",
      title: "Daily org views snapshot crashed",
      severity: "critical",
      facts: { error: message },
    });
    return NextResponse.json({ error: "cron failed" }, { status: 500 });
  }
}
