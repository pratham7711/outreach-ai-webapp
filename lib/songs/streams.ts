import { db } from "@/lib/db";
import { spotifyTrackUrl } from "@/lib/platforms/spotifyWeb";
import { isMissingSongStreamTable } from "./streamSnapshotDdl";
import { HIDDEN_COUNT_FAILURE, OPEN_CAMPAIGN_STATUSES } from "./streamSnapshot";
import { withSongLinkColumns } from "./songLinks";

/**
 * The Spotify card's data: the promoted song's play count as the daily cron
 * read it, and the streams between readings.
 *
 * A day's streams are the difference between that day's count and the day
 * before's, and exist only where both days were read on the same Spotify
 * track. A missed day leaves a gap rather than a two-day figure printed as one,
 * and a count that went down (Spotify does correct them) is no figure at all,
 * never a negative one. "Since tracking began" is the latest count minus the
 * first, which stays right across a gap.
 *
 * A count Spotify hides is no count. Rows read since that rule say so with a
 * null and HIDDEN_COUNT_FAILURE; rows from before it stored Spotify's "0", and
 * 0 is read the same way here, so the day Spotify starts publishing is a first
 * reading, not one day carrying every play to date.
 */

export type CampaignStreams = {
  songTitle: string;
  track: { id: string; url: string; name: string; artists: string } | null;
  /**
   * "linked" when the track read is the one linked on the campaign
   * (Song.spotifyTrackId), "matched" when the cron found it by title and
   * artist. Null without a track. The dashboard says which; a share link never
   * carries it (redactForShare).
   */
  trackSource: "linked" | "matched" | null;
  /** Spotify's all-time count at the newest reading; null before the first. */
  totalPlays: number | null;
  /** YYYY-MM-DD (UTC) of the newest reading with a count. */
  latestDay: string | null;
  /** Streams on the newest day, when the day before was read too. */
  lastDay: number | null;
  sinceFirst: { streams: number; fromDay: string; days: number } | null;
  daily: { day: string; streams: number }[];
  /**
   * Why there is no figure, in words for the campaign's own tab. Null when
   * there is one. Never sent on a share link (redactForShare).
   */
  note: string | null;
};

export type StreamRow = {
  day: Date | string;
  spotifyTrackId: string | null;
  trackName: string | null;
  trackArtists: string | null;
  playCount: bigint | number | null;
  failure: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(d: Date | string): string {
  return (typeof d === "string" ? d : d.toISOString()).slice(0, 10);
}

function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** A count Spotify published, or null: a missing count, and 0, which is a hidden one. */
function publishedCount(r: StreamRow): number | null {
  if (r.playCount === null) return null;
  const n = Number(r.playCount);
  return n > 0 ? n : null;
}

/** The row says Spotify answered for the track and showed no count. */
export function isHiddenCount(r: StreamRow): boolean {
  return r.failure === HIDDEN_COUNT_FAILURE || (r.playCount !== null && Number(r.playCount) === 0);
}

/** Any order in, the card's figures out. Pure, for the unit tests. */
export function streamFigures(rows: readonly StreamRow[]): Pick<
  CampaignStreams,
  "track" | "totalPlays" | "latestDay" | "lastDay" | "sinceFirst" | "daily"
> {
  const days = rows.map((r) => ({ ...r, day: isoDay(r.day) })).sort((a, b) => a.day.localeCompare(b.day));

  /* The current track is the newest row that names one, counted or not. A
     song re-matched or re-linked to another track starts a new history rather
     than subtracting two tracks -- and if the new track's count is hidden, the
     card says so instead of showing the old track's total. A day with no
     track at all (no match) names nothing, and the track before it stands. */
  const current = days.findLast((r) => r.spotifyTrackId)?.spotifyTrackId ?? null;
  const own = days.flatMap((r) => {
    const count = publishedCount(r);
    return current && r.spotifyTrackId === current && count !== null ? [{ ...r, count, trackId: current }] : [];
  });
  const latest = own[own.length - 1];
  if (!latest) return { track: null, totalPlays: null, latestDay: null, lastDay: null, sinceFirst: null, daily: [] };

  /* Consecutive counted days of that one track only: a hidden or failed day
     is a gap like a missed one, so a newest hidden day leaves the last counted
     total and its day on the card. */
  const daily: CampaignStreams["daily"] = [];
  for (let i = 1; i < own.length; i++) {
    const prev = own[i - 1];
    const cur = own[i];
    if (dayMs(cur.day) - dayMs(prev.day) !== DAY_MS) continue;
    const streams = cur.count - prev.count;
    if (streams >= 0) daily.push({ day: cur.day, streams });
  }
  const first = own[0];
  const lastDaily = daily[daily.length - 1];
  return {
    track: {
      id: latest.trackId,
      url: spotifyTrackUrl(latest.trackId),
      name: latest.trackName ?? "",
      artists: latest.trackArtists ?? "",
    },
    totalPlays: latest.count,
    latestDay: latest.day,
    lastDay: lastDaily && lastDaily.day === latest.day ? lastDaily.streams : null,
    sinceFirst:
      own.length > 1 && latest.count >= first.count
        ? { streams: latest.count - first.count, fromDay: first.day, days: Math.round((dayMs(latest.day) - dayMs(first.day)) / DAY_MS) }
        : null,
    daily,
  };
}

export const HIDDEN_COUNT_NOTE =
  "Spotify isn't showing a play count for this track yet (it hides counts for small or new tracks). Daily streams start the day it does.";
export const ADD_LINK_NOTE = "Add the Spotify link in the campaign's audio settings.";

/**
 * The note for a song with no figure yet, from its newest row. With no track
 * and no link it says where the link goes; not while the link column is
 * missing, when Settings could not save one.
 */
function noteFor(newest: StreamRow | undefined, link: { trackId: string | null; ready: boolean }): string {
  const addLink = !link.trackId && link.ready ? ` ${ADD_LINK_NOTE}` : "";
  if (!newest) return `Spotify is read once a day; this song's first reading has not happened yet.${addLink}`;
  if (!newest.spotifyTrackId) return `No Spotify track found with this song's title and artist (or ISRC).${addLink}`;
  if (isHiddenCount(newest)) return HIDDEN_COUNT_NOTE;
  return "Spotify did not give a play count at the last reading.";
}

/**
 * Null when the campaign has no song, the table is not there yet, or the
 * campaign is closed and was never read -- the card is absent, as the audio
 * card is on a campaign with no sound.
 */
export async function loadCampaignStreams(campaignId: string, orgId: string): Promise<CampaignStreams | null> {
  /* The link rides on the campaign's own read, and is left out of it on a
     database without the column: the card then reads exactly as it did
     before links existed. */
  const { value: campaign, linkReady } = await withSongLinkColumns((withLink) =>
    db.campaign.findUnique({
      where: { id: campaignId },
      select: {
        orgId: true,
        status: true,
        song: { select: { id: true, title: true, deletedAt: true, spotifyTrackId: withLink } },
      },
    })
  );
  if (!campaign || campaign.orgId !== orgId) return null;
  const song = campaign.song;
  if (!song || song.deletedAt) return null;
  const linked = song.spotifyTrackId ?? null;

  let rows: StreamRow[];
  try {
    rows = await db.songStreamSnapshot.findMany({
      where: { songId: song.id, orgId },
      orderBy: { day: "desc" },
      take: 400,
      select: { day: true, spotifyTrackId: true, trackName: true, trackArtists: true, playCount: true, failure: true },
    });
  } catch (e) {
    if (isMissingSongStreamTable(e)) return null;
    throw e;
  }

  const figures = streamFigures(rows);
  const open = (OPEN_CAMPAIGN_STATUSES as readonly string[]).includes(campaign.status);
  if (figures.totalPlays === null && !open) return null;
  return {
    songTitle: song.title,
    ...figures,
    trackSource: figures.track ? (linked && figures.track.id === linked ? "linked" : "matched") : null,
    note: figures.totalPlays === null ? noteFor(rows[0], { trackId: linked, ready: linkReady }) : null,
  };
}
