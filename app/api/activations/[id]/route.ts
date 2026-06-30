import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  AWAITING_DRAFT: ["DRAFT_SUBMITTED", "DECLINED"],
  DRAFT_SUBMITTED: ["AWAITING_APPROVAL", "AWAITING_DRAFT"],
  AWAITING_APPROVAL: ["APPROVED", "AWAITING_DRAFT", "DECLINED"],
  APPROVED: ["POSTING"],
  POSTING: ["POSTED"],
  POSTED: ["COMPLETE"],
  DECLINED: ["AWAITING_DRAFT"],
};

const VALID_STATUSES = ["AWAITING_DRAFT", "DRAFT_SUBMITTED", "AWAITING_APPROVAL", "APPROVED", "POSTING", "POSTED", "COMPLETE", "DECLINED"] as const;

const PatchSchema = z.object({
  status: z.enum(VALID_STATUSES).optional(),
  feedbackNotes: z.string().optional(),
  postedUrl: z.string().url().optional().nullable(),
  deliverableDueDate: z.string().datetime().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { id } = await params;

  try {
    const activation = await db.activation.findFirst({
      where: { id, campaign: { orgId } },
    });
    if (!activation) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const { status, feedbackNotes, postedUrl, deliverableDueDate } = parsed.data;

    if (status) {
      const allowed = ALLOWED_TRANSITIONS[activation.status] ?? [];
      if (!allowed.includes(status)) {
        return NextResponse.json({ error: `Cannot transition from ${activation.status} to ${status}` }, { status: 400 });
      }
    }

    const updateData: any = {};
    if (status) updateData.status = status;
    if (feedbackNotes !== undefined) updateData.feedbackNotes = feedbackNotes;
    if (postedUrl !== undefined) updateData.postedUrl = postedUrl;
    if (deliverableDueDate !== undefined) updateData.deliverableDueDate = deliverableDueDate ? new Date(deliverableDueDate) : null;

    const updated = await db.activation.update({ where: { id }, data: updateData });

    await logAudit({
      orgId,
      ...getAuditActor(result),
      action: "activation.update",
      entityType: "activation",
      entityId: updated.id,
      entityLabel: updated.id,
      ipAddress: getRequestIp(req),
      before: {
        id: activation.id,
        status: activation.status,
        feedbackNotes: activation.feedbackNotes,
        postedUrl: activation.postedUrl,
      },
      after: {
        id: updated.id,
        status: updated.status,
        feedbackNotes: updated.feedbackNotes,
        postedUrl: updated.postedUrl,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Failed to update activation:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { id } = await params;

  const activation = await db.activation.findFirst({ where: { id, campaign: { orgId } } });
  if (!activation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.activation.update({ where: { id }, data: { deletedAt: new Date() } });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "activation.delete",
    entityType: "activation",
    entityId: activation.id,
    entityLabel: activation.id,
    ipAddress: getRequestIp(req),
    before: {
      id: activation.id,
      status: activation.status,
      deletedAt: activation.deletedAt,
    },
    after: {
      id: activation.id,
      deleted: true,
    },
  });

  return NextResponse.json({ success: true });
}
