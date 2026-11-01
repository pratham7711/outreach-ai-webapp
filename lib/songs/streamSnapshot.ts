import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";
import type { SpotifyReader } from "@/lib/platforms/spotifyWeb";
import { pickSpotifyTrack, searchQueries, type SongForMatch } from "./spotifyMatch";
import { openSpotifyReads, type SpotifyReads } from "./spotifyReads";
import { isMissingSongStreamTable } from "./streamSnapshotDdl";
import { isMissingSongLinkColumn } from "./songLinkDdl";
import { NOT_REMOVED } from "@/lib/posts/removed";

/**
 * Once a day, each promoted song's Spotify play count.
 *
 * The whole of what this reads, by design: one track page per song per UTC day,
 * plus a search page for a song whose Spotify track is not known yet. A song
 * whose track was linked on the campaign (Song.spotifyTrackId) reads that track
 * and is never searched. Nothing on demand, no button, no other Spotify page --
 * the one exception is the first reading right after a link is saved
 * (primeSongStreams below), which is this same read for that one song. A song
 * is read only while a campaign promoting it is open (Pending or In progress);
 * a closed campaign's report keeps the readings it already has.
 *
 * Every count comes through lib/songs/spotifyReads, the seam a signed-in
 * reader will replace, and a count Spotify hides (it says 0) is stored as no
 * count with the reason, never as 0.
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
  /** Songs on an open campaign (or one inside its post-completion tail) with no row for today, before this run. */
  due: number;
  read: number;
  noMatch: number;
  failed: number;
  /** Due, but not reached: out of time, or the run stopped on errors. */
  skipped: number;
  /** How many of today's tracks came from a search rather than an earlier reading. */
  matchedToday: number;
  /** Read, but Spotify publishes no count for the track (yet). Not a failure of ours. */
  hidden: number;
  /** False while Song.spotifyTrackId does not exist: every song is matched by title and artist. */
  linkReady: boolean;
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
  | { kind: "hidden"; trackId: string; trackName: string; trackArtists: string; searched: boolean }
  | { kind: "no-match"; failure: string }
  | { kind: "failed"; trackId: string | null; failure: string; searched: boolean };

/** The failure a row carries when Spotify answered for the track but shows no count. */
export const HIDDEN_COUNT_FAILURE = "play count hidden by Spotify";

const pause = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/**
 * One song's reading. `knownTrackId` is the linked track, or one an earlier
 * day found; with it there is no search.
 */
async function readSong(
  reads: SpotifyReads,
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
      const match = pickSpotifyTrack(song, await reads.searchSpotifyTracks(q));
      if (match) {
        trackId = match.hit.id;
        break;
      }
    }
    if (!trackId) return { kind: "no-match", failure: "no Spotify track with this title and artist" };
    await pause(gapMs);
  }
  const reading = await reads.readSpotifyTrack(trackId);
  if (!reading) return { kind: "failed", trackId, failure: "track page gave no track", searched };
  const named = { trackId, trackName: reading.name, trackArtists: reading.artists.join(", "), searched };
  if (reading.countHidden) return { kind: "hidden", ...named };
  if (reading.playCount === null) return { kind: "failed", trackId, failure: "track page gave no play count", searched };
  return { kind: "read", ...named, playCount: reading.playCount };
}

/** What a day's row holds for an outcome: a count, or the reason there is none. */
function rowFor(outcome: Outcome) {
  if (outcome.kind === "read") {
    return {
      spotifyTrackId: outcome.trackId,
      trackName: outcome.trackName,
      trackArtists: outcome.trackArtists,
      playCount: BigInt(outcome.playCount),
      failure: null,
    };
  }
  if (outcome.kind === "hidden") {
    return {
      spotifyTrackId: outcome.trackId,
      trackName: outcome.trackName,
      trackArtists: outcome.trackArtists,
      playCount: null,
      failure: HIDDEN_COUNT_FAILURE,
    };
  }
  return {
    spotifyTrackId: outcome.kind === "failed" ? outcome.trackId : null,
    trackName: null,
    trackArtists: null,
    playCount: null,
    failure: outcome.failure,
  };
}

type DueSong = {
  id: string;
  orgId: string;
  title: string;
  artist: string | null;
  isrc: string | null;
  updatedAt: Date;
  /** The linked track; absent while the column does not exist. */
  spotifyTrackId?: string | null;
  sound: { artist: string | null } | null;
  streamReadings: { spotifyTrackId: string | null; recordedAt: Date }[];
};

const OPEN_CAMPAIGN = { some: { deletedAt: null, status: { in: [...OPEN_CAMPAIGN_STATUSES] } } };

/** How long a finished campaign's song keeps being read: streams a campaign
 *  drove keep arriving after the last post, and the tail is part of the result. */
export const POST_COMPLETION_TAIL_DAYS = 30;

/**
 * The daily sweep's filter: an open campaign, or a COMPLETE one whose newest
 * live post is under POST_COMPLETION_TAIL_DAYS old. Campaign has no completion
 * date, so the newest post stands in for it. Priming on a link change keeps
 * OPEN_CAMPAIGN: a link set on a finished campaign waits for the next sweep.
 */
function sweepCampaign(nowMs: number) {
  const since = new Date(nowMs - POST_COMPLETION_TAIL_DAYS * 86_400_000);
  return {
    some: {
      deletedAt: null,
      OR: [
        { status: { in: [...OPEN_CAMPAIGN_STATUSES] } },
        { status: "COMPLETE" as const, posts: { some: { ...NOT_REMOVED, postedAt: { gte: since } } } },
      ],
    },
  };
}
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
 * Songs on an open campaign, or a finished one inside its tail, with no reading today. `withReadings: false` is
 * the same list for a database without the readings table, where every song
 * is due and none has a known track; `withLink: false` is the list for a
 * database without Song.spotifyTrackId, where no song has a linked track.
 */
async function dueSongs(day: Date, nowMs: number, limit: number, withReadings: boolean, withLink: boolean): Promise<DueSong[]> {
  /* `spotifyTrackId: false` leaves the column out of the SQL altogether. */
  const fields = { ...DUE_SONG_FIELDS, spotifyTrackId: withLink };
  const read = async (campaigns: object, take: number, skip: string[] = []): Promise<DueSong[]> => {
    const notIn = skip.length > 0 ? { id: { notIn: skip } } : {};
    if (!withReadings) {
      const songs = await db.song.findMany({
        where: { deletedAt: null, campaigns, ...notIn },
        select: fields,
        orderBy: { id: "asc" },
        take,
      });
      return songs.map((song) => ({ ...song, streamReadings: [] }));
    }
    return db.song.findMany({
      where: { deletedAt: null, campaigns, streamReadings: { none: { day } }, ...notIn },
      select: {
        ...fields,
        streamReadings: {
          where: { spotifyTrackId: { not: null } },
          orderBy: { day: "desc" },
          take: 1,
          select: { spotifyTrackId: true, recordedAt: true },
        },
      },
      orderBy: { id: "asc" },
      take,
    });
  };
  /* One read when everything due fits in the run. When it does not, songs on
     a running campaign go first and finished campaigns' tails take what is
     left: the tail is the extra, and must never push a live campaign's song
     past the limit. */
  const all = await read(sweepCampaign(nowMs), limit + 1);
  if (all.length <= limit) return all;
  const open = await read(OPEN_CAMPAIGN, limit);
  if (open.length >= limit) return open;
  return [...open, ...(await read(sweepCampaign(nowMs), limit - open.length, open.map((s) => s.id)))];
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
    hidden: 0,
    linkReady: true,
    failures: {},
  };
  const note = (reason: string) => {
    result.failures[reason] = (result.failures[reason] ?? 0) + 1;
  };

  /* Asked with the readings table and the link column first, and without
     whichever the database turns out not to have. Each can be missing on its
     own: the code ships before either piece of DDL runs. */
  let due: DueSong[] | null = null;
  let withReadings = true;
  while (!due) {
    try {
      due = await dueSongs(day, nowMs, limit, withReadings, result.linkReady);
    } catch (e) {
      if (result.linkReady && isMissingSongLinkColumn(e)) {
        result.linkReady = false;
        continue;
      }
      if (!withReadings || !isMissingSongStreamTable(e)) throw e;
      /* Before the table exists the cron reads nothing: a reading it cannot
         store is a wasted visit to Spotify every day. A dry run still reads,
         because checking that Spotify answers from production is what it is
         for, and that check has to come before the table is created. */
      if (!dryRun) return { ...result, tableReady: false };
      result.tableReady = false;
      withReadings = false;
    }
  }
  result.due = due.length;
  if (!due.length) return result;

  const reads = openSpotifyReads({ reader: options.reader });
  let errorsInARow = 0;
  try {
    for (const [i, song] of due.entries()) {
      if (Date.now() > deadline || errorsInARow >= STOP_AFTER_ERRORS) {
        result.skipped = due.length - i;
        break;
      }
      if (i > 0) await pause(gapMs);

      /* A linked track is the song's track, full stop. Without a link, a track
         found on an earlier day is reused, so a song is searched once, not
         daily -- unless the song was edited since, when its title, artist or
         ISRC may no longer describe that track. */
      const known = song.streamReadings[0];
      const knownTrackId =
        song.spotifyTrackId ||
        (known?.spotifyTrackId && known.recordedAt >= song.updatedAt ? known.spotifyTrackId : null);

      let outcome: Outcome;
      try {
        outcome = await readSong(
          reads,
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

      if (outcome.kind === "read" || outcome.kind === "hidden") {
        if (outcome.kind === "read") result.read++;
        else result.hidden++;
        if (outcome.searched) result.matchedToday++;
      } else if (outcome.kind === "no-match") {
        result.noMatch++;
        note(outcome.failure);
      } else {
        result.failed++;
        note(outcome.failure);
      }
      if (dryRun) continue;
      await writeDay(song.id, song.orgId, day, outcome, nowMs);
    }
  } finally {
    if (!options.reader) await reads.close().catch(() => {});
  }

  log.info("song stream snapshot run", {
    due: result.due,
    read: result.read,
    noMatch: result.noMatch,
    failed: result.failed,
    skipped: result.skipped,
    matchedToday: result.matchedToday,
    hidden: result.hidden,
    linkReady: result.linkReady,
    dryRun,
  });
  return result;
}

async function writeDay(songId: string, orgId: string, day: Date, outcome: Outcome, nowMs: number) {
  const row = rowFor(outcome);
  await db.songStreamSnapshot.upsert({
    where: { songId_day: { songId, day } },
    create: { songId, orgId, day, ...row },
    update: { ...row, recordedAt: new Date(nowMs) },
  });
}

export type PrimeStreamsResult =
  | "read"
  | "hidden"
  | "no-count"
  | "no-link"
  | "not-due"
  | "already-read"
  | "not-ready"
  | "read-failed";

/**
 * The first reading after a link is set or changed, instead of the next
 * morning's cron: the same read of that one song, written as today's row.
 *
 * Run in `after()` by the routes that save a link, so the operator's response
 * never waits for a browser. It reads only when the song carries a link and is
 * on an open campaign; when today's row already names the linked track there
 * is nothing to add, and when it names another track (the cron matched one
 * this morning, or the link before this one) it is replaced, so today's figure
 * is the linked track's.
 *
 * A read that throws writes nothing. The cron's own failure rows exist to stop
 * a second try the same day, and here a browser that would not start in this
 * function would otherwise cost the song the cron's read too.
 */
export async function primeSongStreams(
  orgId: string,
  songId: string,
  options: { nowMs?: number; reader?: SpotifyReader } = {}
): Promise<PrimeStreamsResult> {
  const nowMs = options.nowMs ?? Date.now();
  const day = utcDay(nowMs);

  let song: { title: string; artist: string | null; isrc: string | null; spotifyTrackId: string | null; sound: { artist: string | null } | null } | null;
  try {
    song = await db.song.findFirst({
      where: { id: songId, orgId, deletedAt: null, campaigns: OPEN_CAMPAIGN },
      select: { title: true, artist: true, isrc: true, spotifyTrackId: true, sound: { select: { artist: true } } },
    });
  } catch (e) {
    if (isMissingSongLinkColumn(e)) return "not-ready";
    throw e;
  }
  if (!song) return "not-due";
  const linked = song.spotifyTrackId;
  if (!linked) return "no-link";

  try {
    const today = await db.songStreamSnapshot.findUnique({
      where: { songId_day: { songId, day } },
      select: { spotifyTrackId: true },
    });
    if (today?.spotifyTrackId === linked) return "already-read";
  } catch (e) {
    if (isMissingSongStreamTable(e)) return "not-ready";
    throw e;
  }

  const reads = openSpotifyReads({ reader: options.reader });
  let outcome: Outcome;
  try {
    outcome = await readSong(
      reads,
      { title: song.title, artist: song.artist, isrc: song.isrc, soundArtist: song.sound?.artist ?? null },
      linked,
      0
    );
  } catch (e) {
    createLogger({ context: { job: "prime-song-streams" } }).warn("first spotify read failed", {
      songId,
      error: e instanceof Error ? e.message.split("\n")[0] : String(e),
    });
    return "read-failed";
  } finally {
    if (!options.reader) await reads.close().catch(() => {});
  }
  await writeDay(songId, orgId, day, outcome, nowMs);
  return outcome.kind === "read" ? "read" : outcome.kind === "hidden" ? "hidden" : "no-count";
}
