import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { z } from "zod";
import type { PostStatus } from "@/lib/generated/prisma/client";

const updateStatusSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  rejectionReason: z.string().nullable().optional(),
});

const updateMetricsSchema = z.object({
  viewsCount: z.number().int().min(0).optional(),
  likesCount: z.number().int().min(0).optional(),
  commentsCount: z.number().int().min(0).optional(),
  sharesCount: z.number().int().min(0).optional(),
  savesCount: z.number().int().min(0).optional(),
  reachCount: z.number().int().min(0).optional(),
  downloadsCount: z.number().int().min(0).optional(),
});

type RouteParams = { params: Promise<{ id: string; postId: string }> };

// GET /api/campaigns/[id]/posts/[postId]
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId, postId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const post = await db.post.findFirst({
      where: { id: postId, campaignId },
      include: {
        creator: { select: { id: true, name: true, handle: true, avatarUrl: true, platform: true } },
        snapshots: { orderBy: { recordedAt: "desc" }, take: 50 },
      },
    });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    return NextResponse.json(post);
  } catch (error) {
    console.error("Failed to fetch post:", error);
    return NextResponse.json({ error: "Failed to fetch post" }, { status: 500 });
  }
}

// PATCH /api/campaigns/[id]/posts/[postId] — Approve/reject OR manual metric update
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId, postId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const existing = await db.post.findFirst({ where: { id: postId, campaignId } });
    if (!existing) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const body = await request.json();

    // Status update (approve/reject)
    if (body.status) {
      const parsed = updateStatusSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
      }

      const post = await db.post.update({
        where: { id: postId },
        data: {
          status: parsed.data.status as PostStatus,
          rejectionReason: parsed.data.status === "REJECTED" ? (parsed.data.rejectionReason ?? null) : null,
        },
        include: {
          creator: { select: { id: true, name: true, handle: true, avatarUrl: true } },
        },
      });
      return NextResponse.json(post);
    }

    // Manual metric update
    const parsed = updateMetricsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const metrics = parsed.data;
    const views = metrics.viewsCount ?? existing.viewsCount;
    const likes = metrics.likesCount ?? existing.likesCount;
    const comments = metrics.commentsCount ?? existing.commentsCount;
    const shares = metrics.sharesCount ?? existing.sharesCount;
    const saves = metrics.savesCount ?? existing.savesCount;
    const reach = metrics.reachCount ?? existing.reachCount;
    const downloads = metrics.downloadsCount ?? existing.downloadsCount;
    const engagementRate = views > 0 ? ((likes + comments) / views) * 100 : 0;

    const [post] = await db.$transaction([
      db.post.update({
        where: { id: postId },
        data: {
          viewsCount: views,
          likesCount: likes,
          commentsCount: comments,
          sharesCount: shares,
          savesCount: saves,
          reachCount: reach,
          downloadsCount: downloads,
          engagementRate,
          lastSyncedAt: new Date(),
        },
        include: {
          creator: { select: { id: true, name: true, handle: true, avatarUrl: true } },
        },
      }),
      db.postMetricSnapshot.create({
        data: {
          postId,
          viewsCount: views,
          likesCount: likes,
          commentsCount: comments,
          sharesCount: shares,
          savesCount: saves,
          reachCount: reach,
          downloadsCount: downloads,
          engagementRate,
          syncSource: "manual",
        },
      }),
    ]);

    return NextResponse.json(post);
  } catch (error) {
    console.error("Failed to update post:", error);
    return NextResponse.json({ error: "Failed to update post" }, { status: 500 });
  }
}
