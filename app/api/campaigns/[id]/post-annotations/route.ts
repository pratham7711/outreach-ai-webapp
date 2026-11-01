import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { campaignScopeWhere, scopeSubjectFromSession } from "@/lib/campaignScope";
import { loadPostAnnotations } from "@/lib/posts/annotations";
import { exclusionsAllowed } from "@/lib/campaigns/rules";

/**
 * GET /api/campaigns/[id]/post-annotations -- boost codes, submission notes and
 * exclusion reasons for the campaign's posts, keyed by post id, and whether
 * this campaign lets a reviewer exclude a checked post with a reason (off by
 * default; switched in Settings, under Post review).
 *
 * A route of its own rather than fields on the posts list, so the list (and its
 * protobuf encoding) is untouched, and a database without the table answers an
 * empty map here while the list reads exactly as before.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as { orgId: string }).orgId;
    const { id } = await params;
    const scope = scopeSubjectFromSession(session.user);
    const campaign = await db.campaign.findFirst({
      where: { id, orgId, deletedAt: null, ...(scope ? campaignScopeWhere(scope) : {}) },
      select: { id: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const [annotations, allowExclusions] = await Promise.all([
      loadPostAnnotations(campaign.id, orgId),
      exclusionsAllowed(campaign.id, orgId),
    ]);
    return NextResponse.json({ annotations, allowExclusions });
  } catch (error) {
    console.error("Failed to read post annotations:", error);
    return NextResponse.json({ error: "Failed to read post annotations" }, { status: 500 });
  }
}
