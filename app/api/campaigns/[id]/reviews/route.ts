import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";

const createReviewSchema = z.object({
  creatorId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  tags: z.array(z.string()).optional(),
  comment: z.string().optional(),
});

// GET /api/campaigns/[id]/reviews
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const orgId = (session.user as any).orgId;
    const { id: campaignId } = await params;

    // Verify campaign belongs to org
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null },
    });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const { searchParams } = request.nextUrl;
    const creatorId = searchParams.get("creatorId");

    const where: Record<string, unknown> = { campaignId, orgId };
    if (creatorId) where.creatorId = creatorId;

    const reviews = await db.creatorReview.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    // Enrich with creator info
    const creatorIds = [...new Set(reviews.map((r) => r.creatorId))];
    const creators =
      creatorIds.length > 0
        ? await db.creator.findMany({
            where: { id: { in: creatorIds }, orgId },
            select: { id: true, name: true, handle: true, avatarUrl: true },
          })
        : [];

    const creatorMap = new Map(creators.map((c) => [c.id, c]));

    const enrichedReviews = reviews.map((r) => ({
      ...r,
      creator: creatorMap.get(r.creatorId) ?? null,
    }));

    return NextResponse.json({ reviews: enrichedReviews });
  } catch (error) {
    console.error("Failed to fetch reviews:", error);
    return NextResponse.json({ error: "Failed to fetch reviews" }, { status: 500 });
  }
}

// POST /api/campaigns/[id]/reviews
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const orgId = (session.user as any).orgId;
    const { id: campaignId } = await params;

    // Verify campaign belongs to org
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null },
    });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = createReviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { creatorId, rating, tags, comment } = parsed.data;

    // Check for duplicate review (same org + campaign + creator)
    const existing = await db.creatorReview.findFirst({
      where: { orgId, campaignId, creatorId },
    });
    if (existing) {
      return NextResponse.json(
        { error: "A review already exists for this creator on this campaign" },
        { status: 409 }
      );
    }

    // Create the review
    const review = await db.creatorReview.create({
      data: {
        orgId,
        campaignId,
        creatorId,
        rating,
        tags: tags ?? undefined,
        comment: comment ?? null,
      },
    });

    // Update CreatorUser averageRating + reviewCount if matched by handle
    try {
      const creator = await db.creator.findFirst({
        where: { id: creatorId, orgId },
        select: { handle: true },
      });

      if (creator?.handle) {
        const creatorUser = await db.creatorUser.findFirst({
          where: { handle: creator.handle },
        });

        if (creatorUser) {
          // Recalculate from all reviews for this creatorId
          const allReviews = await db.creatorReview.findMany({
            where: { creatorId },
            select: { rating: true },
          });

          const totalRating = allReviews.reduce((sum, r) => sum + r.rating, 0);
          const averageRating = allReviews.length > 0 ? totalRating / allReviews.length : 0;

          await db.creatorUser.update({
            where: { id: creatorUser.id },
            data: {
              averageRating: Math.round(averageRating * 100) / 100,
              reviewCount: allReviews.length,
            },
          });
        }
      }
    } catch (ratingError) {
      // Non-critical — log but don't fail the request
      console.error("Failed to update CreatorUser rating:", ratingError);
    }

    // Audit log
    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: "review.created",
      entityType: "CreatorReview",
      entityId: review.id,
      ipAddress: getRequestIp(request),
    });

    return NextResponse.json({ review }, { status: 201 });
  } catch (error) {
    console.error("Failed to create review:", error);
    return NextResponse.json({ error: "Failed to create review" }, { status: 500 });
  }
}
