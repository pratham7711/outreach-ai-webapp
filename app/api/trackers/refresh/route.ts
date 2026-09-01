import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/authenticate";
import { rateLimit } from "@/lib/rateLimit";
import { snapshotSounds } from "@/lib/sounds/snapshot";
import { createLogger } from "@/lib/observability/logger";

// The nightly cron at /api/cron/snapshot-sounds does the same work for every org.
// This is the same job scoped to the caller's org so the Refresh button on
// /trackers does not have to wait for 04:00 UTC.
//
// With a `soundId` it refreshes exactly one tracker, which is what the detail
// modal's Refresh Data button calls. The reference offers refresh only per
// tracker; we keep the whole-org sweep as well, because re-reading 93 sounds one
// modal at a time is not a workflow anyone wants.

const BodySchema = z.object({ soundId: z.string().min(1).optional() });

/* Two budgets, because the two shapes of this request cost different amounts.
   A sweep is one outbound TikTok request per tracked sound, so it stays rare.
   A single read is one request, so it can be far more frequent -- but not
   unbounded, or a held-down button in the modal becomes a scraper. The per-sound
   budget stops that one sound being hammered; the org budget stops someone
   walking the list and refreshing all 93 in a loop. */
const SWEEP = { limit: 6, windowMs: 10 * 60 * 1000 };
const ONE_SOUND = { limit: 4, windowMs: 10 * 60 * 1000 };
const ONE_SOUND_ORG = { limit: 40, windowMs: 10 * 60 * 1000 };

function tooSoon(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Refreshed too recently. Try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export async function POST(req: NextRequest) {
  const log = createLogger({ context: { route: "trackers/refresh" } });

  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  // An empty body is the sweep, and is how every existing caller posts.
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { soundId } = parsed.data;

  if (soundId) {
    const perSound = rateLimit({ key: `trackers-refresh:${orgId}:${soundId}`, ...ONE_SOUND });
    if (!perSound.allowed) return tooSoon(perSound.retryAfterSeconds);
    const perOrg = rateLimit({ key: `trackers-refresh-one:${orgId}`, ...ONE_SOUND_ORG });
    if (!perOrg.allowed) return tooSoon(perOrg.retryAfterSeconds);
  } else {
    const sweep = rateLimit({ key: `trackers-refresh:${orgId}`, ...SWEEP });
    if (!sweep.allowed) return tooSoon(sweep.retryAfterSeconds);
  }

  try {
    /* snapshotSounds already keeps orgId in the filter alongside soundId, so an
       id belonging to another org selects nothing rather than reading it. */
    const counts = await snapshotSounds({
      orgId,
      ...(soundId ? { soundId } : {}),
      deadlineMs: soundId ? 20 * 1000 : 45 * 1000,
    });

    /* A single refresh that matched no row is a 404, not a success reporting
       zero -- otherwise deleting a tracker in another tab looks like a no-op. */
    if (soundId && counts.snapshots + counts.failed + counts.skipped === 0) {
      return NextResponse.json({ error: "Tracker not found" }, { status: 404 });
    }
    return NextResponse.json(counts);
  } catch (error) {
    log.error("tracker refresh failed", {
      orgId,
      soundId: soundId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  }
}
