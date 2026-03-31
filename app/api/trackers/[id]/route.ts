import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// ---------- GET /api/trackers/[id] ----------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id } = await params;

    const sound = await db.tikTokSound.findFirst({
      where: { id, orgId },
      include: {
        snapshots: {
          orderBy: { recordedAt: "asc" },
        },
      },
    });

    if (!sound)
      return NextResponse.json(
        { error: "Sound not found" },
        { status: 403 }
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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id } = await params;

    const sound = await db.tikTokSound.findFirst({
      where: { id, orgId },
    });

    if (!sound)
      return NextResponse.json(
        { error: "Sound not found" },
        { status: 403 }
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
