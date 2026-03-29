import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; creatorId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id, creatorId } = await params;

  const list = await db.creatorList.findFirst({ where: { id, orgId } });
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  await db.creatorListItem.deleteMany({
    where: { listId: id, creatorId },
  });

  return NextResponse.json({ success: true });
}
