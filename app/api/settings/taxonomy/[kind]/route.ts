import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { TAXONOMY_KINDS, isTaxonomyKind, seedReferenceDefaults } from "@/lib/taxonomy";

/**
 * Settings → General, the reference's six org-configurable lists.
 * See lib/taxonomy.ts for why one route covers all six.
 *
 * Reading is open to any member — these lists populate the pickers on the
 * campaign and creator forms, so a MEMBER who cannot administer them still has
 * to be able to choose from them. Writing is administration and goes through
 * the same `settings:*` gate as every other settings route (audit-log,
 * trackers): before this, any member could rename or delete an org's statuses.
 */

// GET /api/settings/taxonomy/[kind]
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const result = await authenticateRequest(request);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const { kind } = await params;
  if (!isTaxonomyKind(kind)) return NextResponse.json({ error: "Unknown list" }, { status: 404 });
  const spec = TAXONOMY_KINDS[kind];

  /* A brand-new org has no rows in any of these tables, so every picker in the
     product renders empty until somebody thinks to visit Settings → General.
     The reference ships an org with a starter set; seeding it on the first read
     is what makes that true here without a migration or an org-creation hook to
     backfill for the orgs that already exist. Idempotent and org-scoped: it
     only ever fires against a list this org has left completely empty. */
  await seedReferenceDefaults(kind, orgId);

  const items = await spec.delegate().findMany({
    where: { orgId },
    select: spec.select,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({ items });
}

// POST /api/settings/taxonomy/[kind]
export async function POST(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const gate = await requirePermission(request, "settings:*");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
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
