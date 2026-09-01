import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/authenticate";
import { rateLimit } from "@/lib/rateLimit";
import { snapshotCreators } from "@/lib/creators/snapshot";
import { createLogger } from "@/lib/observability/logger";

/* TikTok opens a browser, so this is sized like the sound reader's route rather
   than a normal request. Instagram and YouTube return in milliseconds. */
export const maxDuration = 120;
export const runtime = "nodejs";

/**
 * Read one tracked creator now, from the detail modal's Refresh Data button.
 *
 * Mirrors /api/trackers/refresh. The org-wide sweep is the cron's job here --
 * there is no whole-org button for creators, because the expensive platform is
 * the one 83% of our creators are on.
 */
const BodySchema = z.object({ creatorId: z.string().min(1) });

const PER_CREATOR = { limit: 4, windowMs: 10 * 60 * 1000 };
const PER_ORG = { limit: 40, windowMs: 10 * 60 * 1000 };

function tooSoon(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Refreshed too recently. Try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export async function POST(req: NextRequest) {
  const log = createLogger({ context: { route: "trackers/creators/refresh" } });

  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { creatorId } = parsed.data;

  const perCreator = rateLimit({ key: `creator-refresh:${orgId}:${creatorId}`, ...PER_CREATOR });
  if (!perCreator.allowed) return tooSoon(perCreator.retryAfterSeconds);
  const perOrg = rateLimit({ key: `creator-refresh:${orgId}`, ...PER_ORG });
  if (!perOrg.allowed) return tooSoon(perOrg.retryAfterSeconds);

  try {
    /* snapshotCreators keeps orgId in the filter alongside creatorId, so an id
       belonging to another org selects nothing rather than reading it. */
    const counts = await snapshotCreators({
      orgId,
      creatorId,
      deadlineMs: 90 * 1000,
    });

    /* Nothing matched at all means the creator is not ours or not tracked -- a
       404, not a success reporting zero. */
    if (counts.snapshots + counts.failed + counts.skipped === 0) {
      return NextResponse.json({ error: "Tracker not found" }, { status: 404 });
    }
    return NextResponse.json(counts);
  } catch (error) {
    log.error("creator refresh failed", {
      orgId,
      creatorId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  }
}
