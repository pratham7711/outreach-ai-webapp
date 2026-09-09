import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { syncPost } from "@/lib/sync/syncPost";
import { openTikTokPostFetcherForOne } from "@/lib/platforms/tiktokEgress";

// POST /api/campaigns/[id]/posts/[postId]/sync — Trigger manual sync for a post
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId, postId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const post = await db.post.findFirst({ where: { id: postId, campaignId } });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    /* TikTok needs a sandbox egress, exactly as the campaign-wide refresh does.
     *
     * This route called syncPost with no fetcher, so a TikTok post was read
     * from the function egress in sin1 -- which TikTok's WAF answers with a
     * ~1.4KB Slardar login shell roughly three times in four. So "Sync Now"
     * reported metricsFound:false on a live post with 23,000 views while the
     * Refresh Data button on the same page returned real numbers for it, and
     * the difference was invisible from the outside: same fetch code, same
     * post, different egress. Measured on prod 2026-09-02.
     *
     * openTikTokPostFetcherForOne is a one-identity pool and exists for
     * precisely this caller -- a single post that would rather not pay to boot
     * several. It picks the best egress available: a residential proxy when one
     * is configured (no boot latency at all, so the click returns seconds
     * sooner), and the same one-lane sandbox as before when none is. Only for
     * TIKTOK: YouTube and Instagram answer their APIs from anywhere, and
     * booting an egress for them would add seconds to every click for nothing.
     */
    const tiktokSandbox = post.platform === "TIKTOK" ? openTikTokPostFetcherForOne() : undefined;

    let outcome;
    try {
      outcome = await syncPost(post, orgId, { tiktokSandbox });
    } finally {
      // Sandboxes bill by lifetime, so a lane left open costs money for
      // nothing. Closed even if the sync threw.
      await tiktokSandbox?.close().catch(() => {});
    }

    if (outcome.status === "unfetchable") {
      return NextResponse.json({ error: "Could not fetch metrics for this post URL" }, { status: 422 });
    }
    // The post stays the response body, because the detail page renders it
    // straight back. metricsFound rides alongside so the caller can say "the
    // platform gave us nothing" instead of showing an unchanged card and
    // leaving the person to guess whether the click did anything.
    return NextResponse.json({
      ...outcome.post,
      metricsFound: outcome.status === "measured",
      /* The reason, not just the negative. "metricsFound: false" is what let a
         TikTok post fail this route for four weeks while the Refresh button
         succeeded on the same post -- there was nothing in the answer to
         distinguish "the platform walled our egress" from "this post has no
         counters", and those need opposite responses. */
      ...(outcome.status === "no-metrics" ? { reason: outcome.reason } : {}),
    });
  } catch (error) {
    console.error("Failed to sync post:", error);
    return NextResponse.json({ error: "Failed to sync post" }, { status: 500 });
  }
}
