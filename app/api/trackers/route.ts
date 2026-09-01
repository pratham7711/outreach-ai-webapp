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
import { SOUND_URL_ERRORS, parseSoundUrl } from "@/lib/trackers/soundUrl";
import { getOrgEntitlements } from "@/lib/entitlements";

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

    const ent = await getOrgEntitlements(orgId);
    const maxTrackers = ent?.limits.maxTrackers ?? Infinity;
    return NextResponse.json({
      sounds: sorted,
      period,
      sort,
      // Infinity does not survive JSON, so an unlimited plan sends null and the
      // UI shows no counter rather than "3/null".
      limits: {
        used: sounds.length,
        max: Number.isFinite(maxTrackers) ? maxTrackers : null,
      },
    });
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

const createSoundSchema = z.union([
  // What a person actually has: the link. Everything but the id and a
  // provisional title arrives with the first reading.
  z.object({ url: z.string().min(1).max(2048) }),
  // The original shape, kept for ops and for anything already calling this.
  z.object({
    tiktokSoundId: z
      .string()
      .regex(TIKTOK_SOUND_ID, "tiktokSoundId must be an 18-20 digit TikTok sound id"),
    title: z.string().min(1),
    artist: z.string().min(1),
    coverImageUrl: z.string().nullable().optional(),
  }),
]);

/**
 * Follow a share link far enough to see the sound behind it.
 *
 * vm./vt. links carry an opaque token and no id, so the only way to learn one
 * is to ask where the link goes. A redirect is served before TikTok's app boots,
 * so unlike the count this *can* be read server-side.
 *
 * Manual redirects, and every hop re-checked against the TikTok host set: an
 * open redirect on a shortener would otherwise turn this endpoint into a
 * request forgery primitive pointed at whatever the attacker likes.
 */
const MAX_HOPS = 3;

async function expandShortLink(input: string): Promise<string | null> {
  let current = input;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      return null;
    }
    const location = res.headers.get("location");
    if (!location) return current; // no further hop: this is the destination

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return null;
    }
    if (!/(^|\.)tiktok\.com$/i.test(next.hostname)) return null;
    current = next.toString();
  }
  return current;
}

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

    let tiktokSoundId: string;
    let title: string;
    let artist: string;
    let coverImageUrl: string | null = null;

    if ("url" in parsed.data) {
      let result = parseSoundUrl(parsed.data.url);

      if (result.kind === "short-link") {
        const expanded = await expandShortLink(result.url);
        result = expanded
          ? parseSoundUrl(expanded)
          : { kind: "invalid", reason: "unrecognised" };
        if (!expanded) {
          return NextResponse.json(
            { error: "short_link_unresolvable", message: SOUND_URL_ERRORS.short_link_unresolvable },
            { status: 422 }
          );
        }
      }

      if (result.kind !== "sound") {
        // A short-link that survived expansion still pointing at a short-link
        // is not a shape we can name any better than "we did not find a sound".
        const reason =
          result.kind === "video"
            ? "video_url"
            : result.kind === "invalid"
              ? result.reason
              : "unrecognised";
        return NextResponse.json(
          { error: reason, message: SOUND_URL_ERRORS[reason] },
          { status: 400 }
        );
      }

      tiktokSoundId = result.tiktokSoundId;
      // Marked provisional wherever it is shown; the first reading replaces it
      // with whatever TikTok actually calls the sound.
      title = result.provisionalTitle ?? `Sound ${result.tiktokSoundId.slice(-6)}`;
      artist = "";
    } else {
      tiktokSoundId = parsed.data.tiktokSoundId;
      title = parsed.data.title;
      artist = parsed.data.artist;
      coverImageUrl = parsed.data.coverImageUrl ?? null;
    }

    /* The seat-equivalent for trackers, checked before the row is written.
       Deliberately after the duplicate check below would be wrong: re-adding a
       sound you already track must not be refused for being over the limit,
       since it adds nothing. So the count is taken here and the duplicate path
       returns early further down. */
    const entitlements = await getOrgEntitlements(orgId);
    const maxTrackers = entitlements?.limits.maxTrackers ?? Infinity;
    if (Number.isFinite(maxTrackers)) {
      const already = await db.tikTokSound.findFirst({ where: { orgId, tiktokSoundId } });
      if (!already) {
        const tracked = await db.tikTokSound.count({ where: { orgId } });
        if (tracked >= maxTrackers) {
          /* Zero is a real limit and needs its own sentence. "Remove one" is
             nonsense advice to someone who has none, and the free tier is
             exactly that case -- it is not that they have filled the plan up,
             it is that the plan does not include this. */
          const error =
            maxTrackers === 0
              ? "Your plan does not include sound trackers. Upgrade to start tracking sounds."
              : `Your plan includes ${maxTrackers} tracker${maxTrackers === 1 ? "" : "s"} and ${tracked} are in use. Remove one, or ask us to raise the limit.`;
          return NextResponse.json(
            { error, trackers: { used: tracked, max: maxTrackers } },
            { status: 409 }
          );
        }
      }
    }

    // Pasting the same link twice is a normal thing to do, and two rows for one
    // sound would read the same page twice and diverge. Return what is already
    // tracked instead of creating a duplicate or failing.
    const existing = await db.tikTokSound.findFirst({
      where: { orgId, tiktokSoundId },
    });
    if (existing) {
      return NextResponse.json({ ...existing, alreadyTracked: true }, { status: 200 });
    }

    const sound = await db.tikTokSound.create({
      data: { orgId, tiktokSoundId, title, artist, coverImageUrl },
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

/**
 * DELETE /api/trackers — remove every tracked sound for this organisation.
 *
 * Bulk removal exists because the per-row delete is fine for tidying and
 * hopeless for starting over: an org that imported a catalogue, or one whose
 * trackers are all seed junk, would otherwise click delete a hundred times.
 *
 * Two guards, because this is the most destructive button in the tracker
 * surface. It requires an explicit `confirm: "DELETE_ALL"` in the body, so it
 * cannot be triggered by a stray fetch or a mis-copied curl; and it reports how
 * many rows it removed, so a caller who expected three and removed ninety finds
 * out immediately.
 *
 * Snapshots go with the sounds. They are meaningless without the row they
 * describe, and leaving them would silently re-attach history to a sound of the
 * same id added later — a tracker inheriting a stranger's past.
 */
export async function DELETE(req: NextRequest) {
  try {
    const result = await authenticateRequest(req);
    if (!result)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const body = await req.json().catch(() => null);
    if (body?.confirm !== "DELETE_ALL") {
      return NextResponse.json(
        { error: 'Send { "confirm": "DELETE_ALL" } to remove every tracker.' },
        { status: 400 }
      );
    }

    const sounds = await db.tikTokSound.findMany({
      where: { orgId },
      select: { id: true },
    });
    if (sounds.length === 0) {
      return NextResponse.json({ removed: 0, snapshotsRemoved: 0 });
    }
    const ids = sounds.map((s) => s.id);

    /* Snapshots first, then sounds, in one transaction: the foreign key would
       reject the reverse order, and a partial run would leave orphan history
       that no query would ever surface again. */
    const [snapshots] = await db.$transaction([
      db.soundTrackerSnapshot.deleteMany({ where: { soundId: { in: ids } } }),
      db.tikTokSound.deleteMany({ where: { orgId } }),
    ]);

    return NextResponse.json({
      removed: ids.length,
      snapshotsRemoved: snapshots.count,
    });
  } catch (error) {
    console.error("Failed to remove all trackers:", error);
    return NextResponse.json({ error: "Failed to remove trackers" }, { status: 500 });
  }
}
