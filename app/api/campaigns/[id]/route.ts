import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { generatePublicSlug, generateInviteCode } from "@/lib/marketplace";
import { z } from "zod";
import { Prisma } from "@/lib/generated/prisma/client";

const CAMPAIGN_TYPES = ["BUDGET_BASED", "VIEW_BASED", "OPEN_COMMUNITY", "PRIVATE_INVITE"] as const;

const PAYMENT_MODES = ["MANAGED", "SELF_MANAGED"] as const;
const PAYMENT_RELEASES = ["MANUAL", "ON_POST_APPROVAL", "ON_CREATOR_REQUEST"] as const;
const POST_APPROVAL_MODES = ["MANUAL", "AUTO_APPROVED"] as const;
const MARKETPLACE_VISIBILITIES = ["PRIVATE", "GLOBAL", "INVITE_ONLY"] as const;
const MARKETPLACE_PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"] as const;

// Per-platform rate per 1k views, stored as integer MINOR units (cents/paise) — P3.1 convention.
const ratePerThousandSchema = z
  .record(z.enum(MARKETPLACE_PLATFORMS), z.number().int().nonnegative())
  .nullable()
  .optional();

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
  // ─── Whop-style marketplace (Phase 2M) ───────────────────────────────────
  marketplaceVisibility: z.enum(MARKETPLACE_VISIBILITIES).optional(),
  guidelines: z.string().max(20000).nullable().optional(),
  requirements: z.string().max(20000).nullable().optional(),
  contentAssetsUrl: z.string().url().max(2000).nullable().optional().or(z.literal("")),
  ratePerThousand: ratePerThousandSchema,
  minPayoutMinor: z.number().int().nonnegative().nullable().optional(),
  marketplaceBudgetCapMinor: z.number().int().nonnegative().nullable().optional(),
  submissionDeadline: z.coerce.date().nullable().optional(),
  autoApproveHours: z.number().int().min(1).max(720).optional(),
  // publicSlug is NEVER client-supplied — generated server-side on first GLOBAL publish.
  // inviteCode is NEVER client-supplied — set/rotated server-side via this flag.
  regenerateInviteCode: z.boolean().optional(),
});

/**
 * Publishing to the public marketplace (GLOBAL) requires a title, guidelines,
 * and at least one platform rate. Returns an error string if requirements are
 * unmet, otherwise null. `next` merges the incoming patch over the existing row.
 */
function validateGlobalPublish(next: {
  title?: string | null;
  guidelines?: string | null;
  ratePerThousand?: unknown;
}): string | null {
  if (!next.title || next.title.trim().length === 0) {
    return "A campaign title is required to publish to the public marketplace.";
  }
  if (!next.guidelines || next.guidelines.trim().length === 0) {
    return "Guidelines are required to publish to the public marketplace.";
  }
  const rates = next.ratePerThousand as Record<string, number> | null | undefined;
  const hasRate =
    rates != null &&
    typeof rates === "object" &&
    Object.values(rates).some((v) => typeof v === "number" && v > 0);
  if (!hasRate) {
    return "At least one platform rate is required to publish to the public marketplace.";
  }
  return null;
}

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

    const { regenerateInviteCode, contentAssetsUrl, submissionDeadline, ratePerThousand, ...rest } =
      parsed.data;

    // Build the update payload; marketplace side-effects (slug, invite code) are
    // derived server-side only — never trusted from the request body.
    const data: Prisma.CampaignUncheckedUpdateInput = {
      ...rest,
      // Normalize empty-string asset URL to null.
      ...(contentAssetsUrl !== undefined
        ? { contentAssetsUrl: contentAssetsUrl === "" ? null : contentAssetsUrl }
        : {}),
      ...(submissionDeadline !== undefined ? { submissionDeadline } : {}),
      // JSON column: Prisma needs JsonNull sentinel (not JS null) to store SQL null.
      ...(ratePerThousand !== undefined
        ? { ratePerThousand: ratePerThousand === null ? Prisma.JsonNull : ratePerThousand }
        : {}),
    };

    const nextVisibility = rest.marketplaceVisibility ?? existing.marketplaceVisibility;

    // Gate: publishing to GLOBAL requires title + guidelines + ≥1 platform rate.
    if (nextVisibility === "GLOBAL") {
      const error = validateGlobalPublish({
        title: rest.title ?? existing.title,
        guidelines: "guidelines" in rest ? rest.guidelines : existing.guidelines,
        ratePerThousand:
          ratePerThousand !== undefined ? ratePerThousand : existing.ratePerThousand,
      });
      if (error) {
        return NextResponse.json({ error }, { status: 400 });
      }
      // Generate a public slug on first publish (idempotent — keep an existing one).
      if (!existing.publicSlug) {
        data.publicSlug = await generatePublicSlug(rest.title ?? existing.title);
      }
    }

    // Ensure an INVITE_ONLY campaign always has a code; rotate on explicit request.
    if (nextVisibility === "INVITE_ONLY" && (!existing.inviteCode || regenerateInviteCode)) {
      data.inviteCode = generateInviteCode();
    } else if (regenerateInviteCode && existing.inviteCode) {
      data.inviteCode = generateInviteCode();
    }

    const campaign = await db.campaign.update({
      where: { id },
      data,
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
