import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { syncPost } from "@/lib/sync/syncPost";

// POST /api/campaigns/[id]/posts/[postId]/sync — Trigger manual sync for a post
export async function POST(
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

    const outcome = await syncPost(post, orgId);
    if (outcome.status === "unfetchable") {
      return NextResponse.json({ error: "Could not fetch metrics for this post URL" }, { status: 422 });
    }
    // The post stays the response body, because the detail page renders it
    // straight back. metricsFound rides alongside so the caller can say "the
    // platform gave us nothing" instead of showing an unchanged card and
    // leaving the person to guess whether the click did anything.
    return NextResponse.json({ ...outcome.post, metricsFound: outcome.status === "measured" });
  } catch (error) {
    console.error("Failed to sync post:", error);
    return NextResponse.json({ error: "Failed to sync post" }, { status: 500 });
  }
}
