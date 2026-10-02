import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/lib/authz";
import { parseRateInput } from "@/lib/lists/approval";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";
import { rateCardNotReady } from "@/lib/lists/listReview";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; creatorId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id, creatorId } = await params;

  const list = await db.creatorList.findFirst({ where: { id, orgId } });
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  await db.creatorListItem.deleteMany({
    where: { listId: id, creatorId },
  });

  return NextResponse.json({ success: true });
}

const MAX_NOTES = 2000;

/*
  PATCH -- one rate-card row: the rate quoted for this creator on this list, and
  the agency's own note. Both are snapshots on the list rather than pointers at
  Creator.rate: editing a creator's standing rate months later must not rewrite
  what a client already approved. The client's verdict is not settable here;
  that is theirs, through the share link.
*/
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; creatorId: string }> }) {
  const gate = await requirePermission(req, "creators:create");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;
  const { id, creatorId } = await params;

  if (!(await listApprovalTablesReady())) return rateCardNotReady();
  const list = await db.creatorList.findFirst({ where: { id, orgId }, select: { id: true } });
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const data: { rate?: number | null; notes?: string | null } = {};
  if (body && "rate" in body) {
    const parsed = parseRateInput(body.rate);
    if (!parsed.ok) return NextResponse.json({ error: "Rate must be an amount between 0 and 10,000,000" }, { status: 400 });
    data.rate = parsed.rate;
  }
  if (body && "notes" in body) {
    if (body.notes !== null && typeof body.notes !== "string") return NextResponse.json({ error: "Notes must be text" }, { status: 400 });
    const notes = (body.notes ?? "").trim();
    if (notes.length > MAX_NOTES) return NextResponse.json({ error: "Note is too long" }, { status: 400 });
    data.notes = notes || null;
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const item = await db.creatorListItem.findFirst({
    where: { listId: id, creatorId, creator: { orgId, deletedAt: null } },
    select: { id: true },
  });
  if (!item) return NextResponse.json({ error: "Creator not found on this list" }, { status: 404 });

  const saved = await db.creatorListItemDetail.upsert({
    where: { itemId: item.id },
    create: { itemId: item.id, listId: id, orgId, ...data },
    update: data,
    select: { rate: true, notes: true },
  });
  return NextResponse.json(saved);
}
