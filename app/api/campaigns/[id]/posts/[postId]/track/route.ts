import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";
import { applyPostMetrics } from "@/lib/sync/syncPost";
import { getInstagramAccountForCreator } from "@/lib/platforms/instagramToken";
import { getTikTokTokenForCreator } from "@/lib/platforms/tiktokToken";
import { z } from "zod";

const trackSchema = z.object({ enabled: z.boolean() });

type RouteParams = { params: Promise<{ id: string; postId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = authResult;
    const { id: campaignId, postId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const post = await db.post.findFirst({ where: { id: postId, campaignId } });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const parsed = trackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const { enabled } = parsed.data;
    const now = new Date();

    const updated = await db.post.update({
      where: { id: postId },
      data: enabled
        ? { trackingEnabled: true, trackingStartedAt: now }
        : { trackingEnabled: false, trackingStartedAt: null },
      select: { id: true, trackingEnabled: true, trackingStartedAt: true },
    });

    if (enabled) {
      try {
        const instagram =
          post.platform === "INSTAGRAM"
            ? await getInstagramAccountForCreator(post.creatorId, orgId)
            : undefined;
        const tiktokToken =
          post.platform === "TIKTOK"
            ? await getTikTokTokenForCreator(post.creatorId, orgId)
            : undefined;
        const metrics = await fetchPostMetrics(post.postUrl, {
          instagramToken: instagram?.token,
          instagramHandle: instagram?.handle,
          tiktokToken,
        });
        /* The shared writer rather than a third hand-rolled copy of it. The
           version here coerced every absent counter with `?? 0` and wrote all
           five columns unconditionally, so turning tracking on for an Instagram
           photo -- which reports likes and comments and has no play count --
           stamped a measured 0 views onto it. applyPostMetrics writes only the
           counters that actually arrived. */
        if (metrics) {
          await applyPostMetrics(post, metrics, { syncSource: "track-enable" });
        }
      } catch (err) {
        console.error(`Failed initial tracking fetch for post ${postId}:`, err);
      }
    }

    return NextResponse.json({
      trackingEnabled: updated.trackingEnabled,
      trackingStartedAt: updated.trackingStartedAt,
    });
  } catch (error) {
    console.error("Failed to toggle post tracking:", error);
    return NextResponse.json({ error: "Failed to toggle tracking" }, { status: 500 });
  }
}
