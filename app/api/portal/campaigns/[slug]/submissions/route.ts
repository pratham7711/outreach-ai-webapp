import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { detectPlatform, fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";
import { countsFrom, measuredForNewPost } from "@/lib/sync/syncPost";
import { getInstagramAccountForCreator } from "@/lib/platforms/instagramToken";
import { getTikTokTokenForCreator } from "@/lib/platforms/tiktokToken";
import { parseRatePerThousand, type PlatformKey } from "@/lib/marketplace/earnings";
import { computeCampaignAccrual } from "@/lib/marketplace/cap";
import { isPortalCampaignActionable } from "@/lib/marketplace/portalVisibility";
import { isCampaignIdKey, resolvePortalAccess } from "@/lib/portal/campaignAccess";
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
        { error: "Unrecognized URL. Provide a public TikTok, Instagram, YouTube or Facebook Page post link." },
        { status: 400 }
      );
    }

    const CAMPAIGN_SELECT = {
      id: true,
      orgId: true,
      status: true,
      deletedAt: true,
      ratePerThousand: true,
      submissionDeadline: true,
      marketplaceVisibility: true,
      marketplaceBudgetCapMinor: true,
    } as const;
    /* A slug for a marketplace campaign, an id for an agency's private one,
       which has no slug (lib/portal/campaignAccess.ts). */
    const campaign =
      (await db.campaign.findUnique({ where: { publicSlug: slug }, select: CAMPAIGN_SELECT })) ??
      (isCampaignIdKey(slug)
        ? await db.campaign.findUnique({ where: { id: slug }, select: CAMPAIGN_SELECT })
        : null);
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
    /* The activation is found the way the detail route finds it
       (lib/portal/campaignAccess.ts): on a PRIVATE campaign only a roster row
       linked to this login counts, and the @-insensitive handle match is for
       marketplace campaigns (F10). */
    const access = await resolvePortalAccess(session, campaign);
    const activation = access.activation;
    const creator = access.creatorId ? { id: access.creatorId } : null;

    if (!access.visible) {
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

    /* A marketplace campaign must have a rate for the detected platform: it
       pays per view, and a platform nobody priced is one it does not accept.
       An agency's PRIVATE campaign is not paid per view at all -- its creators
       are on a fee the agency agreed with them -- and almost none carry a
       ratePerThousand, so the same check would refuse every post its invited
       creators submit. There the agency reviews each post instead (status
       PENDING_REVIEW below). */
    const rates = parseRatePerThousand(campaign.ratePerThousand);
    /* detected.platform includes TWITCH, which is not a PlatformKey: the
         lookup yields undefined and the 400 below is the correct answer. */
    if (campaign.marketplaceVisibility !== "PRIVATE" && !rates[detected.platform as PlatformKey]) {
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
        platform: detected.platform,
        /* A Facebook post is stored under its Graph id, not the link's, so the
           same link pasted again is recognised by the link itself. */
        ...(detected.platform === "FACEBOOK"
          ? { OR: [{ platformPostId: detected.id }, { postUrl }] }
          : { platformPostId: detected.id }),
      },
      select: { id: true, creatorId: true, removedAt: true },
    });
    /* A copy the brand removed from the campaign still counts as the claim
       (lib/posts/removed): resubmitting it must not slip a second row past the
       brand's decision. It is not shown to the creator any more, so the
       refusal says why rather than "you already submitted this". */
    if (duplicate) {
      return NextResponse.json(
        {
          error: duplicate.removedAt
            ? "This post was removed from this campaign by the brand, so it can't be submitted again"
            : duplicate.creatorId === creator.id
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
          ? await getInstagramAccountForCreator(creator.id, campaign.orgId, postUrl)
          : undefined;
      const tiktokToken =
        detected.platform === "TIKTOK"
          ? await getTikTokTokenForCreator(creator.id, campaign.orgId)
          : undefined;
      metrics = await fetchPostMetrics(postUrl, {
        instagramToken: instagram?.token,
        instagramHandle: instagram?.handle,
        instagramOrgId: campaign.orgId,
        tiktokToken,
        /* The creator's own Pages only: a creator submits their own post. */
        ...(detected.platform === "FACEBOOK"
          ? { facebook: { orgId: campaign.orgId, creatorId: creator.id } }
          : {}),
      });
    } catch {
      metrics = null;
    }

    /* Through the shared validation gate (plan A3); see measuredForNewPost. */
    const accepted = measuredForNewPost(metrics, detected.platform, { writer: "portal-submission", orgId: campaign.orgId });
    const measured = accepted ? countsFrom(accepted) : { counts: {}, present: [], measuredPatch: {} };

    const post = await db.post.create({
      data: {
        campaignId: campaign.id,
        creatorId: creator.id,
        activationId: activation.id,
        platform: detected.platform,
        /* Facebook's Graph id, once the post was found on the creator's Page:
           the comments edge and every later read need it, and a pasted pfbid or
           share code is not one. Every other platform keeps the link's own id. */
        platformPostId:
          detected.platform === "FACEBOOK" ? metrics?.platformPostId ?? detected.id : detected.id,
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
        /* From the accepted reading only. It used to come from any reading,
           so a refused one -- more likes than views -- still left its rate on
           a post that carried none of its counts. */
        ...(accepted?.engagementRate !== undefined
          ? { engagementRate: accepted.engagementRate }
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
