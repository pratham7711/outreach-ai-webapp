import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";

// GET /api/portal/me — Get current creator user profile
export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await db.creatorUser.findUnique({
      where: { id: session.creatorUserId },
      select: {
        id: true,
        email: true,
        name: true,
        handle: true,
        avatarUrl: true,
        bio: true,
        platform: true,
        followersCount: true,
        averageViews: true,
        rate: true,
        boostRate: true,
        lifetimeEarnings: true,
        cpm: true,
        averageRating: true,
        reviewCount: true,
        niches: true,
        bankAccountName: true,
        createdAt: true,
      },
    });

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    return NextResponse.json(user);
  } catch (error) {
    console.error("Failed to fetch creator profile:", error);
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
  }
}
