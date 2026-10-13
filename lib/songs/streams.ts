import { db } from "@/lib/db";
import { spotifyTrackUrl } from "@/lib/platforms/spotifyWeb";
import { isMissingSongStreamTable } from "./streamSnapshotDdl";
import { OPEN_CAMPAIGN_STATUSES } from "./streamSnapshot";

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
 */

export type CampaignStreams = {
  songTitle: string;
  track: { id: string; url: string; name: string; artists: string } | null;
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

/** Oldest first in, the card's figures out. Pure, for the unit tests. */
export function streamFigures(rows: readonly StreamRow[]): Pick<
  CampaignStreams,
  "track" | "totalPlays" | "latestDay" | "lastDay" | "sinceFirst" | "daily"
> {
  const read = rows
    .filter((r) => r.playCount !== null && r.spotifyTrackId)
    .map((r) => ({ ...r, day: isoDay(r.day), count: Number(r.playCount), trackId: r.spotifyTrackId as string }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const latest = read[read.length - 1];
  if (!latest) return { track: null, totalPlays: null, latestDay: null, lastDay: null, sinceFirst: null, daily: [] };

  /* Only the current track's readings: a song re-matched to another track
     after an edit starts a new history rather than subtracting two tracks. */
  const own = read.filter((r) => r.trackId === latest.trackId);
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

/** The note for a song with no figure yet, from its newest row. */
function noteFor(newest: StreamRow | undefined): string {
  if (!newest) return "Spotify is read once a day; this song's first reading has not happened yet.";
  if (!newest.spotifyTrackId) return "No Spotify track found with this song's title and artist (or ISRC).";
  return "Spotify did not give a play count at the last reading.";
}

/**
 * Null when the campaign has no song, the table is not there yet, or the
 * campaign is closed and was never read -- the card is absent, as the audio
 * card is on a campaign with no sound.
 */
export async function loadCampaignStreams(campaignId: string, orgId: string): Promise<CampaignStreams | null> {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, orgId },
    select: { status: true, song: { select: { id: true, title: true, deletedAt: true } } },
  });
  const song = campaign?.song;
  if (!song || song.deletedAt) return null;

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
    note: figures.totalPlays === null ? noteFor(rows[0]) : null,
  };
}
