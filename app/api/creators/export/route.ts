import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { MAX_BULK_CREATORS, resolveRosterSelection } from "@/lib/creators/rosterSelection";
import { rosterExportRows, spreadsheetResponse } from "@/lib/creators/rosterExport";

export const maxDuration = 60;

// GET /api/creators/export?format=xlsx|csv&<roster filters>  or  &ids=a,b,c
export async function GET(request: NextRequest) {
  const gate = await requirePermission(request, "creators:read");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;

  const sp = new URLSearchParams(request.nextUrl.searchParams);
  const format = sp.get("format") === "csv" ? "csv" : "xlsx";
  const ids = sp.get("ids");
  sp.delete("format");
  sp.delete("ids");

  const picked = ids?.split(",").filter(Boolean) ?? null;
  if (picked && picked.length > MAX_BULK_CREATORS) {
    return NextResponse.json({ error: `Export at most ${MAX_BULK_CREATORS} creators at a time` }, { status: 413 });
  }
  const target = await resolveRosterSelection(orgId, picked ? { creatorIds: picked } : { query: sp.toString() });
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });

  return spreadsheetResponse(await rosterExportRows(orgId, target.ids), format, "Creator roster");
}
