import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { analyzePostForFraud, fraudFlagKey } from "@/lib/fraud-detection";
import { readableSnapshots } from "@/lib/metricDisplay";
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

    // Fetch all posts in the campaign with their snapshots
    const posts = await db.post.findMany({
      where: { campaignId },
      include: {
        snapshots: {
          orderBy: { recordedAt: "asc" },
        },
      },
    });

    const existingFlags = await db.viewFraudFlag.findMany({
      where: { orgId, campaignId },
      select: { postId: true, flagType: true, evidence: true },
    });
    const seen = new Set(
      existingFlags.map((f) => fraudFlagKey(f.postId, f.flagType, f.evidence))
    );

    const createdFlags = [];
    let skippedFlags = 0;

    for (const post of posts) {
      const detectedFlags = analyzePostForFraud(
        {
          id: post.id,
          campaignId: post.campaignId,
          creatorId: post.creatorId,
          viewsCount: post.viewsCount,
          likesCount: post.likesCount,
          commentsCount: post.commentsCount,
          sharesCount: post.sharesCount,
          engagementRate: post.engagementRate,
        },
        /* Only readings that measured views, other counters held at their last
           known level: a placeholder 0 between two real readings is a
           collapse and then a "spike", which is a fraud flag on an honest post. */
        readableSnapshots(post.snapshots).map((s) => ({
          id: s.id,
          viewsCount: s.viewsCount,
          likesCount: s.likesCount ?? 0,
          commentsCount: s.commentsCount ?? 0,
          sharesCount: s.sharesCount ?? 0,
          engagementRate: s.engagementRate,
          recordedAt: s.recordedAt,
        }))
      );

      for (const flag of detectedFlags) {
        const key = fraudFlagKey(post.id, flag.flagType, flag.evidence);
        if (seen.has(key)) {
          skippedFlags++;
          continue;
        }
        seen.add(key);

        const created = await db.viewFraudFlag.create({
          data: {
            orgId,
            campaignId,
            creatorId: post.creatorId,
            postId: post.id,
            flagType: flag.flagType,
            severity: flag.severity,
            description: flag.description,
            evidence: flag.evidence as any,
          },
        });
        createdFlags.push(created);
      }
    }

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
