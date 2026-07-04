import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";
import type { Currency } from "@/lib/generated/prisma/client";
import { computeSelfServeBudget } from "@/lib/campaigns/selfServeBudget";

const DEFAULT_FLAT_FEE_MINOR = 50000;

function resolvePlatformFeeMinor(): number {
  const raw = process.env.SELF_SERVE_FLAT_FEE_MINOR;
  if (!raw) return DEFAULT_FLAT_FEE_MINOR;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_FLAT_FEE_MINOR;
}

const selfServeSchema = z.object({
  title: z.string().trim().min(1).max(200),
  budget: z.number().positive().nullable().optional(),
  currency: z.enum(["USD", "EUR", "GBP", "INR"]).optional(),
  guidelines: z.string().max(5000).nullable().optional(),
  creatorIds: z.array(z.string().min(1)).min(1, "Select at least one creator").max(200),
});

export async function POST(request: NextRequest) {
  try {
    const result = await authenticateRequest(request);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const body = await request.json().catch(() => null);
    const parsed = selfServeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const { title, budget, currency, guidelines } = parsed.data;
    const creatorIds = Array.from(new Set(parsed.data.creatorIds));

    const creators = await db.creator.findMany({
      where: { id: { in: creatorIds }, orgId, deletedAt: null },
      select: { id: true, rate: true },
    });

    if (creators.length !== creatorIds.length) {
      return NextResponse.json(
        { error: "One or more selected creators do not belong to your organization" },
        { status: 400 }
      );
    }

    const platformFeeMinor = resolvePlatformFeeMinor();
    const budgetSummary = computeSelfServeBudget({
      creatorRates: creators.map((c) => (typeof c.rate === "number" ? c.rate : 0)),
      platformFeeMinor,
      currency: currency ?? "USD",
    });

    const campaign = await db.$transaction(async (tx) => {
      const created = await tx.campaign.create({
        data: {
          orgId,
          title,
          status: "DRAFT",
          selfServe: true,
          platformFeeMinor,
          budget: budget ?? null,
          currency: (currency ?? "USD") as Currency,
          guidelines: guidelines ?? null,
          createdById: result.userId ?? "api",
        },
      });

      await tx.campaignInvite.createMany({
        data: creators.map((c) => ({
          orgId,
          campaignId: created.id,
          creatorId: c.id,
          channel: "LINK" as const,
          status: "PENDING" as const,
        })),
      });

      return created;
    });

    await logAudit({
      orgId,
      ...getAuditActor(result),
      action: "campaign.self_serve.create",
      entityType: "campaign",
      entityId: campaign.id,
      entityLabel: campaign.title,
      ipAddress: getRequestIp(request),
      after: {
        id: campaign.id,
        title: campaign.title,
        selfServe: true,
        platformFeeMinor,
        invitedCount: creators.length,
      },
    });

    return NextResponse.json(
      {
        campaignId: campaign.id,
        invitedCount: creators.length,
        budget: budgetSummary,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create self-serve campaign:", error);
    return NextResponse.json({ error: "Failed to create self-serve campaign" }, { status: 500 });
  }
}
