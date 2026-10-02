import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";
import { listItemDetails, rateCardNotReady } from "@/lib/lists/listReview";

/*
  POST /api/lists/[id]/import-rates -- seed the rate card from each creator's
  standing rate on the roster.

  Only blank cells are filled unless `overwrite: true`: a rate typed into the
  card is a negotiated number, and an import is the shortcut for the rows
  nobody has quoted yet, not a reset.
*/
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(req, "creators:create");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;
  const { id } = await params;

  if (!(await listApprovalTablesReady())) return rateCardNotReady();
  const list = await db.creatorList.findFirst({ where: { id, orgId }, select: { id: true } });
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { overwrite?: unknown } | null;
  const overwrite = body?.overwrite === true;

  const items = await db.creatorListItem.findMany({
    where: { listId: id, creator: { orgId, deletedAt: null } },
    select: { id: true, creator: { select: { rate: true } } },
  });
  const details = await listItemDetails(orgId, id);

  let creatorsWithoutRate = 0;
  const writes: { itemId: string; rate: number }[] = [];
  for (const item of items) {
    const roster = item.creator.rate;
    if (roster == null) {
      creatorsWithoutRate += 1;
      continue;
    }
    if (!overwrite && details.get(item.id)?.rate != null) continue;
    writes.push({ itemId: item.id, rate: roster });
  }

  if (writes.length) {
    await db.$transaction(
      writes.map(({ itemId, rate }) =>
        db.creatorListItemDetail.upsert({
          where: { itemId },
          create: { itemId, listId: id, orgId, rate },
          update: { rate },
        }),
      ),
    );
  }
  return NextResponse.json({ imported: writes.length, skipped: items.length - writes.length, creatorsWithoutRate });
}
