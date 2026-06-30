import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { z } from "zod";

function computeStatus(velocityScore: number): string {
  if (velocityScore >= 100) return "viral";
  if (velocityScore >= 50) return "trending";
  if (velocityScore >= 0) return "stable";
  return "declining";
}

function computeGrowthPercentage(
  latest: { usesCount: number; deltaUses24h: number } | null
): number {
  if (!latest) return 0;
  const previous = latest.usesCount - latest.deltaUses24h;
  if (previous <= 0) return 0;
  return Math.round((latest.deltaUses24h / previous) * 10000) / 100;
}

// ---------- GET /api/trackers ----------
export async function GET(req: NextRequest) {
  try {
    const result = await authenticateRequest(req);
    if (!result)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const sounds = await db.tikTokSound.findMany({
      where: { orgId },
      include: {
        snapshots: {
          orderBy: { recordedAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const mapped = sounds.map((sound) => {
      const latest = sound.snapshots[0] ?? null;
      return {
        ...sound,
        latestSnapshot: latest,
        status: latest ? computeStatus(latest.velocityScore) : "stable",
        growthPercentage: computeGrowthPercentage(latest),
      };
    });

    return NextResponse.json({ sounds: mapped });
  } catch (error) {
    console.error("Failed to fetch trackers:", error);
    return NextResponse.json(
      { error: "Failed to fetch trackers" },
      { status: 500 }
    );
  }
}

// ---------- POST /api/trackers ----------
const createSoundSchema = z.object({
  tiktokSoundId: z.string().min(1),
  title: z.string().min(1),
  artist: z.string().min(1),
  coverImageUrl: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const result = await authenticateRequest(req);
    if (!result)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const body = await req.json();
    const parsed = createSoundSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const sound = await db.tikTokSound.create({
      data: {
        orgId,
        tiktokSoundId: parsed.data.tiktokSoundId,
        title: parsed.data.title,
        artist: parsed.data.artist,
        coverImageUrl: parsed.data.coverImageUrl ?? null,
      },
    });

    return NextResponse.json(sound, { status: 201 });
  } catch (error) {
    console.error("Failed to create tracked sound:", error);
    return NextResponse.json(
      { error: "Failed to create tracked sound" },
      { status: 500 }
    );
  }
}
