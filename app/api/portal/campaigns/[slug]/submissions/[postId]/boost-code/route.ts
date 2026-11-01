import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { isCampaignIdKey, resolvePortalAccess } from "@/lib/portal/campaignAccess";
import { annotatePost, cleanBoostCode, cleanExpiry } from "@/lib/posts/annotations";
import { boostCodesAllowed } from "@/lib/campaigns/rules";

const CAMPAIGN_SELECT = {
  id: true,
  orgId: true,
  deletedAt: true,
  marketplaceVisibility: true,
} as const;

/**
 * PUT /api/portal/campaigns/<slug-or-id>/submissions/<postId>/boost-code
 * { boostCode, boostCodeExpiresAt } -- a creator adds, changes or (with an
 * empty code) clears the ad-authorization code on one of their own live
 * submissions. Codes usually arrive after the post: TikTok issues a Spark Ads
 * code only once the video is up. Only while the agency has boost codes
 * switched on for the campaign (CampaignRules.allowBoostCodes).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; postId: string }> }
) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { slug, postId } = await params;
    const body = await request.json().catch(() => ({}));
    const boost = cleanBoostCode(body?.boostCode);
    const expiry = cleanExpiry(body?.boostCodeExpiresAt);
    if (boost.error || expiry.error) {
      return NextResponse.json({ error: boost.error ?? expiry.error }, { status: 400 });
    }

    const campaign =
      (await db.campaign.findUnique({ where: { publicSlug: slug }, select: CAMPAIGN_SELECT })) ??
      (isCampaignIdKey(slug)
        ? await db.campaign.findUnique({ where: { id: slug }, select: CAMPAIGN_SELECT })
        : null);
    if (!campaign || campaign.deletedAt) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    const access = await resolvePortalAccess(session, campaign);
    if (!access.visible || !access.activation) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    /* Only the creator's own, still-live submission on this campaign. */
    const post = await db.post.findFirst({
      where: { id: postId, campaignId: campaign.id, activationId: access.activation.id, ...NOT_REMOVED },
      select: { id: true },
    });
    if (!post) return NextResponse.json({ error: "Submission not found" }, { status: 404 });

    if (!(await boostCodesAllowed(campaign.id, campaign.orgId))) {
      return NextResponse.json({ error: "This campaign doesn't take boost codes.", code: "boost_codes_off" }, { status: 403 });
    }

    const saved = await annotatePost(post.id, campaign.orgId, {
      boostCode: boost.code,
      boostCodeExpiresAt: boost.code ? expiry.at : null,
    });
    if (!saved) {
      return NextResponse.json({ error: "Boost codes aren't available yet" }, { status: 503 });
    }
    return NextResponse.json({
      boostCode: boost.code,
      boostCodeExpiresAt: boost.code && expiry.at ? expiry.at.toISOString() : null,
    });
  } catch (error) {
    console.error("Failed to save boost code:", error);
    return NextResponse.json({ error: "Failed to save boost code" }, { status: 500 });
  }
}
