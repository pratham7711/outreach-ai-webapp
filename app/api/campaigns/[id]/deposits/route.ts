import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";
import type { PaymentGateway, DepositPaymentMethod } from "@/lib/generated/prisma/client";

const createDepositSchema = z.object({
  amountRequested: z.number().positive(),
  currency: z.string().default("USD"),
  gateway: z.enum(["RAZORPAY", "STRIPE"]),
  method: z.enum(["CARD", "UPI", "NEFT", "IMPS", "RTGS", "ENACH", "WIRE"]).optional(),
});

// GET /api/campaigns/[id]/deposits — Get deposit for campaign (1:1)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const deposit = await db.campaignDeposit.findFirst({ where: { campaignId, orgId } });
    return NextResponse.json({ deposit });
  } catch (error) {
    console.error("Failed to fetch deposit:", error);
    return NextResponse.json({ error: "Failed to fetch deposit" }, { status: 500 });
  }
}

// POST /api/campaigns/[id]/deposits — Create deposit (stub gateway)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    // Check if deposit already exists (campaignId is @unique)
    const existing = await db.campaignDeposit.findFirst({ where: { campaignId } });
    if (existing) return NextResponse.json({ error: "Deposit already exists for this campaign" }, { status: 409 });

    const body = await request.json();
    const parsed = createDepositSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const deposit = await db.campaignDeposit.create({
      data: {
        orgId,
        campaignId,
        amountRequested: parsed.data.amountRequested,
        amountUsd: parsed.data.amountRequested, // stub: no currency conversion
        currency: parsed.data.currency,
        gateway: parsed.data.gateway as PaymentGateway,
        method: (parsed.data.method as DepositPaymentMethod) ?? null,
        gatewayOrderId: `stub_${Date.now()}`,
        status: "PENDING",
      },
    });

    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: "deposit.create",
      entityType: "CampaignDeposit",
      entityId: deposit.id,
      entityLabel: `${deposit.currency} ${deposit.amountRequested}`,
      ipAddress: getRequestIp(request),
      after: { id: deposit.id, amount: deposit.amountRequested, gateway: deposit.gateway, status: deposit.status },
    });

    return NextResponse.json(deposit, { status: 201 });
  } catch (error) {
    console.error("Failed to create deposit:", error);
    return NextResponse.json({ error: "Failed to create deposit" }, { status: 500 });
  }
}
