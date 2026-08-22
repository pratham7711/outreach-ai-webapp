import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { syncPost } from "@/lib/sync/syncPost";
import { snapshotSounds } from "@/lib/sounds/snapshot";
import { createLogger } from "@/lib/observability/logger";

/**
 * POST /api/campaigns/[id]/refresh — refresh everything the campaign reports on.
 *
 * One click, one request: every post on the campaign is re-fetched from its
 * platform, and the campaign's tracked sound is snapshotted in the same run, so
 * the audio card and the post cards can never disagree about how fresh they are.
 * The per-post route still exists for refreshing a single card.
 *
 * It reports what actually happened rather than a bare 200. A campaign of
 * TikTok posts refreshed from a network that cannot reach TikTok updates nothing
 * -- that is a sentence the UI needs to be able to say, and it can only say it
 * if this route counts the posts that came back empty.
 */

/** Well inside the function timeout, with room left to write a response. */
const DEADLINE_MS = 45 * 1000;

/**
 * How many posts are in flight at once.
 *
 * Sequential does not fit: an unreachable platform costs the full 8s fetch
 * timeout per post, so a 17-post campaign spent 130s of waiting and the deadline
 * cut it off a third of the way through -- "refresh all posts" that refreshed
 * five. These are idle waits, so overlapping them costs nothing but the burst.
 * Four, not seventeen, because a platform answers a wide burst with a challenge
 * page rather than data.
 */
const CONCURRENCY = 4;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const log = createLogger({ context: { route: "campaigns/[id]/refresh" } });
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId } = await params;

    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null },
      select: { id: true, song: { select: { soundId: true } } },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    // Every post is an outbound platform request, so a held-down button would
    // hammer both us and them. Matches the /trackers Refresh allowance.
    const rl = rateLimit({ key: `campaign-refresh:${campaignId}`, limit: 6, windowMs: 10 * 60 * 1000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Refreshed too recently. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const posts = await db.post.findMany({
      where: { campaignId },
      // platformMetrics comes along because applyPostMetrics merges the measured-field
      // record into it rather than replacing the importer's raw record.
      select: { id: true, platform: true, creatorId: true, postUrl: true, thumbnailUrl: true, caption: true, platformMetrics: true },
      // Oldest sync first, so a campaign too big for one run still makes
      // progress on the stalest posts each time.
      orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
    });

    const deadline = Date.now() + DEADLINE_MS;
    let measured = 0;
    let noMetrics = 0;
    let unfetchable = 0;
    let failed = 0;

    let next = 0;
    const worker = async () => {
      while (next < posts.length) {
        if (Date.now() > deadline) return;
        const post = posts[next++];
        try {
          const outcome = await syncPost(post, orgId);
          if (outcome.status === "measured") measured++;
          else if (outcome.status === "no-metrics") noMetrics++;
          else unfetchable++;
        } catch (error) {
          // One bad post does not abandon the rest of the campaign.
          failed++;
          log.error("post refresh failed", {
            campaignId,
            postId: post.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, posts.length) }, () => worker()),
    );

    // Counted from what finished rather than from the cursor, so a post claimed
    // as the deadline passed is reported as left over, not as done.
    const remaining = posts.length - (measured + noMetrics + unfetchable + failed);
    if (remaining > 0) log.warn("time budget reached; stopping early", { campaignId, remaining });

    // The campaign's audio is part of "the campaign's data", and it comes from
    // the same blocked-or-not TikTok as the posts, so it belongs in this run.
    const soundId = campaign.song?.soundId ?? null;
    const sound = soundId
      ? await snapshotSounds({ orgId, soundId, deadlineMs: 15 * 1000 })
      : null;

    return NextResponse.json({
      total: posts.length,
      measured,
      noMetrics,
      unfetchable,
      failed,
      remaining,
      sound,
    });
  } catch (error) {
    log.error("campaign refresh failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  }
}
