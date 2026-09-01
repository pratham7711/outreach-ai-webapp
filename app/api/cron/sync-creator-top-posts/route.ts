import { NextRequest, NextResponse } from "next/server";
import { recordTopPosts, tikTokCreatorsNeedingTopPosts } from "@/lib/creators/topPosts";
import { readTopPostsInSandbox } from "@/lib/platforms/tiktokTopPostsSandbox";
import { createLogger } from "@/lib/observability/logger";
import { alertOps } from "@/lib/alerts";

/**
 * TikTok Top Posts, daily, through a Vercel Sandbox running real Chrome under
 * Xvfb — the only configuration measured to get the post grid (see
 * lib/platforms/tiktokTopPostsSandbox.ts for the four cases tested).
 *
 * Separate from the hourly creator sweep on purpose. That sweep reads follower
 * stats, which are cheap and want to be frequent; this one pays ~90s of
 * apt-get before it reads anything, and the app treats top posts under 20
 * hours old as fresh. Once a day, one sandbox, one Chrome.
 *
 * BATCH_LIMIT keeps a run inside maxDuration at any roster size: creators are
 * taken oldest-read-first, so a roster too large for one run cycles through
 * across days rather than starving its tail. When that starts costing coverage,
 * scripts/creator-worker/ is the same reader on a box with Chrome already
 * installed — no setup cost, no 300s ceiling.
 */

export const maxDuration = 300;
export const runtime = "nodejs";
/* Documented as ignored while vercel.json sets `regions` (verified via
   x-vercel-id) — the iad1 egress that matters here is the Sandbox's own,
   which tiktokTopPostsSandbox pins directly. */
export const preferredRegion = "iad1";
export const dynamic = "force-dynamic";

/** Setup ~90s + ~45s a handle, inside a 300s ceiling, with slack for the write. */
const BATCH_LIMIT = 3;

export async function GET(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/sync-creator-top-posts" } });

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const creators = await tikTokCreatorsNeedingTopPosts(BATCH_LIMIT);
  if (creators.length === 0) {
    log.info("no tracked TikTok creators; nothing to read");
    return NextResponse.json({ read: 0, recorded: 0 });
  }

  const byHandle = new Map(creators.map((c) => [c.handle.replace(/^@/, "").trim(), c]));
  const results = await readTopPostsInSandbox([...byHandle.keys()], { logger: log });

  const readings = results
    .filter((r) => r.posts.length > 0)
    .map((r) => ({ creatorId: byHandle.get(r.handle)!.id, posts: r.posts }))
    .filter((r) => r.creatorId);

  const recorded = await recordTopPosts(readings);

  /* Only a creator whose grid read within the last 30 days and has now stopped
     is worth waking someone for; a handle that never read is a row to look at.
     Same split the sound worker uses, and for the same reason: an alert that
     fires every run is the same as no alert. */
  const failures = results.filter((r) => r.posts.length === 0);
  const regressed = failures.filter((r) => byHandle.get(r.handle)?.readRecently);

  log.info("top-posts sweep finished", {
    attempted: results.length,
    read: readings.length,
    recorded: recorded.recorded,
    failed: failures.length,
    regressed: regressed.length,
    ms: Date.now() - started,
  });

  if (regressed.length > 0) {
    await alertOps({
      source: "creator-top-posts",
      title: `${regressed.length} creator grid(s) stopped reading`,
      facts: {
        regressed: regressed.map((r) => `@${r.handle}: ${r.error ?? "no posts"}`).join(" | "),
        attempted: results.length,
      },
      severity: "warn",
    });
  }

  return NextResponse.json({
    attempted: results.length,
    read: readings.length,
    ...recorded,
    failures: failures.map((r) => ({ handle: r.handle, error: r.error })),
    ms: Date.now() - started,
  });
}
