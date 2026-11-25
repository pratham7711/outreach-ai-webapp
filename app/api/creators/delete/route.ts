import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { deleteCreators } from "@/lib/creators/deleteCreators";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { creatorSourceWhere, creatorWhere, readCreatorFilters } from "@/lib/listFilters";

/* Ticked rows, or every manual entry a filter matches. A filter is easy to get
   wrong and a delete is the one bulk action the roster cannot take back, so
   "all matching" is accepted only on the Manual entries tab, and the server
   adds the manual rule itself: a creator who signed up is never in it, whatever
   the query says. Those go 500 a call; the client calls again until none are
   left. */
const MAX_BULK_DELETE = 500;
const bodySchema = z.union([
  z.object({ creatorIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_BULK_DELETE) }),
  z.object({ query: z.string().max(4000) }),
]);

// POST /api/creators/delete -- take the ticked creators off the roster.
export async function POST(request: NextRequest) {
  const gate = await requirePermission(request, "creators:delete");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: `Tick between 1 and ${MAX_BULK_DELETE} creators to delete.` }, { status: 400 });
  }
  let ids: string[];
  let manualWhere: ReturnType<typeof creatorWhere> | null = null;
  if ("creatorIds" in parsed.data) {
    ids = parsed.data.creatorIds;
  } else {
    const filters = readCreatorFilters(Object.fromEntries(new URLSearchParams(parsed.data.query)));
    if (filters.source !== "manual") {
      return NextResponse.json({ error: "Only manual entries can be deleted all at once. Tick the creators to delete instead." }, { status: 400 });
    }
    manualWhere = { AND: [creatorWhere(orgId, filters, { roster: await rosterTablesReady() }), creatorSourceWhere("manual")] };
    const batch = await db.creator.findMany({ where: manualWhere, select: { id: true }, orderBy: { id: "asc" }, take: MAX_BULK_DELETE });
    ids = batch.map((c) => c.id);
    if (!ids.length) return NextResponse.json({ requested: 0, deleted: 0, remaining: 0 });
  }
  const requested = new Set(ids).size;
  const out = await deleteCreators(orgId, ids);

  if (out.deleted.length) {
    await logAudit({
      orgId,
      ...getAuditActor(gate.auth),
      action: "creators.delete",
      entityType: "creator",
      entityLabel: `${out.deleted.length} creator${out.deleted.length === 1 ? "" : "s"}`,
      ipAddress: getRequestIp(request),
      metadata: {
        requested,
        deleted: out.deleted.map((c) => ({ id: c.id, name: c.name, handle: c.handle, platform: c.platform })),
        profileLinksRemoved: out.profileLinksRemoved,
        listEntriesRemoved: out.listEntriesRemoved,
        ...(manualWhere && { scope: "manual entries" }),
      },
    });
  }

  const remaining = manualWhere ? await db.creator.count({ where: manualWhere }) : undefined;
  return NextResponse.json({ requested, deleted: out.deleted.length, ...(remaining !== undefined && { remaining }) });
}
