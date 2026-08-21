import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

const renameFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

// PATCH /api/folders/[id] — rename
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await authenticateRequest(request);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { id } = await params;

  const existing = await db.folder.findFirst({ where: { id, orgId }, select: { id: true, name: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = renameFolderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A folder name is required" }, { status: 400 });
  }
  const { name } = parsed.data;

  const clash = await db.folder.findFirst({
    where: { orgId, name: { equals: name, mode: "insensitive" }, id: { not: id } },
    select: { id: true },
  });
  if (clash) {
    return NextResponse.json({ error: "A folder with that name already exists" }, { status: 409 });
  }

  const folder = await db.folder.update({ where: { id }, data: { name } });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "folder.update",
    entityType: "folder",
    entityId: folder.id,
    entityLabel: folder.name,
    ipAddress: getRequestIp(request),
    before: { id: existing.id, name: existing.name },
    after: { id: folder.id, name: folder.name },
  });

  return NextResponse.json({ id: folder.id, name: folder.name });
}

/**
 * DELETE /api/folders/[id] — removes the folder, never its campaigns.
 *
 * A folder is a label, so deleting one empties the label off its campaigns and
 * leaves every campaign where it was. Anything else would let a mis-click on a
 * folder holding 200 campaigns delete 200 campaigns.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await authenticateRequest(request);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { id } = await params;

  const existing = await db.folder.findFirst({ where: { id, orgId }, select: { id: true, name: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Subfolders are not offered by the UI, but the column exists, so anything
  // pointing here is re-parented to nothing rather than orphaned behind a
  // foreign key that would refuse the delete.
  const released = await db.$transaction(async (tx) => {
    const { count } = await tx.campaign.updateMany({
      where: { folderId: id, orgId },
      data: { folderId: null },
    });
    await tx.folder.updateMany({ where: { parentFolderId: id, orgId }, data: { parentFolderId: null } });
    await tx.folder.delete({ where: { id } });
    return count;
  });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "folder.delete",
    entityType: "folder",
    entityId: existing.id,
    entityLabel: existing.name,
    ipAddress: getRequestIp(request),
    before: { id: existing.id, name: existing.name },
    after: { id: existing.id, deleted: true, campaignsReleased: released },
  });

  return NextResponse.json({ success: true, campaignsReleased: released });
}
