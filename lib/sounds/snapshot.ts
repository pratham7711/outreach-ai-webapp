import { db } from "@/lib/db";
import { fetchTikTokSoundStats } from "@/lib/platforms/tiktokSound";
import { readTikTokSoundViaEmbed } from "@/lib/platforms/tiktokSoundEmbed";
import { openSandboxProfileFetcher } from "@/lib/platforms/tiktokProfileSandbox";
import { createLogger } from "@/lib/observability/logger";
import { velocityBetween } from "@/lib/trackers/metrics";

export type SnapshotResult = {
  snapshots: number;
  failed: number;
  skipped: number;
};

/**
 * How recent a snapshot has to be before this job treats a sound as somebody
 * else's.
 *
 * That somebody used to be a browser worker on a VPS. It is now the hourly
 * sync-trackers cron, which reads sounds through the same embed this job does,
 * so the two would otherwise write a duplicate snapshot every night and report
 * a delta of zero against a reading taken an hour earlier. Comfortably longer
 * than an hourly cadence plus a late run, and short enough that a reader which
 * genuinely stopped is picked up again the following night.
 */
const HANDOVER_WINDOW_MS = 8 * 60 * 60 * 1000;

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
    //
    // platform is not optional here. Every reader below builds a TikTok sound
    // URL from `tiktokSoundId`, while the column admits INSTAGRAM too -- and
    // because the same numeric id can exist on both platforms, an unfiltered
    // sweep would quietly store TikTok's usage curve against an Instagram
    // tracker. Instagram audio has no reader yet; skipping says so, guessing
    // does not.
    where: {
      platform: "TIKTOK",
      ...(soundId ? { id: soundId } : {}),
      ...(orgId ? { orgId } : {}),
    },
    select: {
      id: true,
      tiktokSoundId: true,
      title: true,
      artist: true,
      coverImageUrl: true,
      snapshots: {
        orderBy: { recordedAt: "desc" },
        take: 1,
        select: { usesCount: true, recordedAt: true },
      },
    },
  });

  /* One sandbox for the whole run, created lazily inside the fetcher, so a run
     whose sounds all answer over plain egress never pays for a boot. */
  const remote = openSandboxProfileFetcher();

  try {
    for (const [index, sound] of sounds.entries()) {
      if (Date.now() > deadline) {
        log.warn("time budget reached; stopping early", { remaining: sounds.length - index });
        break;
      }

      /* Somebody else already read this one -- in practice the hourly cron.
         A recent snapshot is the evidence, and it needs no flag to set or
         remember. Skipped rather than counted as failed, which is what takes it
         out of the nightly alert ratio.
         Not applied to a single-sound refresh: a person clicking Refresh asked
         for this sound now, and silently doing nothing is not an answer. */
      const lastAt = sound.snapshots[0]?.recordedAt;
      if (!soundId && lastAt && Date.now() - lastAt.getTime() < HANDOVER_WINDOW_MS) {
        skipped++;
        continue;
      }

      /* The embed page first, and it is the rung that actually answers: the music
         page carries no count, /api/music/detail/ answers empty without headers
         only TikTok's own client script produces, and the plain fetch below has
         never produced a reading from here. See lib/platforms/tiktokSoundEmbed.ts.

         This matters most for the Refresh button, which lands here rather than in
         the hourly cron. Wiring the embed into the cron alone would have left a
         person clicking Refresh with the same silent nothing it always gave. */
      const embedStats = await readTikTokSoundViaEmbed(sound.tiktokSoundId, (id) =>
        remote.readMusicEmbedHtml(id),
      ).catch((error) => {
        log.warn("embed read failed", {
          soundId: sound.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });

      const stats = embedStats ?? (await fetchTikTokSoundStats(sound.tiktokSoundId));
      if (!stats) {
        failed++;
        continue;
      }

      /* A zero from the embed is a measurement: statusCode 0 with videoCount 0 is
         TikTok saying the sound exists and nothing uses it, which is exactly what
         a brand's freshly uploaded audio looks like on day one, and recording it
         is what makes tomorrow's delta true. A zero from the fetch fallback is not
         a measurement -- that path returns zero when it could not read -- so it
         stays a skip. The distinction is which rung answered, not the number. */
      if (stats.usesCount < 0 || (!embedStats && stats.usesCount <= 0)) {
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
  } finally {
    await remote.close().catch(() => {});
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
      /* velocityScore's unit is PERCENT change since the previous reading, for
         every writer of this column: here, the creator sweep, the seed, and
         app/api/cron/sync-trackers -- which used to write uses/hour into it
         instead, so one sound's series changed unit depending on which job read
         it last. The consumer is the campaign audio card, which renders each
         point with a "%" suffix (lib/reports/campaignPerformance -> AudioCard).
         The trackers page does not read this column; it recomputes
         velocityPerHour from the series. */
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
