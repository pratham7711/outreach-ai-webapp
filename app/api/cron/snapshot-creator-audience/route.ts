import { NextRequest, NextResponse } from "next/server";
import { sweepCreatorAudience } from "@/lib/creators/audienceSweep";
import { createLogger } from "@/lib/observability/logger";
import { cronRoute } from "@/lib/ops/cronRoute";
import { bearerMatches } from "@/lib/http/bearer";

/* The sweep stops itself at four minutes (lib/creators/audienceSweep). */
export const maxDuration = 300;

/* Hourly; each run reads only the Instagram connections whose last audience
   reading is a week old. Logs only, no alertOps: this job sends no email. */
async function cronHandler(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/snapshot-creator-audience" } });

  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    log.warn("auth failed", { reason: "bad-or-missing-cron-secret" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    const result = await sweepCreatorAudience({ dryRun });
    if (result.failed > 0) log.warn("audience reads failed", { read: result.read, failed: result.failed, failures: result.failures });
    return NextResponse.json(result);
  } catch (error) {
    log.error("snapshot-creator-audience cron failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "cron failed" }, { status: 500 });
  }
}

export const GET = cronRoute("snapshot-creator-audience", cronHandler);
