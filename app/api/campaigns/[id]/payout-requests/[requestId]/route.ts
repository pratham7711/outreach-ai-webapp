import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";
import type { PayoutRequestStatus } from "@/lib/generated/prisma/client";

const updateRequestSchema = z.object({
  action: z.enum(["APPROVED", "REJECTED"]),
  rejectionReason: z.string().nullable().optional(),
});

// PATCH /api/campaigns/[id]/payout-requests/[requestId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId, requestId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const existing = await db.payoutRequest.findFirst({ where: { id: requestId, campaignId, orgId } });
    if (!existing) return NextResponse.json({ error: "Payout request not found" }, { status: 404 });

    if (existing.status !== "PENDING") {
      return NextResponse.json({ error: "Payout request has already been processed" }, { status: 400 });
    }

    const body = await request.json();
    const parsed = updateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const updated = await db.payoutRequest.update({
      where: { id: requestId },
      data: {
        status: parsed.data.action as PayoutRequestStatus,
        rejectionReason: parsed.data.action === "REJECTED" ? (parsed.data.rejectionReason ?? null) : null,
        processedAt: new Date(),
      },
    });

    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: `payout_request.${parsed.data.action.toLowerCase()}`,
      entityType: "PayoutRequest",
      entityId: requestId,
      entityLabel: `Request ${parsed.data.action.toLowerCase()}`,
      ipAddress: getRequestIp(request),
      before: { status: existing.status },
      after: { status: updated.status, processedAt: updated.processedAt },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update payout request:", error);
    return NextResponse.json({ error: "Failed to update payout request" }, { status: 500 });
  }
}
