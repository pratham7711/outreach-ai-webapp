import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { z } from "zod";
import type { PostStatus } from "@/lib/generated/prisma/client";

const updateStatusSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  rejectionReason: z.string().nullable().optional(),
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

// PATCH /api/campaigns/[id]/posts/[postId] — approve/reject only.
// Metrics are never writable by hand: they come from the platform sync
// (POST .../sync) so a number on screen always traces back to the API that
// produced it. Editing them here would silently overwrite synced truth.
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
  } catch (error) {
    console.error("Failed to update post:", error);
    return NextResponse.json({ error: "Failed to update post" }, { status: 500 });
  }
}
