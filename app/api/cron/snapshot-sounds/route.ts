import { NextRequest, NextResponse } from "next/server";
import { snapshotSounds } from "@/lib/sounds/snapshot";
import { createLogger } from "@/lib/observability/logger";
import { alertOps, shouldAlertOnBatch } from "@/lib/alerts";

export async function GET(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/snapshot-sounds" } });

  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    log.warn("auth failed", { reason: "bad-or-missing-cron-secret" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    // The loop itself lives in lib/sounds/snapshot.ts because the on-demand
    // Refresh button runs it too. Alerting stays here, on the cron boundary: a
    // scheduled run failing is an ops problem, a person clicking Refresh and
    // seeing a failure is not.
    const result = await snapshotSounds({ dryRun });
    const { snapshots, failed, skipped } = result;

    if (shouldAlertOnBatch({ failed, total: snapshots + failed })) {
      await alertOps({
        source: "cron/snapshot-sounds",
        title: `Sound/audio fetcher failing: ${failed} of ${snapshots + failed}`,
        severity: "critical",
        facts: { snapshots, failed, skipped, dryRun },
      });
    }
    return NextResponse.json({ ...result, dryRun });
  } catch (error) {
    log.error("snapshot-sounds cron failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await alertOps({
      source: "cron/snapshot-sounds",
      title: "Sound/audio snapshot cron crashed",
      severity: "critical",
      facts: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: "cron failed" }, { status: 500 });
  }
}
