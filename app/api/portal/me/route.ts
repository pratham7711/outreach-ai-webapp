import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { z } from "zod";

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

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  handle: z.string().min(1).regex(/^[a-z0-9_]+$/).optional(),
  bio: z.string().optional(),
  platform: z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"]).optional(),
  niches: z.array(z.enum(["MUSIC", "FASHION", "TECH", "FITNESS", "BEAUTY", "FOOD", "TRAVEL", "GAMING", "COMEDY", "EDUCATION", "LIFESTYLE", "SPORTS"])).optional(),
  bankAccountName: z.string().nullable().optional(),
  bankAccountNumber: z.string().nullable().optional(),
  bankIFSC: z.string().nullable().optional(),
  bankSwift: z.string().nullable().optional(),
  bankRoutingNumber: z.string().nullable().optional(),
});

// PATCH /api/portal/me — Update current creator user profile
export async function PATCH(req: NextRequest) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const data = parsed.data;

    // Handle uniqueness check
    if (data.handle && data.handle !== session.handle) {
      const existing = await db.creatorUser.findUnique({
        where: { handle: data.handle },
      });
      if (existing && existing.id !== session.creatorUserId) {
        return NextResponse.json({ error: "Handle already taken" }, { status: 409 });
      }
    }

    const user = await db.creatorUser.update({
      where: { id: session.creatorUserId },
      data,
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

    return NextResponse.json(user);
  } catch (error) {
    console.error("Failed to update creator profile:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
