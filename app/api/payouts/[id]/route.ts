import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

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
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const updated = await db.payout.update({ where: { id }, data: updateData });

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
