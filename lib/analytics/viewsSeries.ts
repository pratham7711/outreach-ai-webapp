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

/**
 * One row per day on which anything is known, each carrying every group's
 * running view total as of that day.
 *
 * `groups` fixes the columns, so a group with no posts still gets an explicit 0
 * rather than an absent key the chart would read as a gap.
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
  const withSnapshots = new Set<string>();
  const days = new Set<string>();

  for (const snap of snapshots) {
    if (!groupByPost.has(snap.postId)) continue;
    const day = dayKey(snap.recordedAt);
    const at = snap.recordedAt.getTime();
    let ofDay = latest.get(day);
    if (!ofDay) latest.set(day, (ofDay = new Map()));
    const existing = ofDay.get(snap.postId);
    if (!existing || at >= existing.at) {
      ofDay.set(snap.postId, { at, views: snap.viewsCount ?? 0 });
    }
    withSnapshots.add(snap.postId);
    days.add(day);
  }

  /* A post nobody ever snapshotted still published on a day and still has views.
     Its posting day joins the axis and its current count carries from there. */
  const firstSeen = new Map<string, { postId: string; views: number }[]>();
  for (const post of posts) {
    if (withSnapshots.has(post.id)) continue;
    const day = dayKey(post.postedAt);
    days.add(day);
    const bucket = firstSeen.get(day);
    const entry = { postId: post.id, views: post.viewsCount ?? 0 };
    if (bucket) bucket.push(entry);
    else firstSeen.set(day, [entry]);
  }

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

  for (const day of Array.from(days).sort()) {
    for (const [postId, reading] of latest.get(day) ?? []) {
      apply(postId, reading.views);
    }
    for (const entry of firstSeen.get(day) ?? []) {
      apply(entry.postId, entry.views);
    }

    // A copy per row: the caller spreads these into chart data and would
    // otherwise get every row pointing at the same mutating object.
    rows.push({ date: day, totals: { ...running } });
  }

  return rows;
}
