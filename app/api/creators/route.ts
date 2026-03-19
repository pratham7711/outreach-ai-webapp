import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { z } from "zod";

const createCreatorSchema = z.object({
  name: z.string().min(1).max(200),
  handle: z.string().min(1).max(100),
  platform: z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"]).optional(),
  contactEmail: z.string().email().optional(),
  bio: z.string().optional(),
  rate: z.number().positive().optional(),
  followersCount: z.number().int().nonnegative().optional(),
  averageViews: z.number().int().nonnegative().optional(),
});

// GET /api/creators
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const search = searchParams.get("search");
    const platform = searchParams.get("platform");
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const limit = parseInt(searchParams.get("limit") ?? "20", 10);
    const skip = (page - 1) * limit;

    const where = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { handle: { contains: search, mode: "insensitive" as const } },
        ],
      }),
      ...(platform && { platform: platform as "TIKTOK" | "INSTAGRAM" | "YOUTUBE" | "TWITTER" }),
      deletedAt: null,
    };

    const [creators, total] = await Promise.all([
      db.creator.findMany({
        where,
        orderBy: { addedAt: "desc" },
        skip,
        take: limit,
      }),
      db.creator.count({ where }),
    ]);

    return NextResponse.json({
      creators,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Failed to fetch creators:", error);
    return NextResponse.json(
      { error: "Failed to fetch creators" },
      { status: 500 }
    );
  }
}

// POST /api/creators
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const parsed = createCreatorSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, handle, platform, contactEmail, bio, rate, followersCount, averageViews } = parsed.data;

    const creator = await db.creator.create({
      data: {
        name,
        handle,
        platform: platform ?? "TIKTOK",
        contactEmail: contactEmail ?? null,
        bio: bio ?? null,
        rate: rate ?? null,
        followersCount: followersCount ?? 0,
        averageViews: averageViews ?? 0,
        orgId: (session.user as any).orgId,
      },
    });

    return NextResponse.json(creator, { status: 201 });
  } catch (error) {
    console.error("Failed to create creator:", error);
    return NextResponse.json(
      { error: "Failed to create creator" },
      { status: 500 }
    );
  }
}
