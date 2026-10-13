import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ONLY_REMOVED } from "@/lib/posts/removed";
import { auth } from "@/lib/auth";
import { sessionCampaignScopeDenial } from "@/lib/campaignAccess";

// GET /api/campaigns/[id]/fraud-flags
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
    const outOfScope = await sessionCampaignScopeDenial(session.user, campaignId);
    if (outOfScope) return outOfScope;

    // Verify campaign belongs to org
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null },
    });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 403 });
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const resolvedParam = searchParams.get("resolved");

    const where: Record<string, unknown> = {
      campaignId,
      orgId,
    };

    if (resolvedParam === "false") {
      where.isResolved = false;
    } else if (resolvedParam === "true") {
      where.isResolved = true;
    }

    /* A removed post's flags stay on file (they come back with a restore),
       but they are not this campaign's flags while the post is out of it --
       the hard delete used to take them with the post. ViewFraudFlag has no
       Post relation, so the removed ids are read first. */
    const removed = await db.post.findMany({
      where: { campaignId, ...ONLY_REMOVED },
      select: { id: true },
    });
    if (removed.length > 0) where.postId = { notIn: removed.map((p) => p.id) };

    const flags = await db.viewFraudFlag.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ flags });
  } catch (error) {
    console.error("Failed to fetch fraud flags:", error);
    return NextResponse.json(
      { error: "Failed to fetch fraud flags" },
      { status: 500 }
    );
  }
}
