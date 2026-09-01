import { NextRequest, NextResponse } from "next/server";

/* A browser read costs about ten seconds a sound, measured. The default
   function ceiling would cut the run off after a couple of sounds. */
export const maxDuration = 300;
export const runtime = "nodejs";
import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";
import { fetchTikTokSoundStats } from "@/lib/platforms/tiktokSound";
import { openSoundBrowserSession } from "@/lib/platforms/tiktokSoundBrowser";
import {
  changeOverWindow,
  previousOf,
  velocityPerHour,
  type TrackerSnapshot,
} from "@/lib/trackers/metrics";
import {
  DEFAULT_GRANULARITY,
  isDueForRead,
  parseGranularity,
} from "@/lib/trackers/granularity";

export const dynamic = "force-dynamic";

const MIN_INTERVAL_HOURS = 1;
const HOUR_MS = 1000 * 60 * 60;
const MAX_SOUNDS = 200;

type Decision = {
  soundId: string;
  action: "snapshot" | "skip" | "fail";
  reason: string;
  usesCount?: number;
};

export async function GET(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/sync-trackers" } });

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const now = new Date();
  const deadline = Date.now() + 4 * 60 * 1000;

  const decisions: Decision[] = [];
  let snapshotted = 0;
  let skipped = 0;
  let failed = 0;

  /* One browser for the whole sweep -- launched lazily on the first sound that
     actually needs a read, so a run where everything is skipped stays cheap.
     Per-sound launches paid the launch cost ~93 times and raced on the binary
     extracted to /tmp (ETXTBSY), which is how the creator sweep first failed. */
  const tiktok = openSoundBrowserSession();

  try {
    /* Cadence is per-organisation, so the run needs each sound's owner. The
       cron fires hourly and reads only what is actually due; an org on the
       6-hourly setting therefore does work on one run in six, and changing the
       setting needs no new schedule. */
    const orgs = await db.organization.findMany({ select: { id: true, uiConfig: true } });
    const cadenceByOrg = new Map(orgs.map((o) => [o.id, parseGranularity(o.uiConfig)]));

    const sounds = await db.tikTokSound.findMany({
      select: {
        id: true,
        orgId: true,
        tiktokSoundId: true,
        snapshots: {
          orderBy: { recordedAt: "desc" },
          take: 30,
          select: { usesCount: true, recordedAt: true },
        },
      },
      orderBy: { createdAt: "asc" },
      take: MAX_SOUNDS,
    });

    for (const sound of sounds) {
      if (Date.now() > deadline) {
        decisions.push({ soundId: sound.id, action: "skip", reason: "deadline-passed" });
        skipped++;
        continue;
      }

      const history: TrackerSnapshot[] = sound.snapshots.map((s) => ({
        value: s.usesCount,
        recordedAt: s.recordedAt,
      }));

      /* MIN_INTERVAL_HOURS used to be a flat 1, which meant the org's chosen
         cadence had no effect on anything: the setting existed, the screen
         offered it, and the reader ignored it. */
      const granularity = cadenceByOrg.get(sound.orgId) ?? DEFAULT_GRANULARITY;
      const newest = history.length > 0 ? history[0] : null;
      if (!isDueForRead(newest?.recordedAt ?? null, granularity, now)) {
        decisions.push({
          soundId: sound.id,
          action: "skip",
          reason: `not-due (${granularity.readCadence})`,
        });
        skipped++;
        continue;
      }

      if (dryRun) {
        decisions.push({ soundId: sound.id, action: "snapshot", reason: "dry-run" });
        continue;
      }

      // A music page needs a browser: the count arrives from /api/music/detail/,
      // which is empty without headers TikTok's own client script signs. The
      // plain fetch below is kept as a fallback only because it costs nothing
      // when the browser is unavailable — on its own it has never produced a
      // reading, which is why this cron ran daily for ten days and wrote none.
      let stats = await tiktok.read(sound.tiktokSoundId).catch((e) => {
        log.warn("browser read failed", { soundId: sound.id, error: String(e).slice(0, 120) });
        return null;
      });
      if (!stats) stats = await fetchTikTokSoundStats(sound.tiktokSoundId);
      if (!stats) {
        decisions.push({ soundId: sound.id, action: "fail", reason: "no-data" });
        failed++;
        continue;
      }

      const latest: TrackerSnapshot = { value: stats.usesCount, recordedAt: now };
      const withLatest = [...history, latest];

      const velocity = velocityPerHour(previousOf(withLatest), latest);
      const day = changeOverWindow(withLatest, "24h", now);

      await db.soundTrackerSnapshot.create({
        data: {
          soundId: sound.id,
          usesCount: stats.usesCount,
          /* A count of new videos cannot be negative, and TikTok's uses figure
             does fall — it fell by one here, and the report duly showed
             "-1 videos added". deltaUses24h is the signed change and keeps the
             sign; videosAdded24h is a count and is floored, exactly as
             recordSoundSnapshot does it. Third copy of this arithmetic; the
             second one put a percentage in the same column. */
          videosAdded24h: day ? Math.max(0, Math.round(day.added)) : 0,
          deltaUses24h: day ? Math.round(day.added) : 0,
          velocityScore: velocity ?? 0,
          recordedAt: now,
        },
      });

      decisions.push({
        soundId: sound.id,
        action: "snapshot",
        reason: "ingested",
        usesCount: stats.usesCount,
      });
      snapshotted++;
    }

    log.info("tracker sweep complete", { snapshotted, skipped, failed, dryRun });

    return NextResponse.json({
      dryRun,
      considered: sounds.length,
      snapshotted,
      skipped,
      failed,
      decisions,
    });
  } catch (error) {
    log.error("tracker sweep threw", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Tracker sweep failed" }, { status: 500 });
  } finally {
    await tiktok.close();
  }
}
