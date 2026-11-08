import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/observability/logger";
import { runCanary } from "@/lib/ops/canary";
import { cronRoute } from "@/lib/ops/cronRoute";
import { bearerMatches } from "@/lib/http/bearer";

/* The hourly canary (plan §13 C): heartbeats against their cadence, switches
   and breakers, and the values the readers wrote. Database reads only -- it
   never boots a sandbox or asks a platform anything -- so it is cheap enough
   to run every hour, and it runs at :16, last in the window the :10 jobs have
   already woken Neon for. Alerts go to the operator through alertOps, once a
   day per problem. */
export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function cronHandler(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/ops-canary" } });
  const cronSecret = process.env.CRON_SECRET;
  if (!bearerMatches(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const result = await runCanary({ dryRun });
  log.info("canary ran", { findings: result.findings.length, dryRun, ...result.checked });
  return NextResponse.json({
    ok: true,
    dryRun,
    checked: result.checked,
    findings: result.findings.map((f) => ({ severity: f.severity, title: f.title })),
  });
}

/* Kill switch and heartbeat around the handler above (lib/ops/cronRoute). */
export const GET = cronRoute("ops-canary", cronHandler);
