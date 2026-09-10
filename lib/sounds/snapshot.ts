import { db } from "@/lib/db";
import { isCoverUrlStale } from "@/lib/sounds/coverUrl";
import { readTikTokAudioUsage, isMeasuredRung } from "@/lib/platforms/tiktokAudioUsage";
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
  let unread = 0;

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

  /* One batched read for the whole run, rather than a sound at a time.

     The ladder itself -- embed over plain egress, then the same embed from a
     sandbox, then the music page -- lives in tiktokAudioUsage.ts, where the
     hourly sweep reads it too. What changes here is the shape: the reads run
     concurrently, the sandbox is opened only if plain egress left something
     unread, and two rows sharing a tiktokSoundId ask TikTok once. */
  const due = sounds.filter((sound) => {
    /* Somebody else already read this one -- in practice the hourly cron.
       A recent snapshot is the evidence, and it needs no flag to set or
       remember. Skipped rather than counted as failed, which is what takes it
       out of the nightly alert ratio.
       Not applied to a single-sound refresh: a person clicking Refresh asked
       for this sound now, and silently doing nothing is not an answer. */
    const lastAt = sound.snapshots[0]?.recordedAt;
    if (!soundId && lastAt && Date.now() - lastAt.getTime() < HANDOVER_WINDOW_MS) {
      skipped++;
      return false;
    }
    return true;
  });

  /* allowMusicPage stays on here even though that rung has never answered from
     a server. It is the documented last resort, the fetcher now runs it
     concurrently rather than paying its timeout one sound after another, and
     dropping a fallback is a separate decision from making the reader fast. */
  const readings = due.length
    ? await readTikTokAudioUsage(
        due.map((sound) => sound.tiktokSoundId),
        { deadlineAt: deadline, allowMusicPage: true },
      )
    : new Map();

  for (const sound of due) {
    const outcome = readings.get(sound.tiktokSoundId);

    /* Never asked, because the run ran out of time. Not a failure: counting it
       as one would page ops whenever a sweep is simply large. */
    if (!outcome || (!outcome.ok && outcome.reason === "deadline")) {
      unread++;
      continue;
    }

    if (!outcome.ok) {
      failed++;
      continue;
    }

    const { stats, rung } = outcome;

    /* A zero from the embed is a measurement: statusCode 0 with videoCount 0 is
       TikTok saying the sound exists and nothing uses it, which is exactly what
       a brand's freshly uploaded audio looks like on day one, and recording it
       is what makes tomorrow's delta true. A zero from the music-page fallback is
       not a measurement -- that path returns zero when it could not read -- so it
       stays a skip. The distinction is which rung answered, not the number. */
    if (stats.usesCount < 0 || (!isMeasuredRung(rung) && stats.usesCount <= 0)) {
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

  if (unread > 0) log.warn("time budget reached; stopping early", { remaining: unread });

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

  const patch = soundMetadataPatch(sound, stats);
  if (Object.keys(patch).length > 0) {
    await db.tikTokSound.update({ where: { id: sound.id }, data: patch });
  }
}

/**
 * What a reading is allowed to write back onto the sound row.
 *
 * Title and artist are BACKFILL-ONLY: they fill a blank the operator left when
 * adding the sound, and never overwrite one they typed. TikTok's own label is
 * not more correct than theirs.
 *
 * The cover is different, because it is not a name but a signed URL that stops
 * resolving on a timer (see lib/sounds/coverUrl). Backfilling it once and never
 * looking again is how a campaign report loses its artwork months later with
 * nothing anywhere reporting a failure. Every reading hands back a freshly
 * signed URL, so renewing an expiring one costs a single UPDATE.
 *
 * Exported so the hourly sweep in app/api/cron/sync-trackers -- which keeps its
 * own write path and so never wrote metadata at all -- applies the same rule.
 */
export function soundMetadataPatch(
  sound: { title?: string | null; artist?: string | null; coverImageUrl?: string | null },
  stats: { title?: string | null; artist?: string | null; coverImageUrl?: string | null },
  now: number = Date.now(),
): Record<string, string> {
  const patch: Record<string, string> = {};
  if (!sound.title && stats.title) patch.title = stats.title;
  if (!sound.artist && stats.artist) patch.artist = stats.artist;
  if (
    stats.coverImageUrl &&
    stats.coverImageUrl !== sound.coverImageUrl &&
    isCoverUrlStale(sound.coverImageUrl, now)
  ) {
    patch.coverImageUrl = stats.coverImageUrl;
  }
  return patch;
}

/**
 * The first reading for a campaign's audio, taken when the audio is attached
 * rather than at 04:00 the next morning.
 *
 * Attaching a TikTok sound used to create the tracker row and stop there, so
 * the campaign's audio card -- and the client report built from it -- showed an
 * em dash for uses until a cron happened to run. For a link an operator sends a
 * brand the same afternoon, that is the whole first impression of the feature.
 *
 * Deliberately narrow: it does nothing when the sound already has a reading, so
 * a second campaign joining an existing tracker costs no fetch, and a person
 * pasting the same link twice does not queue two. The caller runs it in
 * `after()`, so a slow or blocked TikTok delays nobody -- the campaign is
 * already written and the response already sent.
 */
export async function primeSongAudio(
  orgId: string,
  songId: string | null | undefined,
): Promise<SnapshotResult | null> {
  if (!songId) return null;

  const song = await db.song.findFirst({
    where: { id: songId, orgId, deletedAt: null },
    select: { soundId: true },
  });
  if (!song?.soundId) return null;

  const already = await db.soundTrackerSnapshot.findFirst({
    where: { soundId: song.soundId },
    select: { id: true },
  });
  if (already) return null;

  /* Well inside a function's ceiling even when the direct read misses and the
     sandbox rung has to boot, and short enough that an `after()` callback is
     not what keeps the invocation alive. */
  return snapshotSounds({ orgId, soundId: song.soundId, deadlineMs: 25 * 1000 });
}
