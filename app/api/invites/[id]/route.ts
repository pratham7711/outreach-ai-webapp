import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// DELETE /api/invites/[id] — Cancel/delete an invite
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;

    const { id } = await params;

    const invite = await db.userInvite.findUnique({ where: { id } });

    if (!invite || invite.orgId !== orgId) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    await db.userInvite.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete invite:", error);
    return NextResponse.json({ error: "Failed to delete invite" }, { status: 500 });
  }
}
