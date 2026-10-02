import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { rosterExportRows, spreadsheetResponse } from "@/lib/creators/rosterExport";
import { DECISION_LABELS } from "@/lib/lists/approval";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";
import { itemDetailOf, listItemDetails, pitchOrder } from "@/lib/lists/listReview";

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
    select: { id: true, creatorId: true },
  });
  const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  if (!(await listApprovalTablesReady())) {
    return spreadsheetResponse(await rosterExportRows(orgId, items.map((i) => i.creatorId)), format, list.name);
  }

  // With the rate card in place the file follows the card: its row order, and
  // the list's own rate, the agency's note and the client's verdict at the end.
  const details = await listItemDetails(orgId, id);
  const ordered = pitchOrder(items, details);
  const cells = new Map(
    ordered.map((i) => {
      const d = itemDetailOf(details, i.id);
      return [i.creatorId, [d.rate, d.notes, DECISION_LABELS[d.decision], d.decisionNote]] as [string, (string | number | null)[]];
    }),
  );
  const rows = await rosterExportRows(
    orgId,
    ordered.map((i) => i.creatorId),
    { append: { header: ["List rate (USD)", "Notes", "Client decision", "Client note"], cells } },
  );
  return spreadsheetResponse(rows, format, list.name);
}
