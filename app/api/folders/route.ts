import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

/**
 * Campaign folders — CreatorCore's `Folders 📁` control on the campaigns list.
 *
 * The model and `Campaign.folderId` already existed and the campaign routes
 * already accepted a folderId; nothing had ever created a folder to put a
 * campaign in. This is the missing half.
 *
 * Flat, not nested. `Folder.parentFolderId` exists in the schema and stays
 * unused: the reference's own control is a flat list, and a tree needs cycle
 * handling and a depth story that nothing is asking for yet.
 */

const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

// GET /api/folders — every folder in the org, with how many live campaigns sit
// in it. The count drives the list UI, and it counts only campaigns the list
// itself would show, so a folder of soft-deleted campaigns reads 0 rather than
// advertising rows nobody can open.
export async function GET(request: NextRequest) {
  const result = await authenticateRequest(request);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const [folders, counts] = await Promise.all([
    db.folder.findMany({
      where: { orgId },
      select: { id: true, name: true, createdAt: true },
      orderBy: { name: "asc" },
    }),
    db.campaign.groupBy({
      by: ["folderId"],
      where: { orgId, deletedAt: null, folderId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const countByFolder = new Map(counts.map((c) => [c.folderId, c._count._all]));

  return NextResponse.json({
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      campaigns: countByFolder.get(f.id) ?? 0,
    })),
  });
}

// POST /api/folders
export async function POST(request: NextRequest) {
  const result = await authenticateRequest(request);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const parsed = createFolderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A folder name is required" }, { status: 400 });
  }
  const { name } = parsed.data;

  // No unique index on (orgId, name) in the schema, so two folders called
  // "Q3" are possible at the database level. Rejecting here keeps the picker
  // usable — two identically named folders are indistinguishable in it.
  const clash = await db.folder.findFirst({
    where: { orgId, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (clash) {
    return NextResponse.json({ error: "A folder with that name already exists" }, { status: 409 });
  }

  const folder = await db.folder.create({ data: { orgId, name } });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "folder.create",
    entityType: "folder",
    entityId: folder.id,
    entityLabel: folder.name,
    ipAddress: getRequestIp(request),
    after: { id: folder.id, name: folder.name },
  });

  return NextResponse.json({ id: folder.id, name: folder.name, campaigns: 0 }, { status: 201 });
}
