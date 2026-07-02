import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";
import type { PostStatus, Platform } from "@/lib/generated/prisma/client";

const PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"] as const;
const MEDIA_TYPES = ["REEL", "STORY", "POST", "SHORT", "VIDEO"] as const;
const POST_STATUSES = ["PENDING_REVIEW", "APPROVED", "REJECTED"] as const;

const createPostSchema = z.object({
  postUrl: z.string().url(),
  creatorId: z.string().min(1),
  mediaType: z.enum(MEDIA_TYPES).optional(),
  activationId: z.string().nullable().optional(),
});

// GET /api/campaigns/[id]/posts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId } = await params;

    // Verify campaign belongs to org
    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") as (typeof POST_STATUSES)[number] | null;
    const platform = searchParams.get("platform") as (typeof PLATFORMS)[number] | null;
    const mediaType = searchParams.get("mediaType") as (typeof MEDIA_TYPES)[number] | null;

    const where: Record<string, unknown> = { campaignId };
    if (status) where.status = status;
    if (platform) where.platform = platform;
    if (mediaType) where.mediaType = mediaType;

    const posts = await db.post.findMany({
      where,
      include: {
        creator: { select: { id: true, name: true, handle: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ posts });
  } catch (error) {
    console.error("Failed to fetch posts:", error);
    return NextResponse.json({ error: "Failed to fetch posts" }, { status: 500 });
  }
}

// POST /api/campaigns/[id]/posts — Submit a post URL
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const body = await request.json();
    const parsed = createPostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const { postUrl, creatorId, mediaType, activationId } = parsed.data;

    const creator = await db.creator.findFirst({ where: { id: creatorId, orgId, deletedAt: null } });
    if (!creator) return NextResponse.json({ error: "Creator not found" }, { status: 404 });

    if (activationId) {
      const activation = await db.activation.findFirst({ where: { id: activationId, campaignId } });
      if (!activation) return NextResponse.json({ error: "Activation not found" }, { status: 404 });
    }

    // Fetch metrics from platform
    const metrics = await fetchPostMetrics(postUrl);

    const initialStatus: PostStatus = campaign.postApprovalMode === "AUTO_APPROVED" ? "APPROVED" : "PENDING_REVIEW";

    const post = await db.post.create({
      data: {
        campaignId,
        creatorId,
        platform: (metrics?.platform ?? "TIKTOK") as Platform,
        platformPostId: metrics?.platformPostId ?? postUrl,
        postUrl,
        thumbnailUrl: metrics?.thumbnailUrl ?? null,
        caption: metrics?.caption ?? null,
        mediaType: mediaType ?? null,
        viewsCount: metrics?.viewsCount ?? 0,
        likesCount: metrics?.likesCount ?? 0,
        commentsCount: metrics?.commentsCount ?? 0,
        engagementRate: metrics?.engagementRate ?? 0,
        postedAt: metrics?.postedAt ?? new Date(),
        status: initialStatus,
        activationId: activationId ?? null,
      },
      include: {
        creator: { select: { id: true, name: true, handle: true, avatarUrl: true } },
      },
    });

    return NextResponse.json(post, { status: 201 });
  } catch (error) {
    console.error("Failed to create post:", error);
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
  }
}
