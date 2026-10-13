import { NextRequest, NextResponse } from "next/server";
import { cronRoute } from "@/lib/ops/cronRoute";
import { POST_SWEEP_STOP_PERCENT } from "@/lib/platforms/instagramDiscoveryTokens";
import { instagramHourlyBudget, instagramPacedHourly } from "@/lib/sync/instagramPacing";
import { runPostSweep } from "@/lib/sync/postSweepRun";
import { bearerMatches } from "@/lib/http/bearer";

/* Instagram's share of the post sweep, a small batch every hour instead of a
   burst every six (lib/sync/instagramPacing). Stops at POST_SWEEP_STOP_PERCENT
   of Meta's reported usage; a post it does not reach stays due. */
export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function cronHandler(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!bearerMatches(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!instagramPacedHourly()) return NextResponse.json({ ok: true, skipped: "off" });
  return runPostSweep(request, {
    platforms: ["INSTAGRAM"],
    budgets: { INSTAGRAM: instagramHourlyBudget() },
    source: "cron/sync-instagram-posts",
    instagramStopAtPercent: POST_SWEEP_STOP_PERCENT,
  });
}

/* Kill switch and heartbeat around the handler above (lib/ops/cronRoute). */
export const GET = cronRoute("sync-instagram-posts", cronHandler);
