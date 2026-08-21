import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/authenticate";
import { rateLimit } from "@/lib/rateLimit";
import { detectPlatform, lookupTikTokPost } from "@/lib/platforms/fetchPostMetrics";

export const dynamic = "force-dynamic";

// GET /api/posts/inspect?url=<post url>
//
// Answers "is this post still up, and what are its numbers right now" without
// touching stored data. Deliberately separate from the sync path: nothing here
// writes, so it is safe to call on a URL that is not in the database yet.
export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  const detected = detectPlatform(url);
  if (!detected) {
    return NextResponse.json({ error: "Unrecognised post URL" }, { status: 400 });
  }

  // Every check costs one outbound request to the platform.
  const rl = rateLimit({ key: `posts-inspect:${orgId}`, limit: 30, windowMs: 60 * 1000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many checks. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const checkedAt = new Date().toISOString();

  // Only TikTok can currently distinguish "deleted" from "we could not tell".
  // Claiming otherwise for Instagram or YouTube would be inventing certainty,
  // so those report `unsupported` until each grows the same signal.
  if (detected.platform !== "TIKTOK") {
    return NextResponse.json({
      platform: detected.platform,
      platformPostId: detected.id,
      url,
      state: "unsupported",
      reason: `liveness checks are only implemented for TikTok`,
      stats: null,
      checkedAt,
    });
  }

  const lookup = await lookupTikTokPost(url);
  const m = lookup.metrics;

  return NextResponse.json({
    platform: detected.platform,
    platformPostId: detected.id,
    url,
    state: lookup.state,
    isLive: lookup.state === "live",
    isDeleted: lookup.state === "deleted",
    platformStatusCode: lookup.statusCode,
    reason: lookup.reason,
    checkedAt,
    stats: m
      ? {
          views: m.viewsCount,
          likes: m.likesCount,
          comments: m.commentsCount,
          shares: m.sharesCount,
          engagementRate:
            m.viewsCount > 0 ? ((m.likesCount + m.commentsCount) / m.viewsCount) * 100 : 0,
        }
      : null,
    caption: m?.caption ?? null,
    thumbnailUrl: m?.thumbnailUrl ?? null,
    postedAt: m?.postedAt ? m.postedAt.toISOString() : null,
  });
}
