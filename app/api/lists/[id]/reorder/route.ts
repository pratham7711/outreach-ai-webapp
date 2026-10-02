import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";
import { rateCardNotReady } from "@/lib/lists/listReview";

const bodySchema = z.object({ creatorIds: z.array(z.string().min(1)).min(1).max(2000) }).strict();

/*
  POST /api/lists/[id]/reorder -- the rate card's row order, as the full list of
  creator ids top to bottom.

  It must name every creator on the list exactly once. A partial order would
  leave the omitted rows holding stale positions that collide with the new
  ones, so it is refused (409) rather than half-applied.
*/
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(req, "creators:create");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;
  const { id } = await params;

  if (!(await listApprovalTablesReady())) return rateCardNotReady();
  const list = await db.creatorList.findFirst({ where: { id, orgId }, select: { id: true } });
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "creatorIds required" }, { status: 400 });
  const order = parsed.data.creatorIds;
  if (new Set(order).size !== order.length) return NextResponse.json({ error: "Each creator may appear once" }, { status: 400 });

  const items = await db.creatorListItem.findMany({
    where: { listId: id, creator: { orgId, deletedAt: null } },
    select: { id: true, creatorId: true },
  });
  const itemBy = new Map(items.map((i) => [i.creatorId, i.id]));
  if (order.length !== items.length || order.some((c) => !itemBy.has(c))) {
    return NextResponse.json({ error: "The order must name every creator on this list" }, { status: 409 });
  }

  await db.$transaction(
    order.map((creatorId, sortOrder) => {
      const itemId = itemBy.get(creatorId)!;
      return db.creatorListItemDetail.upsert({
        where: { itemId },
        create: { itemId, listId: id, orgId, sortOrder },
        update: { sortOrder },
      });
    }),
  );
  return NextResponse.json({ ok: true });
}
