import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { z } from "zod";
import {
  changeOverWindow,
  isMeasurable,
  isTrackerWindow,
  readHealthFor,
  statusFor,
  windowHours,
  type TrackerSnapshot,
  type WindowChange,
} from "@/lib/trackers/metrics";
import {
  downsample,
  effectiveChartGranularity,
  parseGranularity,
  snapshotFetchLimit,
} from "@/lib/trackers/granularity";

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

    // The org decides how densely its charts are drawn, and how densely they are
    // read. A flat take:60 was ten days at the four-hourly cadence, so the 30d
    // window could never be honoured however much history the table held.
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { uiConfig: true },
    });
    const granularity = parseGranularity(org?.uiConfig ?? null);
    const windowDays = windowHours(period) / 24;

    const sounds = await db.tikTokSound.findMany({
      where: { orgId },
      include: {
        snapshots: {
          orderBy: { recordedAt: "desc" },
          take: snapshotFetchLimit(granularity, windowDays),
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Clamped, so a chart is never drawn finer than the reader samples.
    const chartAt = effectiveChartGranularity(granularity);

    const mapped = sounds.map((sound) => {
      const history: TrackerSnapshot[] = sound.snapshots.map((s) => ({
        value: s.usesCount,
        recordedAt: s.recordedAt,
      }));
      const change = changeOverWindow(history, period, now);
      const latest = sound.snapshots[0] ?? null;

      // Age is served with the count, never separately. changeOverWindow will
      // happily subtract two readings from the same minute nine days ago and
      // call it a 24-hour delta; `health` is what tells the client not to
      // believe it. Both go over the wire so no surface has to re-derive it.
      const lastReadAt = latest?.recordedAt ?? null;
      const health = readHealthFor(lastReadAt, now);
      const measurable = isMeasurable(health);

      return {
        ...sound,
        latestSnapshot: latest,
        change,
        health,
        lastReadAt,
        // Trend and delta are withheld rather than zeroed when the reader has
        // stopped: "unknown" is a state the UI already renders honestly, while
        // a zero is indistinguishable from a sound that genuinely did not move.
        status: measurable ? statusFor(change?.velocityPerHour ?? null) : "unknown",
        growthPercentage: measurable ? change?.percent ?? null : null,
        addedInPeriod: measurable ? change?.added ?? null : null,
        snapshotCount: sound.snapshots.length,
        // The series the chart draws: one point per bucket, oldest first, with
        // the closing value of each bucket rather than its mean. Change figures
        // above stay on the raw history — downsampling is a display concern and
        // must not move the numbers in the tiles.
        series: downsample(history, chartAt).map((s) => ({
          value: s.value,
          recordedAt: s.recordedAt,
        })),
        chartGranularity: chartAt,
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
/**
 * A TikTok sound id is a snowflake: 18-20 digits, nothing else.
 *
 * This is a front door, not a formality. Production carried three sounds with
 * hand-invented ids (7300001-3) from a seed run, each with snapshots frozen in
 * March, and they sat in the tracker for months summing into every headline
 * tile on the page. Nothing could ever resolve them — no such sound exists —
 * but nothing rejected them either, so the worker skipped them on every pass
 * and the dashboard reported their invented totals as fact.
 *
 * Rejecting the shape at the boundary turns "tracked forever, never readable"
 * into an immediate 400. The bound is deliberately a range rather than a fixed
 * 19: ids have grown a digit before and will again.
 */
const TIKTOK_SOUND_ID = /^\d{18,20}$/;

const createSoundSchema = z.object({
  tiktokSoundId: z
    .string()
    .regex(TIKTOK_SOUND_ID, "tiktokSoundId must be an 18-20 digit TikTok sound id"),
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
