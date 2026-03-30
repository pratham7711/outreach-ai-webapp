import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["PROCESSING"],
  PROCESSING: ["SUCCESS", "FAILED"],
  FAILED: ["PENDING"],
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;

  const { ids, status } = await req.json();
  if (!ids?.length || !status) {
    return NextResponse.json({ error: "ids and status required" }, { status: 400 });
  }

  // Fetch all payouts to validate transitions
  const payouts = await db.payout.findMany({ where: { id: { in: ids }, orgId } });

  const validIds: string[] = [];
  const errors: string[] = [];

  for (const p of payouts) {
    const allowed = ALLOWED_TRANSITIONS[p.status] ?? [];
    if (allowed.includes(status)) {
      validIds.push(p.id);
    } else {
      errors.push(`${p.id}: cannot ${p.status} → ${status}`);
    }
  }

  if (validIds.length > 0) {
    const updateData: any = { status };
    if (status === "SUCCESS" || status === "FAILED") {
      updateData.completedAt = new Date();
    }
    if (status === "PENDING") {
      updateData.completedAt = null;
      updateData.failureReason = null;
    }
    await db.payout.updateMany({ where: { id: { in: validIds } }, data: updateData });

    for (const p of payouts.filter((p) => validIds.includes(p.id))) {
      await logAudit({
        orgId,
        ...createAuditActor(session),
        action: "payout.status_changed",
        entityType: "payout",
        entityId: p.id,
        entityLabel: p.transactionId ?? p.id,
        before: { id: p.id, status: p.status },
        after: { id: p.id, status },
      });
    }
  }

  return NextResponse.json({ updated: validIds.length, errors });
}
