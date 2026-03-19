import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const UpdatePlanSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  features: z.record(z.string(), z.boolean()).optional(),
  isCustom: z.boolean().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string;
  const { id } = await params;

  const plan = await db.plan.findFirst({
    where: { id, orgId },
    include: { clients: { select: { id: true, name: true } } },
  });
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(plan);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string;
  const { id } = await params;

  const existing = await db.plan.findFirst({ where: { id, orgId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const parsed = UpdatePlanSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const plan = await db.plan.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      ...(parsed.data.features !== undefined && { features: parsed.data.features }),
      ...(parsed.data.isCustom !== undefined && { isCustom: parsed.data.isCustom }),
    },
  });

  return NextResponse.json(plan);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string;
  const { id } = await params;

  const existing = await db.plan.findFirst({ where: { id, orgId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Unassign plan from clients first
  await db.client.updateMany({ where: { planId: id }, data: { planId: null } });
  await db.plan.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
