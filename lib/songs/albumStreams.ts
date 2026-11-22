import { spotifyTrackUrl } from "@/lib/platforms/spotifyWeb";

/**
 * A linked album's figures, worked out from one reading per track per day
 * (SongStreamTrackReading): the album as a whole, and each track on it.
 *
 * Every figure is a sum of per-track figures, never a difference of album
 * totals, because the album total moves for reasons that are not streams: a
 * version whose count Spotify hid (it does for small or new tracks) starting
 * to show it would otherwise land as one day carrying every play that version
 * ever had. So:
 *
 *   - a day's streams are the sum, over the tracks read with a count on that
 *     day AND the day before, of each one's increase; a track whose count went
 *     down (Spotify corrects them) adds nothing that day;
 *   - "since tracking began" is the sum of each track's newest count minus its
 *     first;
 *   - the total is the sum of the counts on the newest day read.
 *
 * Pure, for the unit tests.
 */

export type AlbumTrackRow = {
  day: Date | string;
  trackId: string;
  trackName: string | null;
  position: number;
  playCount: bigint | number | null;
};

export type AlbumVersion = {
  id: string;
  name: string;
  url: string;
  /** Spotify's count at the newest reading; null while Spotify hides it. */
  totalPlays: number | null;
  /** Streams on the newest day, when the day before was read too. */
  lastDay: number | null;
  /** Newest count minus the first; null with fewer than two counted days. */
  sinceFirst: number | null;
};

export type AlbumFigures = {
  totalPlays: number | null;
  latestDay: string | null;
  lastDay: number | null;
  sinceFirst: { streams: number; fromDay: string; days: number } | null;
  daily: { day: string; streams: number }[];
  plays: { day: string; count: number }[];
  versions: AlbumVersion[];
};

const DAY_MS = 86_400_000;

function isoDay(d: Date | string): string {
  return (typeof d === "string" ? d : d.toISOString()).slice(0, 10);
}

function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** A published count; 0 is Spotify hiding one, as for a single track (lib/songs/streams). */
function published(n: bigint | number | null): number | null {
  if (n === null) return null;
  const v = Number(n);
  return v > 0 ? v : null;
}

export function albumFigures(rows: readonly AlbumTrackRow[]): AlbumFigures {
  const byTrack = new Map<string, { name: string; position: number; counts: Map<string, number> }>();
  const days = new Set<string>();
  /* Newest row first, so a track's name and position are its newest. */
  const sorted = [...rows].map((r) => ({ ...r, day: isoDay(r.day) })).sort((a, b) => b.day.localeCompare(a.day));
  for (const r of sorted) {
    let t = byTrack.get(r.trackId);
    if (!t) {
      t = { name: r.trackName ?? "", position: r.position, counts: new Map() };
      byTrack.set(r.trackId, t);
    }
    const c = published(r.playCount);
    if (c !== null) {
      t.counts.set(r.day, c);
      days.add(r.day);
    }
  }

  const ordered = [...days].sort();
  const plays = ordered.map((day) => ({
    day,
    count: [...byTrack.values()].reduce((sum, t) => sum + (t.counts.get(day) ?? 0), 0),
  }));

  const daily: AlbumFigures["daily"] = [];
  for (const day of ordered) {
    const prev = new Date(dayMs(day) - DAY_MS).toISOString().slice(0, 10);
    let streams = 0;
    let any = false;
    for (const t of byTrack.values()) {
      const a = t.counts.get(prev);
      const b = t.counts.get(day);
      if (a === undefined || b === undefined) continue;
      any = true;
      if (b >= a) streams += b - a;
    }
    if (any) daily.push({ day, streams });
  }

  const latestDay = ordered[ordered.length - 1] ?? null;
  const latestDayStreams = daily.length && daily[daily.length - 1].day === latestDay ? daily[daily.length - 1].streams : null;

  const versions: AlbumVersion[] = [...byTrack.entries()]
    .sort((a, b) => a[1].position - b[1].position)
    .map(([id, t]) => {
      const counted = [...t.counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const first = counted[0];
      const last = counted[counted.length - 1];
      const prevOfLatest = latestDay ? t.counts.get(new Date(dayMs(latestDay) - DAY_MS).toISOString().slice(0, 10)) : undefined;
      const atLatest = latestDay ? t.counts.get(latestDay) : undefined;
      return {
        id,
        name: t.name,
        url: spotifyTrackUrl(id),
        totalPlays: last ? last[1] : null,
        lastDay: atLatest !== undefined && prevOfLatest !== undefined && atLatest >= prevOfLatest ? atLatest - prevOfLatest : null,
        sinceFirst: counted.length > 1 && last[1] >= first[1] ? last[1] - first[1] : null,
      };
    });

  const firstDay = ordered[0];
  const sinceSum = versions.reduce((sum, v) => sum + (v.sinceFirst ?? 0), 0);
  const anySince = versions.some((v) => v.sinceFirst !== null);

  return {
    totalPlays: latestDay ? plays[plays.length - 1].count : null,
    latestDay,
    lastDay: latestDayStreams,
    sinceFirst:
      anySince && latestDay && firstDay
        ? { streams: sinceSum, fromDay: firstDay, days: Math.round((dayMs(latestDay) - dayMs(firstDay)) / DAY_MS) }
        : null,
    daily,
    plays,
    versions,
  };
}
