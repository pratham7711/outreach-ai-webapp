import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { resolveRosterSelection, rosterSelectionSchema } from "@/lib/creators/rosterSelection";

const bodySchema = z.intersection(
  z.union([
    z.object({ listId: z.string().min(1).max(100) }),
    z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(2000).optional() }),
  ]),
  rosterSelectionSchema,
);

// POST /api/lists/from-roster -- save a roster selection as a new list, or add it to one.
export async function POST(request: NextRequest) {
  const gate = await requirePermission(request, "creators:create");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const existing =
    "listId" in body ? await db.creatorList.findFirst({ where: { id: body.listId, orgId }, select: { id: true, name: true } }) : null;
  if ("listId" in body && !existing) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const target = await resolveRosterSelection(orgId, body);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });
  if (!target.ids.length) return NextResponse.json({ error: "No creators match these filters" }, { status: 400 });

  const created = !existing;
  const list =
    "listId" in body
      ? existing!
      : await db.creatorList.create({
          data: { orgId, name: body.name, description: body.description ?? null },
          select: { id: true, name: true },
        });

  const { count: added } = await db.creatorListItem.createMany({
    data: target.ids.map((creatorId) => ({ listId: list.id, creatorId })),
    skipDuplicates: true,
  });

  await logAudit({
    orgId,
    ...getAuditActor(gate.auth),
    action: created ? "list.create" : "list.add_creators",
    entityType: "creator_list",
    entityId: list.id,
    entityLabel: list.name,
    ipAddress: getRequestIp(request),
    metadata: { fromRoster: true, requested: target.ids.length, added, skippedAsDuplicate: target.ids.length - added },
  });

  return NextResponse.json(
    { listId: list.id, name: list.name, created, added, skipped: target.ids.length - added },
    { status: created ? 201 : 200 },
  );
}
