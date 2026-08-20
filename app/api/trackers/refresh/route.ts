import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/authenticate";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { snapshotSounds } from "@/lib/sounds/snapshot";
import { createLogger } from "@/lib/observability/logger";

// The nightly cron at /api/cron/snapshot-sounds does the same work for every org.
// This is the same job scoped to the caller's org so the Refresh button on
// /trackers does not have to wait for 04:00 UTC.
export async function POST(req: NextRequest) {
  const log = createLogger({ context: { route: "trackers/refresh" } });

  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  // Each sound costs one outbound TikTok request, so a held-down button would
  // hammer both us and them.
  const rl = rateLimit({
    key: `trackers-refresh:${orgId}`,
    limit: 6,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Refreshed too recently. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  try {
    // Well inside the platform function timeout, leaving room to return a body.
    const counts = await snapshotSounds({ orgId, deadlineMs: 45 * 1000 });
    return NextResponse.json(counts);
  } catch (error) {
    log.error("tracker refresh failed", {
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  }
}
