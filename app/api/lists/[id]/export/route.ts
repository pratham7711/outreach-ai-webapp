import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { rosterExportRows, spreadsheetResponse } from "@/lib/creators/rosterExport";

export const maxDuration = 60;

// GET /api/lists/[id]/export?format=xlsx|csv -- the list's members, with the roster's columns.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(request, "creators:read");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;
  const { id } = await params;

  const list = await db.creatorList.findFirst({ where: { id, orgId }, select: { name: true } });
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const items = await db.creatorListItem.findMany({
    where: { listId: id, creator: { orgId, deletedAt: null } },
    orderBy: [{ addedAt: "desc" }, { id: "asc" }],
    select: { creatorId: true },
  });
  const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  return spreadsheetResponse(await rosterExportRows(orgId, items.map((i) => i.creatorId)), format, list.name);
}
