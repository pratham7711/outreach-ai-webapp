import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";
import { fetchTikTokSoundStats } from "@/lib/platforms/tiktokSound";
import {
  changeOverWindow,
  previousOf,
  velocityPerHour,
  type TrackerSnapshot,
} from "@/lib/trackers/metrics";

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

  try {
    const sounds = await db.tikTokSound.findMany({
      select: {
        id: true,
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

      const newest = history.length > 0 ? history[0] : null;
      if (
        newest &&
        (now.getTime() - newest.recordedAt.getTime()) / HOUR_MS < MIN_INTERVAL_HOURS
      ) {
        decisions.push({ soundId: sound.id, action: "skip", reason: "recently-snapshotted" });
        skipped++;
        continue;
      }

      if (dryRun) {
        decisions.push({ soundId: sound.id, action: "snapshot", reason: "dry-run" });
        continue;
      }

      const stats = await fetchTikTokSoundStats(sound.tiktokSoundId);
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
          videosAdded24h: day ? Math.round(day.added) : 0,
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
  }
}
