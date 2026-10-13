import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deriveAverageViews, deriveEngagementRates } from "@/lib/creatorMetrics";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/authz";
import { getRequestIp } from "@/lib/request";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";
import { itemDetailOf, listItemDetails, listSummary, pitchOrder, rateCardNotReady } from "@/lib/lists/listReview";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { id } = await params;

  const list = await db.creatorList.findFirst({
    where: { id, orgId },
    include: {
      items: {
        include: {
          creator: {
            select: { id: true, name: true, handle: true, platform: true, followersCount: true, averageViews: true, avatarUrl: true },
          },
        },
        orderBy: { addedAt: "desc" },
      },
      _count: { select: { items: true } },
    },
  });

  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Avg views is measured from the posts; Creator.averageViews reads 0 for all
  // but one creator, so rendering it printed a confident fake zero per row.
  const avgViews = await deriveAverageViews(list.items.map((i) => i.creator.id));
  // Measured from posts where there are any; otherwise what the account's own page last said.
  const withViews = <T extends (typeof list.items)[number]>(i: T) => ({
    ...i,
    creator: { ...i.creator, avgViews: avgViews.get(i.creator.id) ?? (i.creator.averageViews || null) },
  });

  if (!(await listApprovalTablesReady())) return NextResponse.json({ ...list, items: list.items.map(withViews) });

  // The rate card: pitch order, each row's rate, note and client verdict, and
  // the list's rolled-up status. Only once the approval tables exist.
  const details = await listItemDetails(orgId, id);
  const [engagement, approval] = await Promise.all([
    deriveEngagementRates(list.items.map((i) => i.creator.id)),
    listSummary(orgId, id, list.items.map((i) => i.id), details),
  ]);
  return NextResponse.json({
    ...list,
    items: pitchOrder(list.items, details).map((i) => {
      const row = withViews(i);
      const d = itemDetailOf(details, i.id);
      return {
        ...row,
        creator: { ...row.creator, engagementRate: engagement.get(i.creator.id) ?? null },
        detail: { ...d, decidedAt: d.decidedAt?.toISOString() ?? null },
      };
    }),
    approval,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  /* Every list write needs creators:create. The gate used to sit inside the
     favourite/archive branch only, so a VIEWER could rename any list. */
  const gate = await requirePermission(req, "creators:create");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const { id } = await params;

  const existing = await db.creatorList.findFirst({ where: { id, orgId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const { name, description } = body;

  // Favourite and archived live on CreatorListDetail, so they need its table.
  const favorite = typeof body?.isFavorite === "boolean" ? (body.isFavorite as boolean) : undefined;
  const archived = typeof body?.archived === "boolean" ? (body.archived as boolean) : undefined;
  if (favorite !== undefined || archived !== undefined) {
    if (!(await listApprovalTablesReady())) return rateCardNotReady();
    const data = {
      ...(favorite !== undefined && { isFavorite: favorite }),
      ...(archived !== undefined && { archivedAt: archived ? new Date() : null }),
    };
    await db.creatorListDetail.upsert({ where: { listId: id }, create: { listId: id, orgId, ...data }, update: data });
    if (archived !== undefined) {
      await logAudit({
        orgId,
        ...getAuditActor(result),
        action: archived ? "list.archive" : "list.unarchive",
        entityType: "creator_list",
        entityId: existing.id,
        entityLabel: existing.name,
        ipAddress: getRequestIp(req),
      });
    }
  }

  const updated = await db.creatorList.update({
    where: { id },
    data: { ...(name && { name }), ...(description !== undefined && { description }) },
  });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "list.update",
    entityType: "creator_list",
    entityId: updated.id,
    entityLabel: updated.name,
    ipAddress: getRequestIp(req),
    before: {
      id: existing.id,
      name: existing.name,
      description: existing.description,
    },
    after: {
      id: updated.id,
      name: updated.name,
      description: updated.description,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(req, "creators:create");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const { id } = await params;

  const existing = await db.creatorList.findFirst({ where: { id, orgId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.creatorListItem.deleteMany({ where: { listId: id } });
  await db.creatorList.delete({ where: { id } });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "list.delete",
    entityType: "creator_list",
    entityId: existing.id,
    entityLabel: existing.name,
    ipAddress: getRequestIp(req),
    before: {
      id: existing.id,
      name: existing.name,
      description: existing.description,
    },
    after: { id: existing.id, deleted: true },
  });

  return NextResponse.json({ success: true });
}
