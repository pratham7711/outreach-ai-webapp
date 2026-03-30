import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id } = await params;

  const list = await db.creatorList.findFirst({
    where: { id, orgId },
    include: {
      items: {
        include: {
          creator: {
            select: { id: true, name: true, handle: true, platform: true, followersCount: true, averageViews: true, avatarUrl: true },
          },
        },
        orderBy: { addedAt: "desc" },
      },
      _count: { select: { items: true } },
    },
  });

  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(list);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id } = await params;

  const existing = await db.creatorList.findFirst({ where: { id, orgId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { name, description } = await req.json();
  const updated = await db.creatorList.update({
    where: { id },
    data: { ...(name && { name }), ...(description !== undefined && { description }) },
  });

  await logAudit({
    orgId,
    ...createAuditActor(session),
    action: "list.update",
    entityType: "creator_list",
    entityId: updated.id,
    entityLabel: updated.name,
    ipAddress: getRequestIp(req),
    before: {
      id: existing.id,
      name: existing.name,
      description: existing.description,
    },
    after: {
      id: updated.id,
      name: updated.name,
      description: updated.description,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id } = await params;

  const existing = await db.creatorList.findFirst({ where: { id, orgId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.creatorListItem.deleteMany({ where: { listId: id } });
  await db.creatorList.delete({ where: { id } });

  await logAudit({
    orgId,
    ...createAuditActor(session),
    action: "list.delete",
    entityType: "creator_list",
    entityId: existing.id,
    entityLabel: existing.name,
    ipAddress: getRequestIp(req),
    before: {
      id: existing.id,
      name: existing.name,
      description: existing.description,
    },
    after: { id: existing.id, deleted: true },
  });

  return NextResponse.json({ success: true });
}
