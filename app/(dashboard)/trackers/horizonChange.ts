import type { SeriesPoint } from "./SoundCharts";

type HorizonChange = { added: number; percent: number | null };

/**
 * Change across a horizon, computed from the same series the charts draw so a
 * number and the picture above it can never disagree.
 *
 * Three answers, not two. Falling back to `series[0]` when nothing predates the
 * cutoff made every horizon longer than the series print the SAME number under
 * four different labels: the list endpoint fetches 60 rows by default
 * (snapshotFetchLimit), which is ten days at the four-hourly cadence, so
 * "14-Day Change" and "30-Day Change" were both the ten-day gain wearing a
 * borrowed label. A span we do not have is not a zero and not the whole series
 * — it is an absence, and it says so.
 */
export function changeOver(
  series: SeriesPoint[],
  days: number
): HorizonChange | "short-history" | null {
  if (series.length < 2) return null;
  const latest = series[series.length - 1];
  const cutoff = new Date(latest.recordedAt).getTime() - days * 86400_000;
  const baseline = [...series]
    .reverse()
    .find((p) => new Date(p.recordedAt).getTime() <= cutoff);
  if (!baseline) return "short-history";
  if (baseline === latest) return null;
  const added = latest.value - baseline.value;
  return {
    added,
    percent: baseline.value > 0 ? (added / baseline.value) * 100 : null,
  };
}
