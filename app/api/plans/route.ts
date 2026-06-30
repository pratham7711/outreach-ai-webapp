import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";

const CreatePlanSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  features: z.record(z.string(), z.boolean()),
  isCustom: z.boolean().optional().default(true),
});

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const plans = await db.plan.findMany({
    where: { orgId },
    include: { _count: { select: { clients: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ plans });
}

export async function POST(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const body = await req.json();
  const parsed = CreatePlanSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const plan = await db.plan.create({
    data: {
      orgId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      features: JSON.stringify(parsed.data.features),
      isCustom: parsed.data.isCustom,
    },
  });

  return NextResponse.json(plan, { status: 201 });
}
