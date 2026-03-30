import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { Prisma } from "@/lib/generated/prisma/client";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

const AssignPlanSchema = z.object({
  planId: z.string().nullable(),
  featureOverrides: z.record(z.string(), z.boolean()).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string;
  const { id } = await params;

  const client = await db.client.findFirst({ where: { id, orgId } });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const parsed = AssignPlanSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // If assigning a plan, verify it belongs to same org
  if (parsed.data.planId) {
    const plan = await db.plan.findFirst({ where: { id: parsed.data.planId, orgId } });
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const featureOverrides =
    parsed.data.featureOverrides == null
      ? Prisma.DbNull
      : (parsed.data.featureOverrides as Record<string, boolean>);

  const updated = await db.client.update({
    where: { id },
    data: {
      planId: parsed.data.planId,
      featureOverrides,
    },
    include: { plan: true },
  });

  await logAudit({
    orgId,
    ...createAuditActor(session),
    action: "client.plan.update",
    entityType: "client",
    entityId: updated.id,
    entityLabel: updated.name,
    ipAddress: getRequestIp(req),
    before: {
      id: client.id,
      planId: client.planId,
      featureOverrides: client.featureOverrides,
    },
    after: {
      id: updated.id,
      planId: updated.planId,
      featureOverrides: updated.featureOverrides,
    },
  });

  return NextResponse.json(updated);
}
