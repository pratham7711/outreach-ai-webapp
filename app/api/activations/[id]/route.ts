import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { hasPermission } from "@/lib/rbac";
import { httpUrl } from "@/lib/validation/url";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

// Shared with the activations list, which has to offer only reachable statuses.
import { ALLOWED_TRANSITIONS } from "@/lib/activationQueues";

const VALID_STATUSES = ["AWAITING_DRAFT", "DRAFT_SUBMITTED", "AWAITING_APPROVAL", "APPROVED", "POSTING", "POSTED", "COMPLETE", "DECLINED"] as const;

const PatchSchema = z.object({
  status: z.enum(VALID_STATUSES).optional(),
  // One of the org's named activation statuses from Settings → General. Null
  // clears it, leaving the enum bucket as the whole answer.
  statusDefId: z.string().nullable().optional(),
  feedbackNotes: z.string().nullable().optional(),
  postedUrl: httpUrl().optional().nullable(),
  deliverableDueDate: z.string().datetime().optional().nullable(),
  // A draft entered on the creator's behalf, which is how the reference's "Add
  // Draft" works: plenty of creators send a link over DM and somebody on the
  // team files it. draftSubmittedAt is stamped here rather than accepted, so it
  // records when the draft actually arrived in the system.
  draftUrl: httpUrl().optional().nullable(),
  draftCaption: z.string().max(5_000).optional().nullable(),
  draftMediaType: z.enum(["REEL", "STORY", "POST", "SHORT", "VIDEO"]).optional().nullable(),
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

    const { status, statusDefId, feedbackNotes, postedUrl, deliverableDueDate,
            draftUrl, draftCaption, draftMediaType } = parsed.data;

    // A named status carries the bucket it belongs to, so choosing one is also a
    // status change and has to clear the same transition guard. Unlike a
    // campaign, an activation has a state machine: setting "Invited" on
    // something already POSTED would walk backwards through it. The bucket is
    // therefore checked here rather than trusted, and staying inside the current
    // bucket -- renaming POSTED to a different POSTED-bucket status -- is always
    // allowed because it moves nothing.
    let bucketFromDef: (typeof VALID_STATUSES)[number] | undefined;
    if (statusDefId) {
      const def = await db.activationStatusDef.findFirst({
        where: { id: statusDefId, orgId },
        select: { bucket: true, name: true },
      });
      if (!def) return NextResponse.json({ error: "Unknown activation status" }, { status: 400 });
      bucketFromDef = def.bucket as (typeof VALID_STATUSES)[number];
      if (bucketFromDef !== activation.status) {
        const allowed = ALLOWED_TRANSITIONS[activation.status] ?? [];
        if (!allowed.includes(bucketFromDef)) {
          return NextResponse.json(
            { error: `"${def.name}" belongs to ${bucketFromDef}, which cannot follow ${activation.status}` },
            { status: 400 },
          );
        }
      }
    }

    const effectiveStatus = status ?? bucketFromDef;
    if (effectiveStatus && effectiveStatus !== activation.status) {
      const allowed = ALLOWED_TRANSITIONS[activation.status] ?? [];
      if (!allowed.includes(effectiveStatus)) {
        return NextResponse.json({ error: `Cannot transition from ${activation.status} to ${effectiveStatus}` }, { status: 400 });
      }
    }

    const updateData: any = {};
    if (effectiveStatus) updateData.status = effectiveStatus;
    if (statusDefId !== undefined) updateData.statusDefId = statusDefId;
    if (feedbackNotes !== undefined) updateData.feedbackNotes = feedbackNotes;
    if (postedUrl !== undefined) updateData.postedUrl = postedUrl;
    if (deliverableDueDate !== undefined) updateData.deliverableDueDate = deliverableDueDate ? new Date(deliverableDueDate) : null;
    if (draftCaption !== undefined) updateData.draftCaption = draftCaption;
    if (draftMediaType !== undefined) updateData.draftMediaType = draftMediaType;
    if (draftUrl !== undefined) {
      updateData.draftUrl = draftUrl;
      // Stamped when a draft arrives and cleared when it is removed, so the
      // "submitted" date can never outlive the draft it belongs to. An existing
      // stamp is left alone: correcting a typo in the link is not a resubmission.
      if (draftUrl === null) updateData.draftSubmittedAt = null;
      else if (!activation.draftSubmittedAt) updateData.draftSubmittedAt = new Date();
    }

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
        // The campaign activity feed needs both: campaignId to attribute the
        // event to a campaign at all (AuditLog is org-scoped and entityId here
        // is the activation), and creatorId because the reference phrases the
        // event as "<Creator> (@handle) status has been changed to ...".
        campaignId: activation.campaignId,
        creatorId: activation.creatorId,
        status: activation.status,
        feedbackNotes: activation.feedbackNotes,
        postedUrl: activation.postedUrl,
        draftUrl: activation.draftUrl,
      },
      after: {
        id: updated.id,
        campaignId: updated.campaignId,
        creatorId: updated.creatorId,
        status: updated.status,
        feedbackNotes: updated.feedbackNotes,
        postedUrl: updated.postedUrl,
        draftUrl: updated.draftUrl,
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
