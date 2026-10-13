import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/observability/logger";
import { runMeters } from "@/lib/ops/meters";
import { cronRoute } from "@/lib/ops/cronRoute";
import { bearerMatches } from "@/lib/http/bearer";

/* The weekly spend meters (plan §13 M): last week's Neon compute, from Neon's
   consumption API, and last week's Sandbox compute, from our own counter, each
   against the scale report's 4k model. Monday 03:14 UTC, after the hourly
   :10/:12 jobs have woken the database. One row per meter per week; an alert
   at 120% of the model's upper bound. Without NEON_API_KEY / NEON_ORG_ID the
   Neon row says "not-configured" and nothing fails. */
export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function cronHandler(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/ops-meters" } });
  const cronSecret = process.env.CRON_SECRET;
  if (!bearerMatches(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const result = await runMeters({ dryRun });
  log.info("meters read", {
    weekStart: result.weekStart,
    dryRun,
    ...Object.fromEntries(result.rows.map((r) => [r.meter, r.status])),
  });
  return NextResponse.json({
    ok: true,
    dryRun,
    weekStart: result.weekStart,
    meters: result.rows.map((r) => ({
      meter: r.meter,
      status: r.status,
      value: r.value,
      unit: r.unit,
      costUsd: r.costUsd,
      budgetUsd: r.budgetUsd,
      ratio: r.ratio,
      saved: r.saved,
    })),
  });
}

/* Kill switch and heartbeat around the handler above (lib/ops/cronRoute). */
export const GET = cronRoute("ops-meters", cronHandler);
