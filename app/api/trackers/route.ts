import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { z } from "zod";
import {
  changeOverWindow,
  isTrackerWindow,
  statusFor,
  type TrackerSnapshot,
  type WindowChange,
} from "@/lib/trackers/metrics";

const SORTS = ["velocity", "uses", "added"] as const;
type SortKey = (typeof SORTS)[number];

function parseSort(value: string | null): SortKey {
  return SORTS.includes(value as SortKey) ? (value as SortKey) : "velocity";
}

function sortValue(
  row: { latestSnapshot: { usesCount: number } | null; change: WindowChange | null },
  key: SortKey
): number | null {
  if (key === "uses") return row.latestSnapshot?.usesCount ?? null;
  if (key === "added") return row.change?.added ?? null;
  return row.change?.velocityPerHour ?? null;
}

// ---------- GET /api/trackers ----------
export async function GET(req: NextRequest) {
  try {
    const result = await authenticateRequest(req);
    if (!result)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const periodParam = req.nextUrl.searchParams.get("period");
    const period = periodParam && isTrackerWindow(periodParam) ? periodParam : "24h";
    const sort = parseSort(req.nextUrl.searchParams.get("sort"));
    const now = new Date();

    const sounds = await db.tikTokSound.findMany({
      where: { orgId },
      include: {
        snapshots: {
          orderBy: { recordedAt: "desc" },
          take: 60,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const mapped = sounds.map((sound) => {
      const history: TrackerSnapshot[] = sound.snapshots.map((s) => ({
        value: s.usesCount,
        recordedAt: s.recordedAt,
      }));
      const change = changeOverWindow(history, period, now);
      const latest = sound.snapshots[0] ?? null;

      return {
        ...sound,
        latestSnapshot: latest,
        change,
        status: statusFor(change?.velocityPerHour ?? null),
        growthPercentage: change?.percent ?? null,
        addedInPeriod: change?.added ?? null,
        snapshotCount: sound.snapshots.length,
      };
    });

    // Unknown sinks to the bottom: a tracker with no history must never outrank a
    // measured one just because null sorts high.
    const sorted = [...mapped].sort((a, b) => {
      const av = sortValue(a, sort);
      const bv = sortValue(b, sort);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });

    return NextResponse.json({ sounds: sorted, period, sort });
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
