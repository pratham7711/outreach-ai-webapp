import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string;
  const { id } = await params;

  const client = await db.client.findFirst({
    where: { id, orgId },
    include: { plan: true },
  });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    id: client.id,
    name: client.name,
    planId: client.planId,
    plan: client.plan
      ? { id: client.plan.id, name: client.plan.name, features: JSON.parse(client.plan.features as string) }
      : null,
    featureOverrides: client.featureOverrides ? JSON.parse(client.featureOverrides as string) : null,
  });
}

const UpdateFeaturesSchema = z.object({
  planId: z.string().nullable(),
  featureOverrides: z.record(z.string(), z.boolean()).nullable().optional(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string;
  const { id } = await params;

  const client = await db.client.findFirst({ where: { id, orgId } });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const parsed = UpdateFeaturesSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.planId) {
    const plan = await db.plan.findFirst({ where: { id: parsed.data.planId, orgId } });
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const featureOverrides =
    parsed.data.featureOverrides === null || parsed.data.featureOverrides === undefined
      ? null
      : JSON.stringify(parsed.data.featureOverrides);

  const updated = await db.client.update({
    where: { id },
    data: {
      planId: parsed.data.planId,
      featureOverrides,
    },
  });

  return NextResponse.json(updated);
}
