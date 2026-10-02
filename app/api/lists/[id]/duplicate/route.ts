import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";
import { itemDetailOf, listItemDetails, pitchOrder, rateCardNotReady } from "@/lib/lists/listReview";

const bodySchema = z
  .object({
    name: z.string().max(200).optional(),
    scope: z.enum(["approved", "all"]).optional(),
  })
  .strict();

/*
  POST /api/lists/[id]/duplicate -- a new pitch list from an old one.

  The point is the approved case: a client has been through a pitch and said
  yes to eight of twelve creators, and the next campaign starts from those
  eight. So `scope: "approved"` is the interesting mode and "all" is the plain
  copy. Rates and the agency's notes travel with the rows -- re-quoting eight
  approved creators from scratch is the work this saves -- and every verdict
  starts over as pending, because the copy is a new pitch.

  The copy never inherits the share link. A token is the client's URL for one
  specific pitch, and sharing it across two lists would let a decision on one
  silently land on the other.
*/
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(req, "creators:create");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;
  const { id } = await params;

  if (!(await listApprovalTablesReady())) return rateCardNotReady();
  const source = await db.creatorList.findFirst({ where: { id, orgId }, select: { id: true, name: true, description: true } });
  if (!source) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const parsed = bodySchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const scope = parsed.data.scope ?? "all";
  const name = parsed.data.name?.trim() || `${source.name} (Copy)`.slice(0, 200);

  const sourceItems = await db.creatorListItem.findMany({
    where: { listId: id, creator: { orgId, deletedAt: null } },
    orderBy: [{ addedAt: "desc" }, { id: "asc" }],
    select: { id: true, creatorId: true },
  });
  const details = await listItemDetails(orgId, id);
  const ordered = pitchOrder(sourceItems, details);
  const picked = scope === "approved" ? ordered.filter((i) => itemDetailOf(details, i.id).decision === "APPROVED") : ordered;

  // An approved-only copy that is empty would be a list whose name promises
  // creators it does not have. Say so instead.
  if (scope === "approved" && !picked.length) {
    return NextResponse.json({ error: "No creators on this list have been approved yet" }, { status: 409 });
  }

  const copy = await db.$transaction(async (tx) => {
    const list = await tx.creatorList.create({ data: { orgId, name, description: source.description } });
    await tx.creatorListDetail.create({ data: { listId: list.id, orgId, duplicatedFromId: source.id } });
    if (picked.length) {
      await tx.creatorListItem.createMany({ data: picked.map((i) => ({ listId: list.id, creatorId: i.creatorId })) });
      const created = await tx.creatorListItem.findMany({ where: { listId: list.id }, select: { id: true, creatorId: true } });
      const newItemBy = new Map(created.map((i) => [i.creatorId, i.id]));
      await tx.creatorListItemDetail.createMany({
        data: picked.flatMap((item, index) => {
          const itemId = newItemBy.get(item.creatorId);
          if (!itemId) return [];
          const { rate, notes } = itemDetailOf(details, item.id);
          // Re-indexed rather than copied: an approved-only copy drops rows,
          // and carrying the gaps over would order the new card 0, 3, 7, 8.
          return [{ itemId, listId: list.id, orgId, rate, notes, sortOrder: index }];
        }),
      });
    }
    return list;
  });

  await logAudit({
    orgId,
    ...getAuditActor(gate.auth),
    action: "list.duplicate",
    entityType: "creator_list",
    entityId: copy.id,
    entityLabel: copy.name,
    ipAddress: getRequestIp(req),
    metadata: { sourceListId: source.id, scope, creatorsCopied: picked.length },
    after: { id: copy.id, name: copy.name, duplicatedFromId: source.id },
  });

  return NextResponse.json({ list: { id: copy.id, name: copy.name, creators: picked.length } }, { status: 201 });
}
