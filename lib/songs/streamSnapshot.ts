import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";
import { createSpotifyReader, type SpotifyReader } from "@/lib/platforms/spotifyWeb";
import { pickSpotifyTrack, searchQueries, type SongForMatch } from "./spotifyMatch";
import { isMissingSongStreamTable } from "./streamSnapshotDdl";

/**
 * Once a day, each promoted song's Spotify play count.
 *
 * The whole of what this reads, by design: one track page per song per UTC day,
 * plus a search page for a song whose Spotify track is not known yet. Nothing
 * on demand, no button, no other Spotify page. A song is read only while a
 * campaign promoting it is open (Pending or In progress); a closed campaign's
 * report keeps the readings it already has.
 *
 * Every song the run reaches gets a row for the day, a count or the reason
 * there is none, so a later pass the same day leaves it alone. The schedule
 * fires twice in the morning (lib/ops/cronJobs) only so a run that ran out of
 * time gets finished: the second pass sees the first one's rows and reads
 * nothing twice.
 *
 * Before the table exists the cron returns without opening a browser:
 * deploying the code first makes no Spotify call at all. Only the admin dry run
 * (app/api/admin/song-streams) reads then, and it stores nothing.
 */

export const OPEN_CAMPAIGN_STATUSES = ["PENDING", "IN_PROGRESS"] as const;

/** A run stops after this many reads in a row throw: Spotify refusing is a reason to stop, not to try harder. */
const STOP_AFTER_ERRORS = 3;

export function utcDay(ms: number): Date {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export type StreamSweepResult = {
  ok: true;
  tableReady: boolean;
  dryRun: boolean;
  /** Songs on an open campaign with no row for today, before this run. */
  due: number;
  read: number;
  noMatch: number;
  failed: number;
  /** Due, but not reached: out of time, or the run stopped on errors. */
  skipped: number;
  /** How many of today's tracks came from a search rather than an earlier reading. */
  matchedToday: number;
  failures: Record<string, number>;
};

export type StreamSweepOptions = {
  dryRun?: boolean;
  limit?: number;
  deadlineMs?: number;
  nowMs?: number;
  /** Pause between songs, so a run reads like one person's browsing, not a burst. */
  gapMs?: number;
  reader?: SpotifyReader;
};

type Outcome =
  | { kind: "read"; trackId: string; trackName: string; trackArtists: string; playCount: number; searched: boolean }
  | { kind: "no-match"; failure: string }
  | { kind: "failed"; trackId: string | null; failure: string; searched: boolean };

const pause = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

async function readSong(
  reader: SpotifyReader,
  song: SongForMatch,
  knownTrackId: string | null,
  gapMs: number
): Promise<Outcome> {
  let trackId = knownTrackId;
  let searched = false;
  if (!trackId) {
    const queries = searchQueries(song);
    if (!queries.length) return { kind: "no-match", failure: "nothing to search with" };
    for (const [i, q] of queries.entries()) {
      if (i > 0) await pause(gapMs);
      searched = true;
      const match = pickSpotifyTrack(song, await reader.search(q));
      if (match) {
        trackId = match.hit.id;
        break;
      }
    }
    if (!trackId) return { kind: "no-match", failure: "no Spotify track with this title and artist" };
    await pause(gapMs);
  }
  const reading = await reader.track(trackId);
  if (!reading) return { kind: "failed", trackId, failure: "track page gave no track", searched };
  if (reading.playCount === null) return { kind: "failed", trackId, failure: "track page gave no play count", searched };
  return {
    kind: "read",
    trackId,
    trackName: reading.name,
    trackArtists: reading.artists.join(", "),
    playCount: reading.playCount,
    searched,
  };
}

type DueSong = {
  id: string;
  orgId: string;
  title: string;
  artist: string | null;
  isrc: string | null;
  updatedAt: Date;
  sound: { artist: string | null } | null;
  streamReadings: { spotifyTrackId: string | null; recordedAt: Date }[];
};

const OPEN_CAMPAIGN = { some: { deletedAt: null, status: { in: [...OPEN_CAMPAIGN_STATUSES] } } };
const DUE_SONG_FIELDS = {
  id: true,
  orgId: true,
  title: true,
  artist: true,
  isrc: true,
  updatedAt: true,
  sound: { select: { artist: true } },
} as const;

/**
 * Songs on an open campaign with no reading today. `withReadings: false` is
 * the same list for a database without the readings table, where every song
 * is due and none has a known track.
 */
async function dueSongs(day: Date, limit: number, withReadings: boolean): Promise<DueSong[]> {
  if (!withReadings) {
    const songs = await db.song.findMany({
      where: { deletedAt: null, campaigns: OPEN_CAMPAIGN },
      select: DUE_SONG_FIELDS,
      orderBy: { id: "asc" },
      take: limit,
    });
    return songs.map((song) => ({ ...song, streamReadings: [] }));
  }
  return db.song.findMany({
    where: { deletedAt: null, campaigns: OPEN_CAMPAIGN, streamReadings: { none: { day } } },
    select: {
      ...DUE_SONG_FIELDS,
      streamReadings: {
        where: { spotifyTrackId: { not: null } },
        orderBy: { day: "desc" },
        take: 1,
        select: { spotifyTrackId: true, recordedAt: true },
      },
    },
    orderBy: { id: "asc" },
    take: limit,
  });
}

export async function snapshotSongStreams(options: StreamSweepOptions = {}): Promise<StreamSweepResult> {
  const log = createLogger({ context: { job: "snapshot-song-streams" } });
  const nowMs = options.nowMs ?? Date.now();
  const dryRun = options.dryRun === true;
  const deadline = Date.now() + (options.deadlineMs ?? 240_000);
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 200) || 200, 1), 500);
  const gapMs = options.gapMs ?? 2_000;
  const day = utcDay(nowMs);

  const result: StreamSweepResult = {
    ok: true,
    tableReady: true,
    dryRun,
    due: 0,
    read: 0,
    noMatch: 0,
    failed: 0,
    skipped: 0,
    matchedToday: 0,
    failures: {},
  };
  const note = (reason: string) => {
    result.failures[reason] = (result.failures[reason] ?? 0) + 1;
  };

  let due: DueSong[];
  try {
    due = await dueSongs(day, limit, true);
  } catch (e) {
    if (!isMissingSongStreamTable(e)) throw e;
    /* Before the table exists the cron reads nothing: a reading it cannot
       store is a wasted visit to Spotify every day. A dry run still reads,
       because checking that Spotify answers from production is what it is
       for, and that check has to come before the table is created. */
    if (!dryRun) return { ...result, tableReady: false };
    result.tableReady = false;
    due = await dueSongs(day, limit, false);
  }
  result.due = due.length;
  if (!due.length) return result;

  const reader = options.reader ?? createSpotifyReader();
  let errorsInARow = 0;
  try {
    for (const [i, song] of due.entries()) {
      if (Date.now() > deadline || errorsInARow >= STOP_AFTER_ERRORS) {
        result.skipped = due.length - i;
        break;
      }
      if (i > 0) await pause(gapMs);

      /* A track found on an earlier day is reused, so a song is searched once,
         not daily -- unless the song was edited since, when its title, artist
         or ISRC may no longer describe that track. */
      const known = song.streamReadings[0];
      const knownTrackId = known?.spotifyTrackId && known.recordedAt >= song.updatedAt ? known.spotifyTrackId : null;

      let outcome: Outcome;
      try {
        outcome = await readSong(
          reader,
          { title: song.title, artist: song.artist, isrc: song.isrc, soundArtist: song.sound?.artist ?? null },
          knownTrackId,
          gapMs
        );
        errorsInARow = 0;
      } catch (e) {
        errorsInARow++;
        outcome = {
          kind: "failed",
          trackId: knownTrackId,
          failure: `read failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`.slice(0, 200),
          searched: false,
        };
      }

      if (outcome.kind === "read") {
        result.read++;
        if (outcome.searched) result.matchedToday++;
      } else if (outcome.kind === "no-match") {
        result.noMatch++;
        note(outcome.failure);
      } else {
        result.failed++;
        note(outcome.failure);
      }
      if (dryRun) continue;

      const row =
        outcome.kind === "read"
          ? {
              spotifyTrackId: outcome.trackId,
              trackName: outcome.trackName,
              trackArtists: outcome.trackArtists,
              playCount: BigInt(outcome.playCount),
              failure: null,
            }
          : {
              spotifyTrackId: outcome.kind === "failed" ? outcome.trackId : null,
              trackName: null,
              trackArtists: null,
              playCount: null,
              failure: outcome.failure,
            };
      await db.songStreamSnapshot.upsert({
        where: { songId_day: { songId: song.id, day } },
        create: { songId: song.id, orgId: song.orgId, day, ...row },
        update: { ...row, recordedAt: new Date(nowMs) },
      });
    }
  } finally {
    if (!options.reader) await reader.close().catch(() => {});
  }

  log.info("song stream snapshot run", {
    due: result.due,
    read: result.read,
    noMatch: result.noMatch,
    failed: result.failed,
    skipped: result.skipped,
    matchedToday: result.matchedToday,
    dryRun,
  });
  return result;
}
