import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

const MAX_PER_REQUEST = 500;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id } = await params;

  const list = await db.creatorList.findFirst({ where: { id, orgId } });
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { creatorId, creatorIds } = body ?? {};
  const raw: unknown[] = Array.isArray(creatorIds) ? creatorIds : creatorId ? [creatorId] : [];
  // Deduplicated, so the org-membership count below compares like with like.
  const ids: string[] = Array.from(new Set(raw.filter((v): v is string => typeof v === "string" && v.length > 0)));

  if (!ids.length) return NextResponse.json({ error: "creatorId(s) required" }, { status: 400 });
  if (ids.length > MAX_PER_REQUEST) {
    return NextResponse.json({ error: `At most ${MAX_PER_REQUEST} creators per request` }, { status: 400 });
  }

  const creators = await db.creator.findMany({
    where: { id: { in: ids }, orgId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (creators.length !== ids.length) {
    return NextResponse.json({ error: "One or more creators were not found in this organization" }, { status: 404 });
  }

  // One round trip for a bulk add; a creator already on the list is a no-op.
  const { count: added } = await db.creatorListItem.createMany({
    data: ids.map((cId) => ({ listId: id, creatorId: cId })),
    skipDuplicates: true,
  });

  await logAudit({
    orgId,
    ...createAuditActor(session),
    action: "list.add_creators",
    entityType: "creator_list",
    entityId: list.id,
    entityLabel: list.name,
    ipAddress: getRequestIp(req),
    metadata: {
      requestedCreatorIds: ids,
      added,
      skippedAsDuplicate: ids.length - added,
    },
    after: {
      listId: list.id,
      creatorIds: creators.map((creator) => creator.id),
    },
  });

  return NextResponse.json({ added, skipped: ids.length - added }, { status: 201 });
}
