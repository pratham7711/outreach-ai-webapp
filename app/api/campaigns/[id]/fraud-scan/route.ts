import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { auth } from "@/lib/auth";
import { raiseFraudFlags } from "@/lib/fraud/scanPosts";
import { permissionDenial } from "@/lib/authz";
import { sessionCampaignScopeDenial } from "@/lib/campaignAccess";

// POST /api/campaigns/[id]/fraud-scan
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const orgId = (session.user as any).orgId;
    const { id: campaignId } = await params;
    const denied =
      permissionDenial(session.user, "campaigns:edit_own") ??
      (await sessionCampaignScopeDenial(session.user, campaignId));
    if (denied) return denied;

    // Verify campaign belongs to org
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null },
    });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 403 });
    }

    const posts = await db.post.findMany({
      where: { campaignId, ...NOT_REMOVED },
      include: {
        snapshots: {
          orderBy: { recordedAt: "asc" },
        },
      },
    });

    /* The same rules and the same once-per-evidence dedupe the post sweep
       runs after every reading (lib/fraud/scanPosts). */
    const { created: createdFlags, skipped: skippedFlags } = await raiseFraudFlags(orgId, posts);

    return NextResponse.json({
      flagsCreated: createdFlags.length,
      flagsSkipped: skippedFlags,
      flags: createdFlags,
    });
  } catch (error) {
    console.error("Failed to run fraud scan:", error);
    return NextResponse.json(
      { error: "Failed to run fraud scan" },
      { status: 500 }
    );
  }
}
