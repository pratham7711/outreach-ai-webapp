import { db } from "@/lib/db";
import { isCoverUrlStale } from "@/lib/sounds/coverUrl";
import { readTikTokAudioUsage, isMeasuredRung } from "@/lib/platforms/tiktokAudioUsage";
import { readInstagramAudioUsage } from "@/lib/platforms/instagramAudioUsage";
import { createLogger } from "@/lib/observability/logger";
import { ABANDON_AFTER_DEADLINE_MS, waitUntil } from "@/lib/ops/waitUntil";
import { holdSoundReading } from "@/lib/trackers/metrics";
import { readingPrecision, roundedAddsNothing, soundReadingChange, type UsesPrecision } from "@/lib/sounds/precision";
import { logVerdict, validateReading, type GateVerdict } from "@/lib/acquisition/validate";

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

/** The shortest gap between two readings of one sound taken on request. */
const REFRESH_MIN_GAP_MS = 10 * 60 * 1000;

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
    // Both platforms, and `platform` is selected rather than filtered on,
    // because the row decides which reader sees it. The same numeric id can
    // exist on TikTok and on Instagram, so reading an Instagram row through the
    // TikTok ladder would store one platform's usage curve against the other's
    // tracker -- which is why this used to be `platform: "TIKTOK"` outright.
    // The dispatch below is what replaces that guard; it must stay exhaustive.
    where: {
      ...(soundId ? { id: soundId } : {}),
      ...(orgId ? { orgId } : {}),
    },
    select: {
      id: true,
      platform: true,
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
    /* "Now" is not "again within seconds", though. Production holds bursts of
       five readings of one sound two seconds apart (2026-09-23 19:43:58 to
       19:44:07, and four more on 09-24): every refresh and save in a row read
       it again, and each burst is five identical points on the audio chart. A
       reading this recent already answers the person who clicked. */
    if (soundId && lastAt && Date.now() - lastAt.getTime() < REFRESH_MIN_GAP_MS) {
      skipped++;
      return false;
    }
    return true;
  });

  const dueTikTok = due.filter((sound) => sound.platform === "TIKTOK");
  const dueInstagram = due.filter((sound) => sound.platform === "INSTAGRAM");

  /* allowMusicPage stays on here even though that rung has never answered from
     a server. It is the documented last resort, the fetcher now runs it
     concurrently rather than paying its timeout one sound after another, and
     dropping a fallback is a separate decision from making the reader fast. */
  /* Both readers honour deadlineAt for what they start; waitUntil bounds what
     they had already started, so an await that never settles cannot hold the
     run past its function's maxDuration (lib/ops/waitUntil). A reader given
     up on reads as "never asked" below -- unread, not failed -- and says so in
     an error line. */
  const giveUpAt = deadline + ABANDON_AFTER_DEADLINE_MS;
  const tiktokRead = dueTikTok.length
    ? await waitUntil(
        readTikTokAudioUsage(
          dueTikTok.map((sound) => sound.tiktokSoundId),
          { deadlineAt: deadline, allowMusicPage: true },
        ),
        giveUpAt,
      )
    : null;
  if (tiktokRead && !tiktokRead.settled) log.error("tiktok audio reads abandoned", { sounds: dueTikTok.length });
  const tiktokReadings = tiktokRead?.settled ? tiktokRead.value : new Map();

  /* One plain GET per audio, no ladder and no sandbox -- Instagram's audio page
     serves its Open Graph block to a non-browser client on the first try. The
     reasons it can fail are its own (an id that is no audio page at all still
     answers 200, and original audio publishes no count), which is why they do
     not flow through the TikTok outcome type. */
  const instagramRead = dueInstagram.length
    ? await waitUntil(
        readInstagramAudioUsage(
          dueInstagram.map((sound) => sound.tiktokSoundId),
          { deadlineAt: deadline },
        ),
        giveUpAt,
      )
    : null;
  if (instagramRead && !instagramRead.settled) log.error("instagram audio reads abandoned", { sounds: dueInstagram.length });
  const instagramReadings = instagramRead?.settled ? instagramRead.value : new Map();

  for (const sound of due) {
    if (sound.platform === "INSTAGRAM") {
      const outcome = instagramReadings.get(sound.tiktokSoundId);

      if (!outcome || (!outcome.ok && outcome.reason === "deadline")) {
        unread++;
        continue;
      }

      if (!outcome.ok) {
        /* "The page exists and publishes no count" is not a failed read, and
           counting it as one would put a permanent failure in the nightly alert
           ratio for a tracker that is working exactly as Instagram allows. The
           front door refuses these, so a row reaching here is one whose audio
           stopped publishing a count after it was added. */
        if (outcome.reason === "no-count") skipped++;
        else failed++;
        continue;
      }

      if (dryRun) {
        snapshots++;
        continue;
      }

      const { reading } = outcome;
      if (await recordSoundSnapshot(sound, reading, { precision: reading.precision })) snapshots++;
      else skipped++;
      continue;
    }

    /* The column holds the app-wide Platform enum, which is wider than the two
       platforms whose audio anything here can read -- soundUrl only ever writes
       TIKTOK or INSTAGRAM, but nothing in the schema stops a third from
       arriving. Falling through to the TikTok branch is exactly the bug the old
       `platform: "TIKTOK"` filter existed to prevent, so an unreadable platform
       is skipped and says so. This also keeps the dispatch and the two `due`
       partitions above agreeing on one predicate: a row selected for no reader
       must not then be counted as one the run ran out of time for. */
    if (sound.platform !== "TIKTOK") {
      skipped++;
      continue;
    }

    const outcome = tiktokReadings.get(sound.tiktokSoundId);

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

    // A fall far below the last reading waits for a later one (holdSoundReading).
    if (holdSoundReading(sound.snapshots[0], stats.usesCount)) {
      log.warn("sound reading held", {
        soundId: sound.id,
        rung,
        usesCount: stats.usesCount,
        previous: sound.snapshots[0]?.usesCount,
      });
      skipped++;
      continue;
    }

    if (dryRun) {
      snapshots++;
      continue;
    }

    if (await recordSoundSnapshot(sound, stats)) snapshots++;
    else skipped++;
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
export type RecordSnapshotOptions = {
  /**
   * False when this reading's level is trustworthy but its distance from the
   * previous one is not.
   *
   * Instagram abbreviates a large count ("1M reels"), so two consecutive
   * readings of a sound sitting anywhere near a rounding boundary can differ by
   * the whole rounding step while nothing happened — 950,000 and 1,000,000
   * print the same, and 999,999 crossing to 1,000,001 prints as a jump of
   * 50,000. Subtracting one from the other manufactures whichever gap the
   * rounding exposes, and the column it lands in is rendered as
   * "Videos Added (Since Last Sync)" on a client-facing report.
   *
   * The level still gets recorded — "about a million reels" is worth having.
   * Only the change is withheld, and it is withheld the same way a first-ever
   * snapshot withholds it: zero, which the reader already renders as unknown.
   *
   * TikTok's embed does the same above 10K (lib/sounds/precision), and its
   * reader cannot say so, so the figure's own shape is checked as well: a
   * rounded-looking level on either end withholds the change too.
   */
  precision?: UsesPrecision;
  /** Who is writing, for the gate's log line. Defaults to "sound-snapshot". */
  writer?: string;
};

/**
 * The shared validation gate (plan A3, lib/acquisition/validate) for one sound
 * reading, logged when it fires. Exported for the hourly tracker cron, which
 * keeps its own write for TikTok and must refuse the same readings.
 *
 * Two rules apply to a sound: a uses count that fell to 0 from a real figure
 * (a lifetime count of videos does not; a reader that could not see the page
 * does), and a title or artist that is a WAF challenge or login page's -- the
 * metadata of a shell, whose count is the shell's too.
 */
export function gateSoundReading(
  sound: { id: string; platform?: string | null; snapshots: { usesCount: number }[] },
  stats: { usesCount: number; title?: string | null; artist?: string | null },
  writer: string,
): GateVerdict {
  const verdict = validateReading(
    { kind: "sound", labels: [stats.title, stats.artist], counts: { uses: stats.usesCount } },
    { counts: { uses: sound.snapshots[0]?.usesCount } },
  );
  if (!verdict.ok) {
    logVerdict({ writer, kind: "sound", platform: sound.platform ?? undefined, rowId: sound.id }, verdict);
  }
  return verdict;
}

/**
 * Returns whether a row was written. It is not when the reading is a rounded
 * figure that agrees with the exact one already stored (roundedAddsNothing):
 * writing it would replace 73,912 with "74K" and chart the difference -- nor
 * when the validation gate refuses it (gateSoundReading), which says why in
 * the log.
 */
export async function recordSoundSnapshot(
  sound: {
    id: string;
    platform?: string | null;
    title?: string | null;
    artist?: string | null;
    coverImageUrl?: string | null;
    snapshots: { usesCount: number }[];
  },
  stats: { usesCount: number; title?: string | null; artist?: string | null; coverImageUrl?: string | null },
  options: RecordSnapshotOptions = {},
): Promise<boolean> {
  if (gateSoundReading(sound, stats, options.writer ?? "sound-snapshot").rejected) return false;
  const precision = readingPrecision(stats.usesCount, options.precision);
  const previous = sound.snapshots[0]?.usesCount;
  if (roundedAddsNothing(previous, stats.usesCount, precision)) return false;

  // A delta needs two observations. On the first snapshot of a sound there is no
  // earlier reading to subtract, and the lifetime total is not a 24-hour figure:
  // treating a fresh sound with 46 uses as "+46 videos added today" is inventing
  // history for a sound that may have been trending for a month. Record the
  // level, leave the change at zero, and let the reader say "unknown" -- it can,
  // because a single snapshot has no predecessor. Two rounded figures, or a
  // rounded and an exact one, are withheld the same way.
  const change = soundReadingChange(previous, stats.usesCount, precision);

  await db.soundTrackerSnapshot.create({
    data: {
      soundId: sound.id,
      usesCount: stats.usesCount,
      // A count of videos, not a rate: velocityScore is where the percentage goes.
      videosAdded24h: change.videosAdded24h,
      deltaUses24h: change.deltaUses24h,
      /* velocityScore's unit is PERCENT change since the previous reading, for
         every writer of this column: here, the creator sweep, the seed, and
         app/api/cron/sync-trackers -- which used to write uses/hour into it
         instead, so one sound's series changed unit depending on which job read
         it last. The consumer is the campaign audio card, which renders each
         point with a "%" suffix (lib/reports/campaignPerformance -> AudioCard).
         The trackers page does not read this column; it recomputes
         velocityPerHour from the series. */
      velocityScore: change.velocityScore,
    },
  });

  const patch = soundMetadataPatch(sound, stats);
  if (Object.keys(patch).length > 0) {
    await db.tikTokSound.update({ where: { id: sound.id }, data: patch });
  }
  return true;
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
