import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId as string;
  const entitlements = await getOrgEntitlements(orgId);
  if (!hasOrgFeature(entitlements, "media_kits")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const kit = await db.mediaKit.findFirst({ where: { id, orgId } });
  if (!kit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.mediaKit.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
