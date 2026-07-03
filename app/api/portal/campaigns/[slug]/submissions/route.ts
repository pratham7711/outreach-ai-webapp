import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { detectPlatform, fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";
import { parseRatePerThousand } from "@/lib/marketplace/earnings";
import { z } from "zod";

const submitSchema = z.object({
  postUrl: z.string().url(),
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
        deletedAt: true,
        ratePerThousand: true,
        submissionDeadline: true,
        marketplaceVisibility: true,
      },
    });
    if (!campaign || campaign.deletedAt) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // Deadline gate
    if (campaign.submissionDeadline && campaign.submissionDeadline.getTime() < Date.now()) {
      return NextResponse.json({ error: "The submission deadline has passed" }, { status: 409 });
    }

    // Campaign must have a rate for the detected platform
    const rates = parseRatePerThousand(campaign.ratePerThousand);
    if (!rates[detected.platform]) {
      return NextResponse.json(
        { error: `This campaign does not accept ${detected.platform} submissions` },
        { status: 400 }
      );
    }

    // Must be joined — resolve creator + activation (never trust client orgId)
    const creator = await db.creator.findFirst({
      where: { orgId: campaign.orgId, handle: session.handle, deletedAt: null },
      select: { id: true },
    });
    const activation = creator
      ? await db.activation.findFirst({
          where: { campaignId: campaign.id, creatorId: creator.id, deletedAt: null },
          select: { id: true },
        })
      : null;
    if (!creator || !activation) {
      return NextResponse.json({ error: "You must join this campaign before submitting" }, { status: 403 });
    }

    // Idempotency: same post URL / platform post id not submitted twice to this campaign
    const duplicate = await db.post.findFirst({
      where: {
        campaignId: campaign.id,
        creatorId: creator.id,
        platformPostId: detected.id,
        platform: detected.platform,
      },
      select: { id: true },
    });
    if (duplicate) {
      return NextResponse.json({ error: "You already submitted this post to this campaign" }, { status: 409 });
    }

    // Best-effort metrics fetch (thumbnail / caption / views). Never blocks submission.
    let metrics = null;
    try {
      metrics = await fetchPostMetrics(postUrl);
    } catch {
      metrics = null;
    }

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
        viewsCount: metrics?.viewsCount ?? 0,
        likesCount: metrics?.likesCount ?? 0,
        commentsCount: metrics?.commentsCount ?? 0,
        sharesCount: metrics?.sharesCount ?? 0,
        engagementRate: metrics?.engagementRate ?? 0,
        postedAt: metrics?.postedAt ?? new Date(),
        status: "PENDING_REVIEW",
        lastSyncedAt: metrics ? new Date() : null,
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
