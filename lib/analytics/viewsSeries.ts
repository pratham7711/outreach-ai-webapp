/**
 * Views over time, from snapshots that are LEVELS rather than daily takings.
 *
 * PostMetricSnapshot.viewsCount is a post's lifetime total as of that reading,
 * not the views it earned that day. Two facts follow, and every views-over-time
 * chart in the product has to honour both:
 *
 *  1. Readings of the same post on the same day must NOT be added. A post synced
 *     hourly writes up to 24 rows a day, and summing them multiplied that post's
 *     views by 24. Only the latest reading of the day counts.
 *
 *  2. A post with no reading on a given day has not lost its views. Summing only
 *     the day's own readings made the line collapse whenever a sync covered
 *     fewer posts than the one before -- 17 posts one day, 4 the next, and the
 *     chart showed a campaign losing three quarters of its views overnight. So
 *     each post's last known reading is carried forward until a newer one
 *     replaces it.
 *
 * A post with no snapshots at all (imported with its final numbers, or never
 * synced) contributes its current viewsCount from its posting day forward. That
 * is the same carry-forward rule with one reading, and it is why the two shapes
 * belong in one function: the campaign report and the analytics comparison used
 * to disagree about such posts, one dropping them from the chart entirely while
 * still counting them in its own totals.
 *
 * This lived inside lib/reports/campaignPerformance. It is here because
 * /api/analytics/campaigns needed the same thing and had reimplemented it as a
 * plain sum -- the 24x bug above, on the Campaign Comparison chart.
 */

export type ViewsSnapshot = {
  postId: string;
  recordedAt: Date;
  viewsCount: number | null;
};

export type ViewsSeriesPost<G extends string = string> = {
  id: string;
  /** Which line this post's views land on: a platform, a campaign id, whatever. */
  group: G;
  postedAt: Date;
  viewsCount: number | null;
};

export type ViewsSeriesRow<G extends string = string> = {
  /** YYYY-MM-DD, UTC. */
  date: string;
  totals: Record<G, number>;
};

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

/**
 * One row per UTC day, every day from the first thing known to the last, each
 * carrying every group's running view total as of that day.
 *
 * `groups` fixes the columns, so a group with no posts still gets an explicit 0
 * rather than an absent key the chart would read as a gap.
 *
 * Three rules beyond the two in the header, each from a measured chart:
 *
 *  - EVERY day, not only the days something was read. The chart's x-axis is a
 *    list of these dates, so a day with no reading used to vanish from it and a
 *    22-day gap was drawn the width of one day (an Instagram campaign read Sep 4,
 *    Sep 6, Sep 9, Sep 10, Oct 2 at equal spacing). Filling the days is what puts
 *    the axis to scale; the carry-forward is what makes the filled days true.
 *
 *  - A post's first reading stands from its POSTING day. Tracking often starts
 *    long after a post went live -- one production campaign posted from January
 *    and was first read on 19 September -- and charting each post only from its
 *    first reading drew 44.7M of a 58.8M campaign arriving on one September day,
 *    with the axis jumping from March straight to it. An unsnapshotted post was
 *    already charted from its posting day; a snapshotted one now is too, at the
 *    first level it was seen at.
 *
 *  - A reading of 0 views is not a level. Views are lifetime counts and do not
 *    return to zero, so a 0 is a read that did not see the views (a legacy row
 *    written before __measured existed, or a post read before it had any). It is
 *    skipped, and the post's last real level carries on through it. A post whose
 *    readings are ALL zero is charted like one with no readings: its own current
 *    count from its posting day, which is also what the Total Views tile sums.
 */
export function carryForwardViewsByDay<G extends string>(input: {
  posts: readonly ViewsSeriesPost<G>[];
  snapshots: readonly ViewsSnapshot[];
  groups: readonly G[];
}): ViewsSeriesRow<G>[] {
  const { posts, snapshots, groups } = input;

  const groupByPost = new Map<string, G>(posts.map((p) => [p.id, p.group]));

  /* Latest reading per post per day. Compared on recordedAt rather than trusting
     the caller's ordering: one query orders ascending, another does not, and the
     difference between them would silently be the difference between the first
     and last reading of the day. */
  const latest = new Map<string, Map<string, { at: number; views: number }>>();
  const firstDay = new Map<string, string>();

  for (const snap of snapshots) {
    if (!groupByPost.has(snap.postId)) continue;
    const views = snap.viewsCount;
    if (views === null || !(views > 0)) continue;
    const day = dayKey(snap.recordedAt);
    const at = snap.recordedAt.getTime();
    let ofDay = latest.get(day);
    if (!ofDay) latest.set(day, (ofDay = new Map()));
    const existing = ofDay.get(snap.postId);
    if (!existing || at >= existing.at) {
      ofDay.set(snap.postId, { at, views });
    }
    const first = firstDay.get(snap.postId);
    if (first === undefined || day < first) firstDay.set(snap.postId, day);
  }

  /* Where each post enters the chart, and at what level: its posting day (or its
     first reading, if a clock disagreement puts that earlier), at its first
     reading's level -- or, with no reading, at its current count. */
  const entries = new Map<string, { postId: string; views: number }[]>();
  let lo: string | undefined;
  let hi: string | undefined;
  const widen = (day: string) => {
    if (lo === undefined || day < lo) lo = day;
    if (hi === undefined || day > hi) hi = day;
  };
  for (const post of posts) {
    const posted = dayKey(post.postedAt);
    const first = firstDay.get(post.id);
    const day = first !== undefined && first < posted ? first : posted;
    const views = first !== undefined ? latest.get(first)!.get(post.id)!.views : post.viewsCount ?? 0;
    const bucket = entries.get(day);
    if (bucket) bucket.push({ postId: post.id, views });
    else entries.set(day, [{ postId: post.id, views }]);
    widen(day);
  }
  for (const day of latest.keys()) widen(day);
  if (lo === undefined || hi === undefined) return [];

  /* Running totals, moved by DELTAS, rather than re-summing every post on every
     day. The re-sum was O(posts x days) -- a campaign with 500 posts charted
     over a year did 180,000 map lookups to emit 365 rows, and both callers run
     it on a request path. A day only changes the posts that got a reading that
     day, so adding (new - old) for those and copying the running totals is the
     same arithmetic in O(readings + days x groups).

     Same arithmetic, not merely the same answer: view counts are whole numbers
     well inside 2^53, so the deltas are exact. The column is a Float, so a
     fractional count could in principle differ from the re-sum in its last bits
     -- nothing writes one, and the randomized test in
     __tests__/unit/lib/viewsSeries.test.ts pins equivalence on integers. */
  const lastKnown = new Map<string, number>();
  const running = Object.fromEntries(groups.map((g) => [g, 0])) as Record<G, number>;
  const rows: ViewsSeriesRow<G>[] = [];

  const apply = (postId: string, views: number) => {
    const previous = lastKnown.get(postId) ?? 0;
    lastKnown.set(postId, views);
    const group = groupByPost.get(postId);
    if (group !== undefined && group in running) running[group] += views - previous;
  };

  const end = Date.parse(`${hi}T00:00:00.000Z`);
  for (let t = Date.parse(`${lo}T00:00:00.000Z`); t <= end; t += DAY_MS) {
    const day = dayKey(new Date(t));
    for (const entry of entries.get(day) ?? []) {
      apply(entry.postId, entry.views);
    }
    for (const [postId, reading] of latest.get(day) ?? []) {
      apply(postId, reading.views);
    }

    // A copy per row: the caller spreads these into chart data and would
    // otherwise get every row pointing at the same mutating object.
    rows.push({ date: day, totals: { ...running } });
  }

  return rows;
}
