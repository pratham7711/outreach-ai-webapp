import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuditActor } from "@/lib/authenticate";
import { requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { isMissingTemplatesTable } from "@/lib/campaigns/templates/ddl";
import { TEMPLATE_DESCRIPTION_MAX, TEMPLATE_NAME_MAX } from "@/lib/campaigns/templates/payload";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "Template not found" }, { status: 404 });

const renameSchema = z
  .object({
    name: z.string().trim().min(1, "Give the template a name").max(TEMPLATE_NAME_MAX).optional(),
    description: z.string().trim().max(TEMPLATE_DESCRIPTION_MAX).nullable().optional(),
  })
  .refine((b) => b.name !== undefined || b.description !== undefined, { message: "Send a name or a description" });

/** PATCH /api/campaign-templates/[id] -- renames a template, or changes its description. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await requirePermission(request, "campaigns:create");
    if (!gate.ok) return gate.response;
    const auth = gate.auth;
    const { id } = await params;

    const parsed = renameSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }

    try {
      const before = await db.campaignTemplate.findFirst({
        where: { id, orgId: auth.orgId, deletedAt: null },
        select: { id: true, name: true, description: true },
      });
      if (!before) return notFound();
      const data = {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description || null } : {}),
      };
      /* orgId in the write as well as the read: the id alone never decides
         whose row changes. */
      const updated = await db.campaignTemplate.updateMany({ where: { id, orgId: auth.orgId, deletedAt: null }, data });
      if (updated.count === 0) return notFound();
      const after = { ...before, ...data };
      await logAudit({
        orgId: auth.orgId,
        ...getAuditActor(auth),
        action: "campaign_template.update",
        entityType: "campaign_template",
        entityId: id,
        entityLabel: after.name,
        ipAddress: getRequestIp(request),
        before: { name: before.name, description: before.description },
        after: { name: after.name, description: after.description },
      });
      return NextResponse.json({ template: after });
    } catch (e) {
      if (isMissingTemplatesTable(e)) return notFound();
      throw e;
    }
  } catch (error) {
    console.error("Failed to rename campaign template:", error);
    return NextResponse.json({ error: "Failed to rename the template" }, { status: 500 });
  }
}

/** DELETE /api/campaign-templates/[id] -- removes a template. Campaigns started from it keep their setup. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await requirePermission(request, "campaigns:create");
    if (!gate.ok) return gate.response;
    const auth = gate.auth;
    const { id } = await params;

    try {
      const row = await db.campaignTemplate.findFirst({
        where: { id, orgId: auth.orgId, deletedAt: null },
        select: { name: true },
      });
      if (!row) return notFound();
      const removed = await db.campaignTemplate.updateMany({
        where: { id, orgId: auth.orgId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (removed.count === 0) return notFound();
      await logAudit({
        orgId: auth.orgId,
        ...getAuditActor(auth),
        action: "campaign_template.delete",
        entityType: "campaign_template",
        entityId: id,
        entityLabel: row.name,
        ipAddress: getRequestIp(request),
      });
      return NextResponse.json({ ok: true });
    } catch (e) {
      if (isMissingTemplatesTable(e)) return notFound();
      throw e;
    }
  } catch (error) {
    console.error("Failed to delete campaign template:", error);
    return NextResponse.json({ error: "Failed to delete the template" }, { status: 500 });
  }
}
