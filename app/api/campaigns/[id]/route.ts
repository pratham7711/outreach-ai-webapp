import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";

const CAMPAIGN_TYPES = ["BUDGET_BASED", "VIEW_BASED", "OPEN_COMMUNITY", "PRIVATE_INVITE"] as const;

const PAYMENT_MODES = ["MANAGED", "SELF_MANAGED"] as const;
const PAYMENT_RELEASES = ["MANUAL", "ON_POST_APPROVAL", "ON_CREATOR_REQUEST"] as const;
const POST_APPROVAL_MODES = ["MANUAL", "AUTO_APPROVED"] as const;

const updateCampaignSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(["DRAFT", "PENDING", "IN_PROGRESS", "COMPLETE", "CANCELLED"]).optional(),
  campaignType: z.enum(CAMPAIGN_TYPES).optional(),
  typeConfig: z.any().nullable().optional(),
  budget: z.number().positive().nullable().optional(),
  currency: z.enum(["USD", "EUR", "GBP", "INR"]).optional(),
  notes: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  folderId: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  paymentRelease: z.enum(PAYMENT_RELEASES).optional(),
  postApprovalMode: z.enum(POST_APPROVAL_MODES).optional(),
  enrollmentOpen: z.boolean().optional(),
});

// GET /api/campaigns/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const { id } = await params;

    const campaign = await db.campaign.findFirst({
      where: { id, orgId, deletedAt: null },
      include: {
        tags: true,
        teamMembers: {
          include: {
            user: {
              select: { id: true, name: true, avatarUrl: true },
            },
          },
        },
        activations: {
          include: { creator: true },
        },
        posts: {
          include: {
            creator: {
              select: { id: true, name: true },
            },
          },
        },
        brief: true,
        financials: true,
        _count: {
          select: { activations: true, posts: true },
        },
      },
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    return NextResponse.json(campaign);
  } catch (error) {
    console.error("Failed to fetch campaign:", error);
    return NextResponse.json(
      { error: "Failed to fetch campaign" },
      { status: 500 }
    );
  }
}

// PATCH /api/campaigns/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateRequest(request);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const { id } = await params;
    const body = await request.json();
    const parsed = updateCampaignSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await db.campaign.findFirst({ where: { id, orgId, deletedAt: null } });
    if (!existing) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const campaign = await db.campaign.update({
      where: { id },
      data: parsed.data,
      include: {
        tags: true,
        teamMembers: {
          include: {
            user: {
              select: { id: true, name: true, avatarUrl: true },
            },
          },
        },
        _count: {
          select: { activations: true, posts: true },
        },
      },
    });

    await logAudit({
      orgId,
      ...getAuditActor(result),
      action: "campaign.update",
      entityType: "campaign",
      entityId: campaign.id,
      entityLabel: campaign.title,
      ipAddress: getRequestIp(request),
      before: {
        id: existing.id,
        title: existing.title,
        status: existing.status,
        campaignType: existing.campaignType,
        budget: existing.budget,
      },
      after: {
        id: campaign.id,
        title: campaign.title,
        status: campaign.status,
        campaignType: campaign.campaignType,
        budget: campaign.budget,
      },
    });

    return NextResponse.json(campaign);
  } catch (error) {
    console.error("Failed to update campaign:", error);
    return NextResponse.json(
      { error: "Failed to update campaign" },
      { status: 500 }
    );
  }
}

// DELETE /api/campaigns/[id] - Soft delete
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateRequest(request);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const { id } = await params;

    const existing = await db.campaign.findFirst({ where: { id, orgId, deletedAt: null } });
    if (!existing) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    await db.campaign.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await logAudit({
      orgId,
      ...getAuditActor(result),
      action: "campaign.delete",
      entityType: "campaign",
      entityId: existing.id,
      entityLabel: existing.title,
      ipAddress: getRequestIp(request),
      before: {
        id: existing.id,
        title: existing.title,
        status: existing.status,
        deletedAt: existing.deletedAt,
      },
      after: {
        id: existing.id,
        deletedAt: new Date().toISOString(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete campaign:", error);
    return NextResponse.json(
      { error: "Failed to delete campaign" },
      { status: 500 }
    );
  }
}
