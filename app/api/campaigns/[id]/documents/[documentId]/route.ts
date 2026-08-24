import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

/** Detaching a document from a campaign. */

/** The document, proven to hang off a campaign this org owns. */
async function reach(orgId: string, campaignId: string, documentId: string) {
  return db.document.findFirst({
    where: {
      id: documentId,
      campaignId,
      campaign: { orgId, deletedAt: null },
    },
    select: {
      id: true, name: true, fileUrl: true,
      campaign: { select: { id: true, title: true } },
    },
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const gate = await requirePermission(request, "campaigns:edit_own");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const { id, documentId } = await params;

  const existing = await reach(orgId, id, documentId);
  if (!existing) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  await db.document.delete({ where: { id: documentId } });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "document.delete",
    entityType: "campaign",
    entityId: existing.campaign.id,
    entityLabel: existing.campaign.title,
    ipAddress: getRequestIp(request),
    before: { id: existing.id, name: existing.name, fileUrl: existing.fileUrl },
  });

  return NextResponse.json({ ok: true });
}
