import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";
import type { PayoutRequestStatus } from "@/lib/generated/prisma/client";
import { permissionDenial } from "@/lib/authz";
import { sessionCampaignScopeDenial } from "@/lib/campaignAccess";

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
    const denied =
      permissionDenial(session.user, "payments:manage") ??
      (await sessionCampaignScopeDenial(session.user, campaignId));
    if (denied) return denied;

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

    /* Only a PENDING request can be decided, and the write itself says so. The
       check above ran on a read; two approvals sent together both passed it and
       both wrote, so one request could be approved twice (or approved and
       rejected) with two audit rows. The loser now gets a 409. */
    const swapped = await db.payoutRequest.updateMany({
      where: { id: requestId, orgId, status: "PENDING" },
      data: {
        status: parsed.data.action as PayoutRequestStatus,
        rejectionReason: parsed.data.action === "REJECTED" ? (parsed.data.rejectionReason ?? null) : null,
        processedAt: new Date(),
      },
    });
    if (swapped.count === 0) {
      return NextResponse.json({ error: "Payout request has already been processed" }, { status: 409 });
    }
    const updated = await db.payoutRequest.findUniqueOrThrow({ where: { id: requestId } });

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
