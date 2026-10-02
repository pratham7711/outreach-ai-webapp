import { NextRequest, NextResponse } from "next/server";
import { resolveTrackerPlan } from "@/lib/trackers/sourceSwitch";
import { runReaderV2 } from "@/lib/trackers/readerRun";
import { checkReaderAlerts } from "@/lib/trackers/readerAlerts";
import { alertOps } from "@/lib/alerts";
import { createLogger } from "@/lib/observability/logger";

/* Reader v2 (plan §07): hourly, beside the legacy sweep rather than instead of
   it (§14 rule 2). It does nothing at all while the switch says legacy, which
   is the position it ships in, so adding this schedule changes nothing until
   someone flips the switch on the ops page. */
export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/read-creator-trackers" } });
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const plan = await resolveTrackerPlan();
  if (plan.effective === "legacy") {
    return NextResponse.json({ ok: true, ran: false, position: plan.position, reason: plan.reason ?? "switch is legacy" });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  try {
    const run = await runReaderV2({ plan, dryRun });
    if (!dryRun) await checkReaderAlerts({ plan: run.plan, maxWallStreak: run.maxWallStreak, scopeOrgIds: plan.scopeOrgIds });
    return NextResponse.json({
      ok: true,
      ran: true,
      plan: run.plan,
      dryRun,
      ...run.counts,
      dueTikTok: run.dueTikTok,
      lanes: run.lanes,
      health: { reads: run.health.reads, proper: run.health.proper, walls: run.health.walls, failures: run.health.failures, ok: run.health.ok },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("reader v2 run failed", { plan: plan.effective, error: message });
    await alertOps({
      source: "tracker-reader",
      title: `Tracker reader ${plan.effective} run failed`,
      facts: { error: message, action: "Switch back to legacy or A on the ops page if this repeats." },
      severity: "critical",
    });
    return NextResponse.json({ error: "Reader run failed" }, { status: 500 });
  }
}
