import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { z } from "zod";

const updateFlagSchema = z.object({
  isResolved: z.boolean(),
});

// PATCH /api/fraud-flags/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const orgId = (session.user as any).orgId;
    const userId = (session.user as any).id;
    const { id } = await params;

    const body = await request.json();
    const parsed = updateFlagSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Find flag and verify org ownership
    const existing = await db.viewFraudFlag.findFirst({
      where: { id, orgId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Fraud flag not found" }, { status: 404 });
    }

    const updated = await db.viewFraudFlag.update({
      where: { id },
      data: {
        isResolved: parsed.data.isResolved,
        resolvedAt: parsed.data.isResolved ? new Date() : null,
        resolvedBy: parsed.data.isResolved ? userId : null,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update fraud flag:", error);
    return NextResponse.json(
      { error: "Failed to update fraud flag" },
      { status: 500 }
    );
  }
}
