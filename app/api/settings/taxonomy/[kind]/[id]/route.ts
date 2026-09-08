import { NextRequest, NextResponse } from "next/server";
import { getAuditActor } from "@/lib/authenticate";
import { requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { TAXONOMY_KINDS, isTaxonomyKind } from "@/lib/taxonomy";

/**
 * Rename/reorder and remove, for any of the six lists in Settings → General.
 *
 * Both verbs are administration, so both go through the `settings:*` gate that
 * the rest of the settings routes use. Deleting a definition rewrites what
 * every campaign and creator in the org is labelled with; that was reachable by
 * any MEMBER until this gate went in.
 */

// PATCH /api/settings/taxonomy/[kind]/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  const gate = await requirePermission(request, "settings:*");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;

  const { kind, id } = await params;
  if (!isTaxonomyKind(kind)) return NextResponse.json({ error: "Unknown list" }, { status: 404 });
  const spec = TAXONOMY_KINDS[kind];

  // Scoped by orgId, so one org can never address another's row by id.
  const existing = (await spec.delegate().findFirst({
    where: { id, orgId },
    select: spec.select,
  })) as { id: string; name: string } | null;
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = spec.fields.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid values" },
      { status: 400 },
    );
  }

  if (parsed.data.name) {
    const clash = await spec.delegate().findFirst({
      where: { orgId, name: { equals: parsed.data.name, mode: "insensitive" }, id: { not: id } },
      select: { id: true },
    });
    if (clash) return NextResponse.json({ error: "That name is already in this list" }, { status: 409 });
  }

  const updated = (await spec.delegate().update({
    where: { id },
    data: parsed.data,
    select: spec.select,
  })) as { id: string; name: string };

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: `${spec.auditType}.update`,
    entityType: spec.auditType,
    entityId: updated.id,
    entityLabel: updated.name,
    ipAddress: getRequestIp(request),
    before: existing as unknown as Record<string, unknown>,
    after: updated as unknown as Record<string, unknown>,
  });

  return NextResponse.json(updated);
}

// DELETE /api/settings/taxonomy/[kind]/[id]
//
// A hard delete, deliberately. These are definitions, not records: the links to
// creators and campaigns cascade, and the two status pointers are ON DELETE SET
// NULL, so a campaign whose named status goes away falls back to the enum bucket
// it always had rather than being left pointing at nothing.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  const gate = await requirePermission(request, "settings:*");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;

  const { kind, id } = await params;
  if (!isTaxonomyKind(kind)) return NextResponse.json({ error: "Unknown list" }, { status: 404 });
  const spec = TAXONOMY_KINDS[kind];

  const existing = (await spec.delegate().findFirst({
    where: { id, orgId },
    select: spec.select,
  })) as { id: string; name: string } | null;
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await spec.delegate().delete({ where: { id } });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: `${spec.auditType}.delete`,
    entityType: spec.auditType,
    entityId: existing.id,
    entityLabel: existing.name,
    ipAddress: getRequestIp(request),
    before: existing as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ success: true });
}
