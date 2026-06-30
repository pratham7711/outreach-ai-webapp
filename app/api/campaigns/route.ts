import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";
import type { CampaignStatus, PaymentMode, PaymentRelease, PostApprovalMode } from "@/lib/generated/prisma/client";

const CAMPAIGN_TYPES = ["BUDGET_BASED", "VIEW_BASED", "OPEN_COMMUNITY", "PRIVATE_INVITE"] as const;

const PAYMENT_MODES = ["MANAGED", "SELF_MANAGED"] as const;
const PAYMENT_RELEASES = ["MANUAL", "ON_POST_APPROVAL", "ON_CREATOR_REQUEST"] as const;
const POST_APPROVAL_MODES = ["MANUAL", "AUTO_APPROVED"] as const;

const createCampaignSchema = z.object({
  title: z.string().min(1).max(200),
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

// GET /api/campaigns - List campaigns with filters and pagination
export async function GET(request: NextRequest) {
  try {
    const result = await authenticateRequest(request);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") as CampaignStatus | null;
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const limit = parseInt(searchParams.get("limit") ?? "20", 10);
    const skip = (page - 1) * limit;

    const where = {
      orgId,
      ...(status && { status }),
      ...(search && {
        title: { contains: search, mode: "insensitive" as const },
      }),
      deletedAt: null,
    };

    const [campaigns, total] = await Promise.all([
      db.campaign.findMany({
        where,
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
        orderBy: { updatedAt: "desc" },
        skip,
        take: limit,
      }),
      db.campaign.count({ where }),
    ]);

    return NextResponse.json({
      campaigns,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Failed to fetch campaigns:", error);
    return NextResponse.json(
      { error: "Failed to fetch campaigns" },
      { status: 500 }
    );
  }
}

// POST /api/campaigns - Create a new campaign
export async function POST(request: NextRequest) {
  try {
    const result = await authenticateRequest(request);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const body = await request.json();
    const parsed = createCampaignSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { title, status, campaignType, typeConfig, budget, currency, notes, clientId, folderId, thumbnailUrl, paymentMode, paymentRelease, postApprovalMode, enrollmentOpen } = parsed.data;

    const campaign = await db.campaign.create({
      data: {
        title,
        status: status ?? "DRAFT",
        campaignType: campaignType ?? "BUDGET_BASED",
        typeConfig: typeConfig ?? null,
        budget: budget ?? null,
        currency: currency ?? "USD",
        notes: notes ?? null,
        clientId: clientId ?? null,
        folderId: folderId ?? null,
        thumbnailUrl: thumbnailUrl ?? null,
        paymentMode: (paymentMode ?? "SELF_MANAGED") as PaymentMode,
        paymentRelease: (paymentRelease ?? "MANUAL") as PaymentRelease,
        postApprovalMode: (postApprovalMode ?? "MANUAL") as PostApprovalMode,
        enrollmentOpen: enrollmentOpen ?? false,
        orgId,
        createdById: result.userId ?? "api",
      },
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
      action: "campaign.create",
      entityType: "campaign",
      entityId: campaign.id,
      entityLabel: campaign.title,
      ipAddress: getRequestIp(request),
      after: {
        id: campaign.id,
        title: campaign.title,
        status: campaign.status,
        campaignType: campaign.campaignType,
      },
    });

    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    console.error("Failed to create campaign:", error);
    return NextResponse.json(
      { error: "Failed to create campaign" },
      { status: 500 }
    );
  }
}
