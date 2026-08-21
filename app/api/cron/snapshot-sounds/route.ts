import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchSoundStats } from "@/lib/platforms/tiktokSound";
import { createLogger } from "@/lib/observability/logger";
import { alertOps, shouldAlertOnBatch } from "@/lib/alerts";

// velocityScore is a same-interval growth percentage: the /api/trackers route reads
// >=100 viral, >=50 trending, >=0 stable, <0 declining. Doubling in a day -> viral.
function velocity(prev: number, current: number): number {
  if (prev > 0) return Math.round(((current - prev) / prev) * 10000) / 100;
  return current > 0 ? 100 : 0;
}

export async function GET(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/snapshot-sounds" } });

  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    log.warn("auth failed", { reason: "bad-or-missing-cron-secret" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SCRAPECREATORS_API_KEY) {
    return NextResponse.json({ skipped: "provider not configured", snapshots: 0 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const deadline = Date.now() + 4 * 60 * 1000;

  let snapshots = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const sounds = await db.tikTokSound.findMany({
      select: {
        id: true,
        tiktokSoundId: true,
        title: true,
        artist: true,
        coverImageUrl: true,
        snapshots: {
          orderBy: { recordedAt: "desc" },
          take: 1,
          select: { usesCount: true },
        },
      },
    });

    for (const sound of sounds) {
      if (Date.now() > deadline) {
        log.warn("time budget reached; stopping early", { remaining: sounds.length - snapshots });
        break;
      }

      const stats = await fetchSoundStats(sound.tiktokSoundId);
      if (!stats) {
        failed++;
        continue;
      }
      if (stats.usesCount <= 0) {
        skipped++;
        continue;
      }

      const prev = sound.snapshots[0]?.usesCount ?? 0;
      const delta = stats.usesCount - prev;

      if (dryRun) {
        snapshots++;
        continue;
      }

      await db.soundTrackerSnapshot.create({
        data: {
          soundId: sound.id,
          usesCount: stats.usesCount,
          videosAdded24h: Math.max(0, Math.round(delta)),
          deltaUses24h: Math.round(delta),
          velocityScore: velocity(prev, stats.usesCount),
        },
      });

      // Backfill metadata the operator may have left blank when adding the sound.
      const patch: Record<string, string> = {};
      if (!sound.title && stats.title) patch.title = stats.title;
      if (!sound.artist && stats.artist) patch.artist = stats.artist;
      if (!sound.coverImageUrl && stats.coverImageUrl) patch.coverImageUrl = stats.coverImageUrl;
      if (Object.keys(patch).length > 0) {
        await db.tikTokSound.update({ where: { id: sound.id }, data: patch });
      }

      snapshots++;
    }

    if (shouldAlertOnBatch({ failed, total: snapshots + failed })) {
      await alertOps({
        source: "cron/snapshot-sounds",
        title: `Sound/audio fetcher failing: ${failed} of ${snapshots + failed}`,
        severity: "critical",
        facts: { snapshots, failed, skipped, dryRun },
      });
    }
    return NextResponse.json({ snapshots, failed, skipped, dryRun });
  } catch (error) {
    log.error("snapshot-sounds cron failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await alertOps({
      source: "cron/snapshot-sounds",
      title: "Sound/audio snapshot cron crashed",
      severity: "critical",
      facts: { error: error instanceof Error ? error.message : String(error), snapshots, failed },
    });
    return NextResponse.json({ error: "cron failed", snapshots, failed }, { status: 500 });
  }
}
