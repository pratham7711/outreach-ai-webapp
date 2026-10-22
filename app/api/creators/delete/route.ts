import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { deleteCreators } from "@/lib/creators/deleteCreators";

/* Ticked rows only. "Everything this filter matches" is not accepted: a
   filter is easy to get wrong and a delete is the one bulk action the roster
   cannot take back. */
const MAX_BULK_DELETE = 500;
const bodySchema = z.object({ creatorIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_BULK_DELETE) });

// POST /api/creators/delete -- take the ticked creators off the roster.
export async function POST(request: NextRequest) {
  const gate = await requirePermission(request, "creators:delete");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: `Tick between 1 and ${MAX_BULK_DELETE} creators to delete.` }, { status: 400 });
  }
  const requested = new Set(parsed.data.creatorIds).size;
  const out = await deleteCreators(orgId, parsed.data.creatorIds);

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
      },
    });
  }

  return NextResponse.json({ requested, deleted: out.deleted.length });
}
