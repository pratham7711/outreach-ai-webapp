import { NextRequest, NextResponse } from "next/server";
import { snapshotSongStreams } from "@/lib/songs/streamSnapshot";
import { createLogger } from "@/lib/observability/logger";
import { cronRoute } from "@/lib/ops/cronRoute";
import { bearerMatches } from "@/lib/http/bearer";

/* The sweep stops itself at four minutes (lib/songs/streamSnapshot); this is
   the platform's ceiling above that. */
export const maxDuration = 300;

/* Logs only, no alertOps: alertOps sends email, and this job sends none. A
   failing run shows in the cron heartbeat on /platform/ops and in the logs. */
async function cronHandler(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/snapshot-song-streams" } });

  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    log.warn("auth failed", { reason: "bad-or-missing-cron-secret" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    const result = await snapshotSongStreams({ dryRun });
    if (result.failed > 0) {
      log.warn("spotify stream reads failed", { read: result.read, failed: result.failed, failures: result.failures });
    }
    return NextResponse.json(result);
  } catch (error) {
    log.error("snapshot-song-streams cron failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "cron failed" }, { status: 500 });
  }
}

export const GET = cronRoute("snapshot-song-streams", cronHandler);
