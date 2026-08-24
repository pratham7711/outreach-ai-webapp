import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

/**
 * One deliverable: mark it done, change when it is due, rename it, or remove it.
 *
 * Ticking one off is a timestamp rather than a boolean, because "when did this
 * land" is the question anyone asks next, and a boolean cannot answer it.
 */

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  notes: z.string().max(2_000).nullable().optional(),
  completed: z.boolean().optional(),
});

/** The deliverable, proven to hang off an activation this org owns. */
async function reach(orgId: string, activationId: string, deliverableId: string) {
  return db.deliverable.findFirst({
    where: {
      id: deliverableId,
      activationId,
      activation: { campaign: { orgId }, deletedAt: null },
    },
    select: {
      id: true, name: true, completedAt: true, dueDate: true, notes: true,
      activation: { select: { id: true, campaignId: true, creator: { select: { name: true } } } },
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; deliverableId: string }> }
) {
  const gate = await requirePermission(request, "campaigns:edit_own");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const { id, deliverableId } = await params;

  const existing = await reach(orgId, id, deliverableId);
  if (!existing) return NextResponse.json({ error: "Deliverable not found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { name, dueDate, notes, completed } = parsed.data;

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (notes !== undefined) data.notes = notes;
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
  if (completed !== undefined) {
    // Re-ticking something already done must not move the date it was done on.
    if (completed) {
      if (!existing.completedAt) data.completedAt = new Date();
    } else {
      data.completedAt = null;
    }
  }

  const updated = await db.deliverable.update({
    where: { id: deliverableId },
    data,
    select: { id: true, name: true, typeDefId: true, dueDate: true, completedAt: true, notes: true, sortOrder: true },
  });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "deliverable.update",
    entityType: "activation",
    entityId: existing.activation.id,
    entityLabel: existing.activation.creator.name,
    ipAddress: getRequestIp(request),
    before: { id: existing.id, name: existing.name, completedAt: existing.completedAt, dueDate: existing.dueDate },
    after: { id: updated.id, name: updated.name, completedAt: updated.completedAt, dueDate: updated.dueDate,
             campaignId: existing.activation.campaignId },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; deliverableId: string }> }
) {
  const gate = await requirePermission(request, "campaigns:edit_own");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const { id, deliverableId } = await params;

  const existing = await reach(orgId, id, deliverableId);
  if (!existing) return NextResponse.json({ error: "Deliverable not found" }, { status: 404 });

  await db.deliverable.delete({ where: { id: deliverableId } });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "deliverable.delete",
    entityType: "activation",
    entityId: existing.activation.id,
    entityLabel: existing.activation.creator.name,
    ipAddress: getRequestIp(request),
    before: { id: existing.id, name: existing.name, campaignId: existing.activation.campaignId },
  });

  return NextResponse.json({ ok: true });
}
