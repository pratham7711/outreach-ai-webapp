import { db } from "@/lib/db";
import { fetchTikTokSoundStats } from "@/lib/platforms/tiktokSound";
import { createLogger } from "@/lib/observability/logger";
import { velocityBetween } from "@/lib/trackers/metrics";

export type SnapshotResult = {
  snapshots: number;
  failed: number;
  skipped: number;
};

export type SnapshotOptions = {
  orgId?: string;
  /** One sound instead of the whole org, for a campaign refreshing its own audio. */
  soundId?: string;
  dryRun?: boolean;
  deadlineMs?: number;
};

export async function snapshotSounds(options: SnapshotOptions = {}): Promise<SnapshotResult> {
  const { orgId, soundId, dryRun = false, deadlineMs = 4 * 60 * 1000 } = options;
  const log = createLogger({ context: { job: "snapshot-sounds", orgId: orgId ?? "all" } });
  const deadline = Date.now() + deadlineMs;

  let snapshots = 0;
  let failed = 0;
  let skipped = 0;

  const sounds = await db.tikTokSound.findMany({
    // orgId stays in the filter alongside soundId: the caller passes an id it
    // read off its own campaign, and a scope check costs nothing here.
    where: soundId ? { id: soundId, ...(orgId ? { orgId } : {}) } : orgId ? { orgId } : undefined,
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

  for (const [index, sound] of sounds.entries()) {
    if (Date.now() > deadline) {
      log.warn("time budget reached; stopping early", { remaining: sounds.length - index });
      break;
    }

    const stats = await fetchTikTokSoundStats(sound.tiktokSoundId);
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
        velocityScore: velocityBetween(prev, stats.usesCount),
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

  return { snapshots, failed, skipped };
}
