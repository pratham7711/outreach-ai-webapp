import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/creators/[handle]/reviews — Public endpoint, no auth required
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    const { handle } = await params;

    // Find all Creator records with this handle across orgs
    const creators = await db.creator.findMany({
      where: { handle },
      select: { id: true },
    });

    if (creators.length === 0) {
      return NextResponse.json({ reviews: [] });
    }

    const creatorIds = creators.map((c) => c.id);

    const reviews = await db.creatorReview.findMany({
      where: { creatorId: { in: creatorIds } },
      include: {
        org: { select: { name: true } },
        campaign: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ reviews });
  } catch (error) {
    console.error("Failed to fetch creator reviews:", error);
    return NextResponse.json({ error: "Failed to fetch reviews" }, { status: 500 });
  }
}
