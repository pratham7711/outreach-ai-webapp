import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { parseRatePerThousand, earnedMinorForPost } from "@/lib/marketplace/earnings";
import { PUBLIC_VISIBILITY } from "@/lib/marketplace/public";

// GET /api/portal/campaigns/[slug] — detail for a joined marketplace campaign
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { slug } = await params;

    const campaign = await db.campaign.findUnique({
      where: { publicSlug: slug },
      select: {
        id: true,
        orgId: true,
        title: true,
        status: true,
        publicSlug: true,
        currency: true,
        guidelines: true,
        requirements: true,
        contentAssetsUrl: true,
        ratePerThousand: true,
        minPayoutMinor: true,
        submissionDeadline: true,
        marketplaceVisibility: true,
        deletedAt: true,
        org: { select: { name: true, logoUrl: true } },
      },
    });

    if (!campaign || campaign.deletedAt || !campaign.publicSlug) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // Resolve the creator link (handle match within campaign org) — must be joined.
    const creator = await db.creator.findFirst({
      where: { orgId: campaign.orgId, handle: session.handle, deletedAt: null },
      select: { id: true },
    });
    const activation = creator
      ? await db.activation.findFirst({
          where: { campaignId: campaign.id, creatorId: creator.id, deletedAt: null },
          select: {
            id: true,
            status: true,
            draftUrl: true,
            draftCaption: true,
            draftMediaType: true,
            draftSubmittedAt: true,
            feedbackNotes: true,
          },
        })
      : null;

    /* marketplaceVisibility was selected and never read, so a campaign pulled
       back to PRIVATE (or one that was only ever INVITE_ONLY) kept serving its
       guidelines, per-platform rates, deadline and internal id to any logged-in
       portal creator who had the slug — the reverse of the filter every other
       public surface applies (lib/marketplace/public.ts, and the join gate in
       lib/marketplace/join.ts).

       Mirrored here, with the one difference the route's own purpose demands:
       this is the detail page for a campaign the creator has JOINED, and a join
       is legitimately possible on an INVITE_ONLY campaign with a code. Gating on
       GLOBAL alone would 404 those creators out of work they are already doing —
       so an existing activation is the second way through, and only that. A
       stranger with a stale slug has neither. */
    if (campaign.marketplaceVisibility !== PUBLIC_VISIBILITY && !activation) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const rates = parseRatePerThousand(campaign.ratePerThousand);

    let submissions: {
      id: string;
      postUrl: string;
      platform: string;
      status: string;
      viewsCount: number;
      thumbnailUrl: string | null;
      caption: string | null;
      rejectionReason: string | null;
      createdAt: Date;
      earnedMinor: number;
    }[] = [];

    if (activation) {
      const posts = await db.post.findMany({
        where: { activationId: activation.id },
        select: {
          id: true,
          postUrl: true,
          platform: true,
          status: true,
          viewsCount: true,
          thumbnailUrl: true,
          caption: true,
          rejectionReason: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
      submissions = posts.map((p) => ({
        ...p,
        earnedMinor:
          p.status === "APPROVED" ? earnedMinorForPost(p.viewsCount, p.platform, rates) : 0,
      }));
    }

    const deadlinePassed =
      !!campaign.submissionDeadline && campaign.submissionDeadline.getTime() < Date.now();

    return NextResponse.json({
      campaign: {
        id: campaign.id,
        title: campaign.title,
        slug: campaign.publicSlug,
        status: campaign.status,
        currency: campaign.currency,
        guidelines: campaign.guidelines,
        requirements: campaign.requirements,
        contentAssetsUrl: campaign.contentAssetsUrl,
        rates,
        minPayoutMinor: campaign.minPayoutMinor,
        submissionDeadline: campaign.submissionDeadline,
        deadlinePassed,
        orgName: campaign.org.name,
        orgLogoUrl: campaign.org.logoUrl,
      },
      joined: !!activation,
      draft: activation
        ? {
            status: activation.status,
            draftUrl: activation.draftUrl,
            draftCaption: activation.draftCaption,
            draftMediaType: activation.draftMediaType,
            draftSubmittedAt: activation.draftSubmittedAt,
            feedbackNotes: activation.feedbackNotes,
          }
        : null,
      submissions,
    });
  } catch (error) {
    console.error("Failed to fetch campaign detail:", error);
    return NextResponse.json({ error: "Failed to fetch campaign" }, { status: 500 });
  }
}
