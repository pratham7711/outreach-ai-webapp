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

    if (dryRun) {
      snapshots++;
      continue;
    }

    await recordSoundSnapshot(sound, stats);
    snapshots++;
  }

  return { snapshots, failed, skipped };
}

/**
 * Write one snapshot and backfill whatever metadata we just learned.
 *
 * Exported because the dev filler in scripts/creatorcore also records snapshots
 * -- it has to, since music pages need a browser to read and this job only
 * fetches -- and the arithmetic must not exist twice. It nearly did, and the
 * second copy put a percentage into videosAdded24h, so a sound with 46 uses and
 * no history reported "+100 videos added" on the campaign report.
 */
export async function recordSoundSnapshot(
  sound: { id: string; title?: string | null; artist?: string | null; coverImageUrl?: string | null; snapshots: { usesCount: number }[] },
  stats: { usesCount: number; title?: string | null; artist?: string | null; coverImageUrl?: string | null },
): Promise<void> {
  // A delta needs two observations. On the first snapshot of a sound there is no
  // earlier reading to subtract, and the lifetime total is not a 24-hour figure:
  // treating a fresh sound with 46 uses as "+46 videos added today" is inventing
  // history for a sound that may have been trending for a month. Record the
  // level, leave the change at zero, and let the reader say "unknown" -- it can,
  // because a single snapshot has no predecessor.
  const baseline = sound.snapshots[0];
  const delta = baseline ? stats.usesCount - baseline.usesCount : 0;

  await db.soundTrackerSnapshot.create({
    data: {
      soundId: sound.id,
      usesCount: stats.usesCount,
      // A count of videos, not a rate: velocityScore is where the percentage goes.
      videosAdded24h: Math.max(0, Math.round(delta)),
      deltaUses24h: Math.round(delta),
      velocityScore: baseline ? velocityBetween(baseline.usesCount, stats.usesCount) : 0,
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
}
