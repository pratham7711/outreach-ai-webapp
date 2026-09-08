import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";
import type { DepositStatus } from "@/lib/generated/prisma/client";

const releaseSchema = z.object({
  amount: z.number().positive(),
});

// POST /api/campaigns/[id]/deposits/release — Release partial/full deposit
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

    const deposit = await db.campaignDeposit.findFirst({ where: { campaignId, orgId } });
    if (!deposit) return NextResponse.json({ error: "No deposit found" }, { status: 404 });

    if (deposit.status === "FULLY_RELEASED" || deposit.status === "REFUNDED") {
      return NextResponse.json({ error: "Deposit already fully released or refunded" }, { status: 400 });
    }

    const body = await request.json();
    const parsed = releaseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    /* Compared in cents, because a deposit released in instalments cannot be
       compared as a float. 500.31 in thirds is 166.77 + 166.77 + 166.77, and
       in IEEE 754 that sum is 500.31000000000006 -- greater than the deposit,
       so the last instalment of a fully-legitimate release was rejected with
       "Release amount exceeds remaining deposit" and the deposit could never
       reach FULLY_RELEASED. Rounding to minor units first makes the three
       instalments add up to exactly the deposit, which is what they are. */
    const toCents = (n: number) => Math.round(n * 100);
    const totalCents = toCents(deposit.amountUsd);
    const newReleasedCents = toCents(deposit.releasedAmount) + toCents(parsed.data.amount);
    if (newReleasedCents > totalCents) {
      return NextResponse.json({ error: "Release amount exceeds remaining deposit" }, { status: 400 });
    }

    /* Back to major units for storage: the column is a Float in the campaign's
       own unit, and rounding here is what keeps the stored figure free of the
       drift the comparison above just stepped around. */
    const newReleased = newReleasedCents / 100;
    const newStatus: DepositStatus =
      newReleasedCents >= totalCents ? "FULLY_RELEASED" : "PARTIALLY_RELEASED";

    const updated = await db.campaignDeposit.update({
      where: { id: deposit.id },
      data: { releasedAmount: newReleased, status: newStatus },
    });

    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: "deposit.release",
      entityType: "CampaignDeposit",
      entityId: deposit.id,
      entityLabel: `Released ${parsed.data.amount}`,
      ipAddress: getRequestIp(request),
      before: { releasedAmount: deposit.releasedAmount, status: deposit.status },
      after: { releasedAmount: updated.releasedAmount, status: updated.status },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to release deposit:", error);
    return NextResponse.json({ error: "Failed to release deposit" }, { status: 500 });
  }
}
