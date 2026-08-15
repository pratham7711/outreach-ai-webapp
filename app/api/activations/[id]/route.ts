import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { hasPermission } from "@/lib/rbac";
import { httpUrl } from "@/lib/validation/url";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  AWAITING_DRAFT: ["DRAFT_SUBMITTED", "DECLINED"],
  // A submitted draft can be reviewed, sent back for a redo, or approved/declined outright.
  DRAFT_SUBMITTED: ["AWAITING_APPROVAL", "AWAITING_DRAFT", "APPROVED", "DECLINED"],
  AWAITING_APPROVAL: ["APPROVED", "AWAITING_DRAFT", "DECLINED"],
  APPROVED: ["POSTING"],
  POSTING: ["POSTED"],
  POSTED: ["COMPLETE"],
  DECLINED: ["AWAITING_DRAFT"],
};

const VALID_STATUSES = ["AWAITING_DRAFT", "DRAFT_SUBMITTED", "AWAITING_APPROVAL", "APPROVED", "POSTING", "POSTED", "COMPLETE", "DECLINED"] as const;

const PatchSchema = z.object({
  status: z.enum(VALID_STATUSES).optional(),
  feedbackNotes: z.string().nullable().optional(),
  postedUrl: httpUrl().optional().nullable(),
  deliverableDueDate: z.string().datetime().optional().nullable(),
});

// Approving/declining a creator's draft is a campaign-edit action: managers/owners
// (campaigns:*) on any campaign, members only on campaigns they created.
function canEditCampaign(
  result: { actorType: string; role: string | null; userId: string | null },
  campaignCreatedById: string
) {
  const canEditAny =
    result.actorType === "api_key" ||
    (result.role != null && hasPermission(result.role, "campaigns:edit"));
  return canEditAny || campaignCreatedById === result.userId;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(req, "campaigns:edit_own");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const { id } = await params;

  try {
    const activation = await db.activation.findFirst({
      where: { id, campaign: { orgId } },
      include: { campaign: { select: { createdById: true } } },
    });
    if (!activation) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!canEditCampaign(result, activation.campaign.createdById)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
  const gate = await requirePermission(req, "campaigns:edit_own");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const { id } = await params;

  const activation = await db.activation.findFirst({
    where: { id, campaign: { orgId } },
    include: { campaign: { select: { createdById: true } } },
  });
  if (!activation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!canEditCampaign(result, activation.campaign.createdById)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
