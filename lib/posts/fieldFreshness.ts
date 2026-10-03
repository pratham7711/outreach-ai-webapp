import { measuredFields, snapshotViewsKnown } from "@/lib/metricDisplay";
import { writerNotes } from "@/lib/metrics/postWriters";
import { formatDateAbs, formatDateTimeAbs } from "@/lib/format";

/**
 * A post's views figure, when the latest read did not carry it.
 *
 * A partial read keeps the views it did not get: the post goes on showing the
 * last figure it held, which is right, and the row's "Updated" age moves to
 * the new read, which made that figure look as fresh as the comments beside
 * it. On 2026-10-02 none of the 109 Instagram readings taken carried views
 * (Business Discovery was throttled), and each of those posts showed a views
 * figure under "Updated just now" that no read that day had returned.
 *
 * So the views figure carries its own date wherever that happens, taken from
 * the two places a views reading leaves a time: the per-counter writer note
 * (__writers.views.at, the last time any read wrote views -- reliable from
 * 2026-10-02, when the note started being kept for every write) and the newest
 * snapshot whose list includes views. The later of the two wins. Neither is
 * there for a figure only an older read wrote, and then the label says so
 * without a date rather than inventing one.
 */

type SnapshotLike = {
  recordedAt: string | Date | null | undefined;
  viewsCount: number | null | undefined;
  platformMetrics?: unknown;
};

const time = (v: string | Date | null | undefined): number | null => {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/**
 * When views were last actually read, as an ISO string, or null when nothing
 * on the post says. `snapshots` may be in any order; only rows that measured
 * views count, under snapshotViewsKnown's rule.
 */
export function viewsReadAt(platformMetrics: unknown, snapshots: readonly SnapshotLike[] = []): string | null {
  let best = time(writerNotes(platformMetrics).views?.at);
  for (const s of snapshots) {
    if (!snapshotViewsKnown({ viewsCount: s.viewsCount, platformMetrics: s.platformMetrics })) continue;
    const t = time(s.recordedAt);
    if (t !== null && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/**
 * Whether the views figure on show came from an earlier read than the latest.
 * Only a figure that is shown counts: a 0 the read left out is already shown as
 * unknown (fieldMetricValue), and a post with no measured list predates the
 * list and has nothing to compare with.
 */
export function viewsCarried(viewsCount: number | null | undefined, platformMetrics: unknown): boolean {
  if (typeof viewsCount !== "number" || viewsCount <= 0) return false;
  const fields = measuredFields(platformMetrics);
  return fields !== null && !fields.includes("views");
}

export type ViewsAsOf = {
  /** The views reading's own time, or null when nothing recorded it. */
  at: string | null;
  /** "as of 1 Oct 2026", to sit beside the figure. */
  short: string;
  /** "Views as of 1 Oct 2026", to stand on its own under the figure. */
  sentence: string;
  /** The full sentence, for a tooltip. */
  title: string;
};

/** The as-of for a carried views figure, or null when the figure is current. */
export function viewsAsOf(post: {
  viewsCount: number | null | undefined;
  platformMetrics?: unknown;
  viewsReadAt?: string | null;
}): ViewsAsOf | null {
  if (!viewsCarried(post.viewsCount, post.platformMetrics)) return null;
  const at = post.viewsReadAt && time(post.viewsReadAt) !== null ? post.viewsReadAt : null;
  return at
    ? {
        at,
        short: `as of ${formatDateAbs(at)}`,
        sentence: `Views as of ${formatDateAbs(at)}`,
        title: `The latest read did not return views. This figure was read ${formatDateTimeAbs(at)} UTC.`,
      }
    : {
        at: null,
        short: "earlier reading",
        sentence: "Views from an earlier reading",
        title: "The latest read did not return views. This figure is from an earlier reading.",
      };
}
