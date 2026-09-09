import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";
import { applyPostMetrics } from "@/lib/sync/syncPost";
import { getInstagramAccountForCreator } from "@/lib/platforms/instagramToken";
import { getTikTokTokenForCreator } from "@/lib/platforms/tiktokToken";
import {
  POST_TTL_MAX_DAYS,
  POST_TTL_MIN_DAYS,
  clampTtlDays,
  postTrackingExpiry,
} from "@/lib/sync/postTracking";
import { parsePostTracking } from "@/lib/trackers/granularity";
import { z } from "zod";

/**
 * Turning post tracking on always sets an expiry.
 *
 * `ttlDays` is optional in the payload and not optional in the outcome: an
 * omitted one falls back to the org's configured default, never to "forever".
 * That is the trade the product makes -- an org may run as many post trackers as
 * it likes precisely because every one of them stops on its own.
 *
 * The bounds are enforced here as well as clamped, so a caller that asks for 90
 * days is told no rather than silently given 30 and left thinking it worked.
 */
const trackSchema = z.object({
  enabled: z.boolean(),
  ttlDays: z.number().int().min(POST_TTL_MIN_DAYS).max(POST_TTL_MAX_DAYS).optional(),
});

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

    const { enabled, ttlDays } = parsed.data;
    const now = new Date();

    /* The org's default is read even when the caller named a TTL, because
       clampTtlDays needs a fallback that is the org's rather than the module's
       if the number turns out not to be one. */
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { uiConfig: true },
    });
    const defaults = parsePostTracking(org?.uiConfig ?? null);
    const ttl = clampTtlDays(ttlDays ?? defaults.defaultTtlDays, defaults.defaultTtlDays);

    const updated = await db.post.update({
      where: { id: postId },
      data: enabled
        ? {
            trackingEnabled: true,
            trackingStartedAt: now,
            trackingTtlDays: ttl,
            /* Re-enabling restarts the window rather than resuming the old one.
               A tracker turned back on is a new instruction, and inheriting a
               stale expiry would let it end before its first read. */
            trackingExpiresAt: postTrackingExpiry(now, ttl),
          }
        : {
            trackingEnabled: false,
            trackingStartedAt: null,
            trackingTtlDays: null,
            trackingExpiresAt: null,
          },
      select: {
        id: true,
        trackingEnabled: true,
        trackingStartedAt: true,
        trackingTtlDays: true,
        trackingExpiresAt: true,
      },
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
      trackingTtlDays: updated.trackingTtlDays,
      trackingExpiresAt: updated.trackingExpiresAt,
      readCadence: defaults.readCadence,
    });
  } catch (error) {
    console.error("Failed to toggle post tracking:", error);
    return NextResponse.json({ error: "Failed to toggle tracking" }, { status: 500 });
  }
}
