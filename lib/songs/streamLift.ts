import type { CampaignStreams } from "./streams";

/**
 * Streams before and since a campaign's launch, from the daily readings the
 * Spotify card already draws.
 *
 * Which side of the launch a day falls on: a reading on day D is Spotify's
 * count early that morning (UTC), so D's streams (count on D minus count on
 * D-1) are mostly plays from D-1. The launch day's own figure is therefore
 * almost all pre-launch listening and counts as BEFORE; the first day counted
 * as SINCE is the day after the launch. Putting the launch day on the "since"
 * side would credit the campaign with a day it had not started.
 *
 * Averages use only the days with a figure (consecutive readings), so a missed
 * day is never folded into its neighbour. Each side needs LIFT_MIN_DAYS such
 * days before an average is shown; with fewer the card says how many it has.
 */

export const LIFT_MIN_DAYS = 3;

export type StreamLift =
  | {
      kind: "lift";
      launchDay: string;
      beforeAvg: number;
      sinceAvg: number;
      beforeDays: number;
      sinceDays: number;
      /** sinceAvg / beforeAvg; null when nothing was streamed before. */
      multiple: number | null;
      /** Latest count minus the last count on or before the launch day. */
      sinceStreams: number | null;
    }
  | {
      /** Reading began after the launch, so nothing before it was measured. */
      kind: "noBaseline";
      launchDay: string;
      firstReadDay: string;
      sinceStreams: null;
    }
  | {
      kind: "tooFew";
      launchDay: string;
      beforeDays: number;
      sinceDays: number;
      sinceStreams: number | null;
    };

function avg(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function streamLift(
  streams: Pick<CampaignStreams, "daily" | "plays">,
  launchDay: string | null | undefined,
): StreamLift | null {
  if (!launchDay) return null;
  const plays = streams.plays ?? [];
  if (plays.length === 0) return null;
  if (plays[0].day > launchDay) {
    return { kind: "noBaseline", launchDay, firstReadDay: plays[0].day, sinceStreams: null };
  }
  const baseline = plays.filter((p) => p.day <= launchDay).at(-1) ?? null;
  const latest = plays[plays.length - 1];
  const sinceStreams =
    baseline && latest.day > baseline.day && latest.count >= baseline.count ? latest.count - baseline.count : null;
  const before = streams.daily.filter((d) => d.day <= launchDay).map((d) => d.streams);
  const since = streams.daily.filter((d) => d.day > launchDay).map((d) => d.streams);
  if (before.length < LIFT_MIN_DAYS || since.length < LIFT_MIN_DAYS) {
    return { kind: "tooFew", launchDay, beforeDays: before.length, sinceDays: since.length, sinceStreams };
  }
  const beforeAvg = avg(before);
  const sinceAvg = avg(since);
  return {
    kind: "lift",
    launchDay,
    beforeAvg,
    sinceAvg,
    beforeDays: before.length,
    sinceDays: since.length,
    multiple: beforeAvg > 0 ? sinceAvg / beforeAvg : null,
    sinceStreams,
  };
}
