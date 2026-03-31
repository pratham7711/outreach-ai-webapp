import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { analyzePostForFraud } from "@/lib/fraud-detection";

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

    const createdFlags = [];

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
        post.snapshots.map((s) => ({
          id: s.id,
          viewsCount: s.viewsCount,
          likesCount: s.likesCount,
          commentsCount: s.commentsCount,
          sharesCount: s.sharesCount,
          engagementRate: s.engagementRate,
          recordedAt: s.recordedAt,
        }))
      );

      for (const flag of detectedFlags) {
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
