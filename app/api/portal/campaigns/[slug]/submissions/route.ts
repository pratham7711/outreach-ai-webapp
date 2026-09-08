import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { detectPlatform, fetchPostMetrics, hasMetricCounts } from "@/lib/platforms/fetchPostMetrics";
import { countsFrom } from "@/lib/sync/syncPost";
import { getInstagramAccountForCreator } from "@/lib/platforms/instagramToken";
import { getTikTokTokenForCreator } from "@/lib/platforms/tiktokToken";
import { parseRatePerThousand } from "@/lib/marketplace/earnings";
import { computeCampaignAccrual } from "@/lib/marketplace/cap";
import { isPortalCampaignVisible, isPortalCampaignActionable } from "@/lib/marketplace/portalVisibility";
import { findCreatorInOrgForHandle } from "@/lib/portal/creatorLookup";
import { httpUrl } from "@/lib/validation/url";
import { z } from "zod";

const submitSchema = z.object({
  postUrl: httpUrl(),
});

// POST /api/portal/campaigns/[slug]/submissions — submit a post to a joined campaign
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { slug } = await params;
    const body = await request.json();
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }
    const { postUrl } = parsed.data;

    // URL → platform detection (reuses lib/platforms)
    const detected = detectPlatform(postUrl);
    if (!detected) {
      return NextResponse.json(
        { error: "Unrecognized URL. Provide a public TikTok, Instagram, or YouTube post link." },
        { status: 400 }
      );
    }

    const campaign = await db.campaign.findUnique({
      where: { publicSlug: slug },
      select: {
        id: true,
        orgId: true,
        status: true,
        deletedAt: true,
        ratePerThousand: true,
        submissionDeadline: true,
        marketplaceVisibility: true,
        marketplaceBudgetCapMinor: true,
      },
    });
    if (!campaign || campaign.deletedAt) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    /* Resolved BEFORE the deadline, budget-cap and rate checks below, because
       those checks answer with the campaign's own state. marketplaceVisibility
       was selected here and never read, so a stranger holding a stale slug for a
       PRIVATE campaign was told "the submission deadline has passed", "this
       campaign has reached its budget cap" or "this campaign does not accept
       TikTok submissions" — a running status report on a campaign the detail
       route two paths up already 404s them out of. The write was never at risk:
       the 403 below has always required an activation. The disclosure was. */
    /* findCreatorInOrgForHandle, not an exact `handle: session.handle`: a roster
       stores handles with or without the leading @, and join (lib/marketplace/join.ts)
       resolves the same row case/@-insensitively. Exact equality here 403'd
       "You must join this campaign" at a creator who had just joined successfully. */
    const creator = await findCreatorInOrgForHandle(campaign.orgId, session.handle);
    const activation = creator
      ? await db.activation.findFirst({
          where: { campaignId: campaign.id, creatorId: creator.id, deletedAt: null },
          select: { id: true },
        })
      : null;

    if (!isPortalCampaignVisible({
      marketplaceVisibility: campaign.marketplaceVisibility,
      hasActivation: !!activation,
    })) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    /* Status gate, after the visibility gate so a stranger learns nothing.
       `status` was not even selected here, so a COMPLETE or CANCELLED campaign
       went on accepting posts against a closed budget. */
    if (!isPortalCampaignActionable(campaign.status)) {
      return NextResponse.json(
        { error: `This campaign is not accepting submissions (status: ${campaign.status})` },
        { status: 409 }
      );
    }

    // Deadline gate
    if (campaign.submissionDeadline && campaign.submissionDeadline.getTime() < Date.now()) {
      return NextResponse.json({ error: "The submission deadline has passed" }, { status: 409 });
    }

    // Budget-cap hard stop — no new submissions once the campaign's marketplace
    // budget cap has been reached (accrued from APPROVED posts).
    const { capReached } = await computeCampaignAccrual(campaign.id, {
      ratePerThousand: campaign.ratePerThousand,
      marketplaceBudgetCapMinor: campaign.marketplaceBudgetCapMinor,
    });
    if (capReached) {
      return NextResponse.json(
        { error: "This campaign has reached its budget cap and is no longer accepting submissions" },
        { status: 409 }
      );
    }

    // Campaign must have a rate for the detected platform
    const rates = parseRatePerThousand(campaign.ratePerThousand);
    if (!rates[detected.platform]) {
      return NextResponse.json(
        { error: `This campaign does not accept ${detected.platform} submissions` },
        { status: 400 }
      );
    }

    // Must be joined. Resolved above, with the visibility gate; the 403 stays
    // here so a GLOBAL campaign still reports its deadline and cap first.
    if (!creator || !activation) {
      return NextResponse.json({ error: "You must join this campaign before submitting" }, { status: 403 });
    }

    /* One post, one claim: the lookup is scoped to the CAMPAIGN, not to the
       creator. Scoped to creatorId (as it was) a post already submitted and
       approved for creator A could be re-submitted verbatim by creator B, who
       then accrues the same views a second time against the same budget — the
       URL is public, so nothing stops a second creator pasting it.

       RACE: there is no unique index on (campaignId, platform, platformPostId)
       — prisma/schema.prisma is frozen for this change — so two simultaneous
       submissions of the same URL can both pass this read and both insert. The
       window is small and the duplicate is visible to the reviewer; the index
       is the durable fix and ships with the next schema migration. */
    const duplicate = await db.post.findFirst({
      where: {
        campaignId: campaign.id,
        platformPostId: detected.id,
        platform: detected.platform,
      },
      select: { id: true, creatorId: true },
    });
    if (duplicate) {
      return NextResponse.json(
        {
          error:
            duplicate.creatorId === creator.id
              ? "You already submitted this post to this campaign"
              : "This post has already been submitted to this campaign",
        },
        { status: 409 }
      );
    }

    // Best-effort metrics fetch (thumbnail / caption / views). Never blocks submission.
    let metrics = null;
    try {
      const instagram =
        detected.platform === "INSTAGRAM"
          ? await getInstagramAccountForCreator(creator.id, campaign.orgId)
          : undefined;
      const tiktokToken =
        detected.platform === "TIKTOK"
          ? await getTikTokTokenForCreator(creator.id, campaign.orgId)
          : undefined;
      metrics = await fetchPostMetrics(postUrl, {
        instagramToken: instagram?.token,
        instagramHandle: instagram?.handle,
        tiktokToken,
      });
    } catch {
      metrics = null;
    }

    const measured =
      metrics && hasMetricCounts(metrics)
        ? countsFrom(metrics)
        : { counts: {}, present: [], measuredPatch: {} };

    const post = await db.post.create({
      data: {
        campaignId: campaign.id,
        creatorId: creator.id,
        activationId: activation.id,
        platform: detected.platform,
        platformPostId: detected.id,
        postUrl,
        thumbnailUrl: metrics?.thumbnailUrl ?? null,
        caption: metrics?.caption ?? null,
        /* Only the counters the platform actually reported, and lastSyncedAt
           only if at least one arrived.
           
           This used to coerce all five with `?? 0` and stamp lastSyncedAt
           whenever `metrics` was merely non-null -- and a fetch that reaches a
           post but reads no counters off it returns a non-null object. So a
           creator submitting a link while TikTok was walling us created a post
           recording five measured zeros, which is indistinguishable downstream
           from a post that genuinely got no engagement. The counters are
           non-nullable Floats defaulting to 0, so omitting them leaves the
           column at 0 with lastSyncedAt null -- the shape lib/metricDisplay
           reads as "not measured yet". */
        ...measured.counts,
        ...(metrics?.engagementRate !== undefined
          ? { engagementRate: metrics.engagementRate }
          : {}),
        postedAt: metrics?.postedAt ?? new Date(),
        status: "PENDING_REVIEW",
        lastSyncedAt: measured.present.length > 0 ? new Date() : null,
        ...(measured.present.length > 0 ? { platformMetrics: measured.measuredPatch } : {}),
      },
      select: {
        id: true,
        postUrl: true,
        platform: true,
        status: true,
        viewsCount: true,
        thumbnailUrl: true,
        caption: true,
        createdAt: true,
      },
    });

    return NextResponse.json(post, { status: 201 });
  } catch (error) {
    console.error("Failed to submit post:", error);
    return NextResponse.json({ error: "Failed to submit post" }, { status: 500 });
  }
}
