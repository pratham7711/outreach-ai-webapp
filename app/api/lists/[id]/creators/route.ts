import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id } = await params;

  const list = await db.creatorList.findFirst({ where: { id, orgId } });
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const { creatorId, creatorIds } = await req.json();
  const ids = creatorIds ?? (creatorId ? [creatorId] : []);

  if (!ids.length) return NextResponse.json({ error: "creatorId(s) required" }, { status: 400 });

  const creators = await db.creator.findMany({
    where: { id: { in: ids }, orgId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (creators.length !== ids.length) {
    return NextResponse.json({ error: "One or more creators were not found in this organization" }, { status: 404 });
  }

  const results = [];
  for (const cId of ids) {
    try {
      const item = await db.creatorListItem.create({
        data: { listId: id, creatorId: cId },
      });
      results.push(item);
    } catch {
      // Duplicate — skip
    }
  }

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
      added: results.length,
    },
    after: {
      listId: list.id,
      creatorIds: creators.map((creator) => creator.id),
    },
  });

  return NextResponse.json({ added: results.length }, { status: 201 });
}
