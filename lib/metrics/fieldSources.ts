/**
 * One writer per field (plan A7, A8).
 *
 * A creator's follower count, or a post's views, can arrive from more than one
 * place: the creator's own connection (the platform's API, read with their
 * token), a public read of their profile or post page, and the figure someone
 * typed in. Each used to be written by whichever path ran last, so a public
 * read could put a stale scrape over the number the creator's own connection
 * had reported an hour before, and the tracker's change column then showed a
 * movement that was only a change of source.
 *
 * FIELD_SOURCES names, per field, which sources may write it and in what order
 * of trust, and how long a trusted value stays protected: within `freshnessMs`
 * of being measured, a value from a higher-ranked source is not replaced by a
 * lower-ranked one. Past it, the newest reading wins whatever its source,
 * because an old exact figure is no longer the better answer.
 *
 * "manual" is a source a caller can name but no field lists, and the type does
 * not let one be added: a typed-in figure is the agency's note, not a reading,
 * and is never what a computed change (a delta, a growth rate, a precision
 * anchor) is measured from.
 */

export type MetricSource = "connected" | "public" | "manual";

/** A source that may write a field. Excludes "manual" by construction. */
export type WriterSource = Exclude<MetricSource, "manual">;

export type FieldSourceRule = {
  /** Highest trust first. */
  sources: readonly WriterSource[];
  /** How long a value stays protected from lower-ranked writers. */
  freshnessMs: number;
};

const HOUR = 60 * 60 * 1000;

export const FIELD_SOURCES = {
  /* Creator.followersCount and the tracker snapshot. The connection's figure
     is refreshed once a day (lib/platforms/connectionRefresh), so 36h is that
     day with half a day of slack for a late cron. */
  "creator.followers": { sources: ["connected", "public"], freshnessMs: 36 * HOUR },
  "creator.avgViews": { sources: ["connected", "public"], freshnessMs: 36 * HOUR },
  /* CreatorSocialAccount.followersCount: the connection's own stats. Nothing
     but the connection may write them. */
  "account.followers": { sources: ["connected"], freshnessMs: 36 * HOUR },
  /* Post counters move by the hour while a post is young; six hours is the
     slowest post-tracking cadence an org can choose short of "daily". */
  "post.views": { sources: ["connected", "public"], freshnessMs: 6 * HOUR },
  "post.likes": { sources: ["connected", "public"], freshnessMs: 6 * HOUR },
  "post.comments": { sources: ["connected", "public"], freshnessMs: 6 * HOUR },
  "post.shares": { sources: ["connected", "public"], freshnessMs: 6 * HOUR },
  "post.saves": { sources: ["connected", "public"], freshnessMs: 6 * HOUR },
  /* Reach exists only in the creator's own insights; no public page shows it. */
  "post.reach": { sources: ["connected"], freshnessMs: 6 * HOUR },
} as const satisfies Record<string, FieldSourceRule>;

export type MetricField = keyof typeof FIELD_SOURCES;

/** 0 for the most trusted source of this field; null when it may not write it. */
export function sourceRank(field: MetricField, source: MetricSource): number | null {
  const i = (FIELD_SOURCES[field].sources as readonly MetricSource[]).indexOf(source);
  return i === -1 ? null : i;
}

export type WriterCandidate = {
  source: MetricSource;
  value: number | null | undefined;
  /** When the value was measured at its source, not when it was stored here. */
  measuredAt: Date | null | undefined;
};

function usable<C extends WriterCandidate>(field: MetricField, c: C): c is C & { value: number; measuredAt: Date } {
  return (
    sourceRank(field, c.source) !== null &&
    typeof c.value === "number" &&
    Number.isFinite(c.value) &&
    c.measuredAt instanceof Date &&
    Number.isFinite(c.measuredAt.getTime())
  );
}

/**
 * Which candidate writes `field`, or null when none may.
 *
 *  1. A candidate whose source the field does not list ("manual", always) is
 *     dropped, as is one with no value or no measurement time.
 *  2. Among those measured within the field's freshness window, the most
 *     trusted source wins; the newer reading breaks a tie.
 *  3. When none is fresh, the newest reading wins whatever its source.
 *
 * Generic over the candidate so a caller gets its own object back, with
 * whatever it carried alongside.
 */
export function pickWriter<C extends WriterCandidate>(
  field: MetricField,
  candidates: readonly C[],
  now: Date = new Date(),
): (C & { value: number; measuredAt: Date }) | null {
  const eligible = candidates.filter((c): c is C & { value: number; measuredAt: Date } => usable(field, c));
  if (eligible.length === 0) return null;
  const window = FIELD_SOURCES[field].freshnessMs;
  const fresh = eligible.filter((c) => now.getTime() - c.measuredAt.getTime() <= window);
  const newestFirst = (a: { measuredAt: Date }, b: { measuredAt: Date }) =>
    b.measuredAt.getTime() - a.measuredAt.getTime();
  if (fresh.length > 0) {
    return [...fresh].sort(
      (a, b) =>
        (sourceRank(field, a.source) as number) - (sourceRank(field, b.source) as number) || newestFirst(a, b),
    )[0];
  }
  return [...eligible].sort(newestFirst)[0];
}

/**
 * Whether a write from `incoming` may replace what `current` wrote.
 *
 * The same rule as pickWriter, for a write site that knows only what is stored
 * and what it holds: a value written by a more trusted source within the
 * field's freshness window stays. A current value from a source the field
 * does not list (a typed-in figure) never blocks a real reading, and neither
 * does one with no known write time.
 */
export function mayOverwrite(
  field: MetricField,
  current: { source: MetricSource; writtenAt: Date | null | undefined },
  incoming: { source: MetricSource },
  now: Date = new Date(),
): boolean {
  const incomingRank = sourceRank(field, incoming.source);
  if (incomingRank === null) return false;
  const currentRank = sourceRank(field, current.source);
  if (currentRank === null) return true;
  if (incomingRank <= currentRank) return true;
  if (!(current.writtenAt instanceof Date)) return true;
  return now.getTime() - current.writtenAt.getTime() > FIELD_SOURCES[field].freshnessMs;
}
