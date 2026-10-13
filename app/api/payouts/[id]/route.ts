import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { requirePermission } from "@/lib/authz";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["PROCESSING", "SUCCESS"],
  PROCESSING: ["SUCCESS", "FAILED"],
  FAILED: ["PENDING"], // allow retry
};

const PayoutPatchSchema = z.object({
  status: z.enum(["PENDING", "PROCESSING", "SUCCESS", "FAILED"]),
  failureReason: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  /* The gate POST /api/payouts already uses. A payout's status is what says it
     was paid; any seat, VIEWER and read-only act-as included, could mark one
     SUCCESS. */
  const gate = await requirePermission(req, "payments:manage");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const { id } = await params;

  const payout = await db.payout.findFirst({ where: { id, orgId } });
  if (!payout) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const parsed = PayoutPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 });
  }
  const { status, failureReason } = parsed.data;

  const allowed = ALLOWED_TRANSITIONS[payout.status] ?? [];
  if (!allowed.includes(status)) {
    return NextResponse.json(
      { error: `Cannot transition from ${payout.status} to ${status}` },
      { status: 400 }
    );
  }

  const updateData: any = { status };
  if (status === "SUCCESS" || status === "FAILED") {
    updateData.completedAt = new Date();
  }
  if (status === "FAILED" && failureReason) {
    updateData.failureReason = failureReason;
  }
  if (status === "PENDING") {
    // retry — clear completion
    updateData.completedAt = null;
    updateData.failureReason = null;
  }

  /* Compare-and-swap on the status the transition was checked against. Two
     requests that both read PENDING both passed the table above and both
     wrote, so a payout could be completed twice with two audit rows, or
     completed by one and failed by the other. The loser now gets a 409. */
  const swapped = await db.payout.updateMany({
    where: { id, orgId, status: payout.status },
    data: updateData,
  });
  if (swapped.count === 0) {
    return NextResponse.json(
      { error: "This payout changed while you were updating it. Reload it and try again." },
      { status: 409 }
    );
  }
  const updated = await db.payout.findUniqueOrThrow({ where: { id } });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "payout.update_status",
    entityType: "payout",
    entityId: updated.id,
    entityLabel: updated.transactionId ?? updated.id,
    ipAddress: getRequestIp(req),
    before: {
      id: payout.id,
      status: payout.status,
      completedAt: payout.completedAt,
      failureReason: payout.failureReason,
    },
    after: {
      id: updated.id,
      status: updated.status,
      completedAt: updated.completedAt,
      failureReason: updated.failureReason,
    },
  });

  return NextResponse.json(updated);
}
