import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { permissionDenial } from "@/lib/authz";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["PROCESSING"],
  PROCESSING: ["SUCCESS", "FAILED"],
  FAILED: ["PENDING"],
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  /* Same gate as creating a payout (POST /api/payouts). */
  const denied = permissionDenial(session.user, "payments:manage");
  if (denied) return denied;
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

  /* One conditional write per payout, on the status its transition was checked
     against. A single updateMany over every valid id wrote whatever the rows
     held by then, so a payout another request had already moved (or two bulk
     requests racing) was transitioned twice. A row that moved in between is
     reported in errors instead of being overwritten. */
  let updated = 0;
  if (validIds.length > 0) {
    const updateData: any = { status };
    if (status === "SUCCESS" || status === "FAILED") {
      updateData.completedAt = new Date();
    }
    if (status === "PENDING") {
      updateData.completedAt = null;
      updateData.failureReason = null;
    }

    for (const p of payouts.filter((p) => validIds.includes(p.id))) {
      const swapped = await db.payout.updateMany({
        where: { id: p.id, orgId, status: p.status },
        data: updateData,
      });
      if (swapped.count === 0) {
        errors.push(`${p.id}: changed while updating; reload and try again`);
        continue;
      }
      updated += 1;
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

  return NextResponse.json({ updated, errors });
}
