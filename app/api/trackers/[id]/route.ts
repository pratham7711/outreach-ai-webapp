import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";

// ---------- GET /api/trackers/[id] ----------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateRequest(req);
    if (!result)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;
    const { id } = await params;

    const sound = await db.tikTokSound.findFirst({
      where: { id, orgId },
      include: {
        snapshots: {
          orderBy: { recordedAt: "asc" },
        },
      },
    });

    /* 404, not 403. The query is already scoped to the org, so a miss means
       either "no such tracker" or "not yours" — and 403 answers the second out
       loud, confirming to a stranger that the id exists somewhere. It also read
       as a permissions bug to the owner of a tracker they had just deleted. */
    if (!sound)
      return NextResponse.json(
        { error: "Sound not found" },
        { status: 404 }
      );

    return NextResponse.json(sound);
  } catch (error) {
    console.error("Failed to fetch tracker detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch tracker detail" },
      { status: 500 }
    );
  }
}

// ---------- DELETE /api/trackers/[id] ----------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateRequest(req);
    if (!result)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;
    const { id } = await params;

    const sound = await db.tikTokSound.findFirst({
      where: { id, orgId },
    });

    /* 404, not 403. The query is already scoped to the org, so a miss means
       either "no such tracker" or "not yours" — and 403 answers the second out
       loud, confirming to a stranger that the id exists somewhere. It also read
       as a permissions bug to the owner of a tracker they had just deleted. */
    if (!sound)
      return NextResponse.json(
        { error: "Sound not found" },
        { status: 404 }
      );

    // Delete snapshots first, then the sound
    await db.soundTrackerSnapshot.deleteMany({
      where: { soundId: id },
    });

    await db.tikTokSound.delete({
      where: { id },
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete tracker:", error);
    return NextResponse.json(
      { error: "Failed to delete tracker" },
      { status: 500 }
    );
  }
}
