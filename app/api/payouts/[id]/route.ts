import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["PROCESSING"],
  PROCESSING: ["SUCCESS", "FAILED"],
  FAILED: ["PENDING"], // allow retry
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id } = await params;

  const payout = await db.payout.findFirst({ where: { id, orgId } });
  if (!payout) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const { status } = body;

  if (!status) return NextResponse.json({ error: "Status required" }, { status: 400 });

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
  if (status === "FAILED" && body.failureReason) {
    updateData.failureReason = body.failureReason;
  }
  if (status === "PENDING") {
    // retry — clear completion
    updateData.completedAt = null;
    updateData.failureReason = null;
  }

  const updated = await db.payout.update({ where: { id }, data: updateData });
  return NextResponse.json(updated);
}
