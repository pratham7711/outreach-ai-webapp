import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { TAXONOMY_KINDS, isTaxonomyKind } from "@/lib/taxonomy";

/**
 * Settings → General, the reference's six org-configurable lists.
 * See lib/taxonomy.ts for why one route covers all six.
 */

// GET /api/settings/taxonomy/[kind]
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const result = await authenticateRequest(request);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const { kind } = await params;
  if (!isTaxonomyKind(kind)) return NextResponse.json({ error: "Unknown list" }, { status: 404 });
  const spec = TAXONOMY_KINDS[kind];

  const items = await spec.delegate().findMany({
    where: { orgId },
    select: spec.select,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({ items });
}

// POST /api/settings/taxonomy/[kind]
export async function POST(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const result = await authenticateRequest(request);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const { kind } = await params;
  if (!isTaxonomyKind(kind)) return NextResponse.json({ error: "Unknown list" }, { status: 404 });
  const spec = TAXONOMY_KINDS[kind];

  const parsed = spec.fields.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid values" },
      { status: 400 },
    );
  }

  // (orgId, name) is unique in the schema, but a case-different duplicate would
  // still get through and be indistinguishable in the pickers these lists feed.
  const clash = await spec.delegate().findFirst({
    where: { orgId, name: { equals: parsed.data.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (clash) return NextResponse.json({ error: "That name is already in this list" }, { status: 409 });

  const created = (await spec.delegate().create({
    data: { orgId, ...parsed.data },
    select: spec.select,
  })) as { id: string; name: string };

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: `${spec.auditType}.create`,
    entityType: spec.auditType,
    entityId: created.id,
    entityLabel: created.name,
    ipAddress: getRequestIp(request),
    after: created as Record<string, unknown>,
  });

  return NextResponse.json(created, { status: 201 });
}
