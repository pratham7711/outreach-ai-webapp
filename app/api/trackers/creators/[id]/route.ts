import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";

/**
 * Stop tracking a creator.
 *
 * This clears a flag. It does not delete the creator, their posts or their
 * activations — untracking is a change to a watchlist, and the sound tracker's
 * DELETE (which does remove its rows) is not the precedent to follow here,
 * because a TikTokSound exists only to be tracked and a Creator does not.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;
    const { id } = await params;

    const creator = await db.creator.findFirst({
      where: { id, orgId, deletedAt: null },
      select: { id: true, trackedSince: true },
    });
    if (!creator) return NextResponse.json({ error: "Creator not found" }, { status: 404 });

    // Untracking twice is the same outcome as untracking once.
    if (creator.trackedSince) {
      await db.creator.update({ where: { id: creator.id }, data: { trackedSince: null } });
    }

    return NextResponse.json({ tracked: false });
  } catch (error) {
    console.error("Failed to untrack creator:", error);
    return NextResponse.json({ error: "Failed to untrack creator" }, { status: 500 });
  }
}
