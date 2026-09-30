import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { countOwnedRows, executeMerge, loadMergeSide, planMerge, summarise } from "@/lib/creators/mergeCreators";

const mergeSchema = z.object({ from: z.string().min(1), dryRun: z.boolean().optional() });

/**
 * POST /api/creators/[id]/merge — fold the duplicate `from` into this creator.
 *
 * `dryRun` answers what would move without writing, which is what the profile
 * shows before the merge is confirmed. Retiring a creator is a delete, so the
 * gate is the delete permission rather than the edit one.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(request, "creators:delete");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;
  const { id } = await params;

  const parsed = mergeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose the creator to merge in." }, { status: 400 });
  const { from, dryRun } = parsed.data;

  const roster = await rosterTablesReady();
  const [keep, drop] = await Promise.all([loadMergeSide(orgId, id, roster), loadMergeSide(orgId, from, roster)]);
  if (!keep || !drop) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const planned = planMerge(keep, drop);
  if (!planned.ok) return NextResponse.json({ error: planned.error }, { status: 409 });

  const owned = await countOwnedRows(drop.id);
  const summary = summarise(planned.plan, owned);
  if (dryRun) return NextResponse.json({ dryRun: true, into: keep.id, from: drop.id, summary });

  await executeMerge(orgId, keep, drop, planned.plan, owned);

  await logAudit({
    orgId,
    ...getAuditActor(gate.auth),
    action: "creator.merge",
    entityType: "creator",
    entityId: keep.id,
    entityLabel: keep.name,
    ipAddress: getRequestIp(request),
    before: {
      kept: { id: keep.id, name: keep.name, handle: keep.handle, platform: keep.platform },
      merged: { id: drop.id, name: drop.name, handle: drop.handle, platform: drop.platform },
    },
    after: { id: keep.id, ...planned.plan.creator, moved: summary },
  });

  return NextResponse.json({ into: keep.id, from: drop.id, summary });
}
