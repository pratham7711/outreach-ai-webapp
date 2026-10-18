import { NextRequest, NextResponse } from "next/server";
import { snapshotSounds } from "@/lib/sounds/snapshot";
import { createLogger } from "@/lib/observability/logger";
import { alertOps, shouldAlertOnBatch } from "@/lib/alerts";
import { cronRoute } from "@/lib/ops/cronRoute";
import { bearerMatches } from "@/lib/http/bearer";
import { soundsWithoutCover } from "@/lib/sounds/coverStore";

/* Declared, not inherited: the sweep's own deadline is four minutes plus a
   30s backstop (lib/ops/waitUntil), and both are sized against this. */
export const maxDuration = 300;

async function cronHandler(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/snapshot-sounds" } });

  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!bearerMatches(authHeader, cronSecret)) {
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

    /* minFailures is lowered here rather than in shouldAlertOnBatch, whose
       default of 5 exists to stop a three-post batch waking anyone. Sounds are
       not posts: an org tracks a handful of them, so the whole corpus failing
       still sits under the default and the sound fetcher has been able to fail
       completely, every night, in silence. Half of a small set failing is the
       outage, and the ratio still guards against one flaky page. */
    if (shouldAlertOnBatch({ failed, total: snapshots + failed, minFailures: 1 })) {
      await alertOps({
        source: "cron/snapshot-sounds",
        title: `Sound/audio fetcher failing: ${failed} of ${snapshots + failed}`,
        severity: "critical",
        facts: { snapshots, failed, skipped, dryRun },
      });
    }
    /* A sound's cover is kept once and then never lost, so the only way a
       report shows a music note is a cover that was never downloaded. Say so
       once a day rather than finding out from a client. */
    if (!dryRun) {
      try {
        const missing = await soundsWithoutCover();
        if (missing.length) {
          await alertOps({
            source: "cron/snapshot-sounds",
            title: `Sound covers missing: ${missing.length}`,
            severity: "warn",
            facts: {
              sounds: missing.length,
              soundIds: missing.slice(0, 20).join(", "),
              remedy: "POST /api/admin/upload-sound-cover?soundId=&source= with the picture",
            },
          });
        }
      } catch (e) {
        log.warn("sound cover check failed", { error: e instanceof Error ? e.message : String(e) });
      }
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

/* Kill switch and heartbeat around the handler above (lib/ops/cronRoute). */
export const GET = cronRoute("snapshot-sounds", cronHandler);
