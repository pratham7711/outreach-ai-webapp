import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { z } from "zod";
import type { FraudFlagType, FraudFlagSeverity } from "@/lib/generated/prisma/client";

const FLAG_TYPES = ["VIEW_SPIKE", "LOW_ENGAGEMENT", "BOT_PATTERN", "GEOGRAPHIC_ANOMALY"] as const;
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

const flagSchema = z.object({
  flagType: z.enum(FLAG_TYPES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  note: z.string().max(500).optional(),
});

type RouteParams = { params: Promise<{ id: string; postId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const userId = (session.user as any).id;
    const { id: campaignId, postId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const post = await db.post.findFirst({ where: { id: postId, campaignId } });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const parsed = flagSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const flagType: FraudFlagType = (parsed.data.flagType ?? "BOT_PATTERN") as FraudFlagType;
    const severity: FraudFlagSeverity = (parsed.data.severity ?? "MEDIUM") as FraudFlagSeverity;
    const note = parsed.data.note?.trim();

    const flag = await db.viewFraudFlag.create({
      data: {
        orgId,
        campaignId,
        creatorId: post.creatorId,
        postId: post.id,
        flagType,
        severity,
        description: note ? `Manually flagged: ${note}` : "Manually flagged as suspicious",
        evidence: {
          source: "manual",
          flaggedBy: userId ?? null,
          viewsCount: post.viewsCount,
          likesCount: post.likesCount,
          commentsCount: post.commentsCount,
          engagementRate: post.engagementRate,
        },
      },
    });

    return NextResponse.json(flag, { status: 201 });
  } catch (error) {
    console.error("Failed to flag post:", error);
    return NextResponse.json({ error: "Failed to flag post" }, { status: 500 });
  }
}
