import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// GET /api/campaigns/[id]/posts/[postId]/snapshots
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId, postId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const post = await db.post.findFirst({ where: { id: postId, campaignId } });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const snapshots = await db.postMetricSnapshot.findMany({
      where: { postId },
      orderBy: { recordedAt: "asc" },
    });

    return NextResponse.json({ snapshots });
  } catch (error) {
    console.error("Failed to fetch snapshots:", error);
    return NextResponse.json({ error: "Failed to fetch snapshots" }, { status: 500 });
  }
}
