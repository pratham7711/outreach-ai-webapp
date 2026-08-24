import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

/**
 * What a creator owes on one activation -- the reference's "Manage
 * Deliverables".
 *
 * One row per thing owed rather than a quantity, because two videos have two
 * due dates and are finished separately. The org's deliverable types come from
 * Settings → General; the chosen type's name is copied onto the row so deleting
 * a definition leaves the deliverable readable rather than blank.
 *
 * Behind campaigns:edit_own, because changing what a creator owes is editing
 * the campaign.
 */

const createSchema = z.object({
  // Either pick one of the org's types, or name it yourself. One of the two.
  typeDefId: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  notes: z.string().max(2_000).nullable().optional(),
});

/** The activation, proven to belong to this org. */
async function reach(orgId: string, id: string) {
  return db.activation.findFirst({
    where: { id, campaign: { orgId }, deletedAt: null },
    select: { id: true, campaignId: true, creator: { select: { name: true } } },
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(request, "campaigns:read");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;
  const { id } = await params;

  const activation = await reach(orgId, id);
  if (!activation) return NextResponse.json({ error: "Activation not found" }, { status: 404 });

  const deliverables = await db.deliverable.findMany({
    where: { activationId: id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, name: true, typeDefId: true, dueDate: true,
      completedAt: true, notes: true, sortOrder: true,
    },
  });
  return NextResponse.json({ deliverables });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(request, "campaigns:edit_own");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const { id } = await params;

  const activation = await reach(orgId, id);
  if (!activation) return NextResponse.json({ error: "Activation not found" }, { status: 404 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { typeDefId, dueDate, notes } = parsed.data;

  // The type id arrives in the request body, so it has to be proven to be this
  // org's own definition before it is linked -- otherwise a caller could attach
  // another org's type and read its name back off their own deliverable.
  let name = parsed.data.name?.trim();
  if (typeDefId) {
    const def = await db.deliverableTypeDef.findFirst({
      where: { id: typeDefId, orgId },
      select: { name: true },
    });
    if (!def) return NextResponse.json({ error: "Unknown deliverable type" }, { status: 400 });
    name = name || def.name;
  }
  if (!name) {
    return NextResponse.json({ error: "Pick a type or give the deliverable a name" }, { status: 400 });
  }

  // Appended to the end of the list rather than dropped at the top.
  const last = await db.deliverable.findFirst({
    where: { activationId: id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const deliverable = await db.deliverable.create({
    data: {
      activationId: id,
      typeDefId: typeDefId ?? null,
      name,
      dueDate: dueDate ? new Date(dueDate) : null,
      notes: notes ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    select: { id: true, name: true, typeDefId: true, dueDate: true, completedAt: true, notes: true, sortOrder: true },
  });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "deliverable.create",
    entityType: "activation",
    entityId: activation.id,
    entityLabel: activation.creator.name,
    ipAddress: getRequestIp(request),
    after: { id: deliverable.id, name: deliverable.name, campaignId: activation.campaignId },
  });

  return NextResponse.json(deliverable, { status: 201 });
}
