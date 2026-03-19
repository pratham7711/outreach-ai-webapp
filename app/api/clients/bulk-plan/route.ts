import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const BulkPlanSchema = z.object({
  clientIds: z.array(z.string()).min(1),
  planId: z.string().nullable(),
  clearOverrides: z.boolean().optional().default(false),
});

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string;

  const body = await req.json();
  const parsed = BulkPlanSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { clientIds, planId, clearOverrides } = parsed.data;

  // Verify plan belongs to org
  if (planId) {
    const plan = await db.plan.findFirst({ where: { id: planId, orgId } });
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // Verify all clients belong to org
  const clients = await db.client.findMany({
    where: { id: { in: clientIds }, orgId },
    select: { id: true },
  });
  if (clients.length !== clientIds.length) {
    return NextResponse.json({ error: "Some clients not found" }, { status: 404 });
  }

  // Build update data
  const data: Record<string, unknown> = { planId };
  if (clearOverrides) {
    data.featureOverrides = null;
  }

  await db.client.updateMany({
    where: { id: { in: clientIds }, orgId },
    data,
  });

  return NextResponse.json({ ok: true, updated: clientIds.length });
}
