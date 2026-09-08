/**
 * The shared views-over-time carry-forward.
 *
 * PostMetricSnapshot.viewsCount is a LEVEL — a post's lifetime views as of that
 * reading. /api/analytics/campaigns added every reading that landed on a day, so
 * an hourly-synced post contributed its whole view count up to 24 times over,
 * while lib/reports/campaignPerformance carried forward the latest reading per
 * post per day. Same chart title, two answers. This is the one implementation.
 */
import { carryForwardViewsByDay } from "@/lib/analytics/viewsSeries";

const at = (iso: string) => new Date(iso);

describe("carryForwardViewsByDay", () => {
  /* The bug, named. Two readings of ONE post on ONE day are one post's views. */
  it("takes the latest reading of a day rather than summing the day's readings", () => {
    const rows = carryForwardViewsByDay({
      posts: [{ id: "p1", group: "camp-1", postedAt: at("2026-09-01T00:00:00Z"), viewsCount: 1_200 }],
      snapshots: [
        { postId: "p1", recordedAt: at("2026-09-02T01:00:00Z"), viewsCount: 1_000 },
        { postId: "p1", recordedAt: at("2026-09-02T13:00:00Z"), viewsCount: 1_200 },
      ],
      groups: ["camp-1"],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ date: "2026-09-02", totals: { "camp-1": 1_200 } });
    // Emphatically not 1,000 + 1,200.
    expect(rows[0].totals["camp-1"]).not.toBe(2_200);
  });

  it("does not depend on the order the snapshots arrive in", () => {
    const rows = carryForwardViewsByDay({
      posts: [{ id: "p1", group: "g", postedAt: at("2026-09-01T00:00:00Z"), viewsCount: 0 }],
      snapshots: [
        { postId: "p1", recordedAt: at("2026-09-02T13:00:00Z"), viewsCount: 1_200 },
        { postId: "p1", recordedAt: at("2026-09-02T01:00:00Z"), viewsCount: 1_000 },
      ],
      groups: ["g"],
    });
    expect(rows[0].totals.g).toBe(1_200);
  });

  /* A post with no reading today has not lost its views. Summing only the day's
     own readings made the line collapse whenever a sync covered fewer posts. */
  it("carries a post's last reading forward through days it was not synced", () => {
    const rows = carryForwardViewsByDay({
      posts: [
        { id: "p1", group: "g", postedAt: at("2026-09-01T00:00:00Z"), viewsCount: 100 },
        { id: "p2", group: "g", postedAt: at("2026-09-01T00:00:00Z"), viewsCount: 500 },
      ],
      snapshots: [
        { postId: "p1", recordedAt: at("2026-09-02T00:00:00Z"), viewsCount: 100 },
        { postId: "p2", recordedAt: at("2026-09-02T00:00:00Z"), viewsCount: 400 },
        // Day three: only p2 was synced.
        { postId: "p2", recordedAt: at("2026-09-03T00:00:00Z"), viewsCount: 500 },
      ],
      groups: ["g"],
    });

    expect(rows.map((r) => r.totals.g)).toEqual([500, 600]);
  });

  /* The consistency fix: campaignPerformance charted unsnapshotted posts from
     their posting day when NO post had snapshots, and dropped them entirely when
     some other post did — so the line ran below the campaign's own Total Views. */
  it("charts a post with no snapshots from its posting day forward", () => {
    const rows = carryForwardViewsByDay({
      posts: [
        { id: "snapped", group: "g", postedAt: at("2026-09-01T00:00:00Z"), viewsCount: 900 },
        { id: "imported", group: "g", postedAt: at("2026-09-02T00:00:00Z"), viewsCount: 300 },
      ],
      snapshots: [
        { postId: "snapped", recordedAt: at("2026-09-01T06:00:00Z"), viewsCount: 800 },
        { postId: "snapped", recordedAt: at("2026-09-03T06:00:00Z"), viewsCount: 900 },
      ],
      groups: ["g"],
    });

    expect(rows).toEqual([
      { date: "2026-09-01", totals: { g: 800 } },
      { date: "2026-09-02", totals: { g: 1_100 } }, // 800 carried + the import's 300
      { date: "2026-09-03", totals: { g: 1_200 } },
    ]);
  });

  it("accumulates an all-imported campaign rather than drawing each day's batch", () => {
    const rows = carryForwardViewsByDay({
      posts: [
        { id: "a", group: "g", postedAt: at("2026-09-01T00:00:00Z"), viewsCount: 1_400 },
        { id: "b", group: "g", postedAt: at("2026-09-02T00:00:00Z"), viewsCount: 450 },
        { id: "c", group: "g", postedAt: at("2026-09-03T00:00:00Z"), viewsCount: 0 },
      ],
      snapshots: [],
      groups: ["g"],
    });

    // Not 1,400 / 450 / 0, which read as the campaign collapsing.
    expect(rows.map((r) => r.totals.g)).toEqual([1_400, 1_850, 1_850]);
  });

  it("keeps each group in its own column and zeroes the ones with nothing yet", () => {
    const rows = carryForwardViewsByDay({
      posts: [
        { id: "p1", group: "TIKTOK", postedAt: at("2026-09-01T00:00:00Z"), viewsCount: 10 },
        { id: "p2", group: "INSTAGRAM", postedAt: at("2026-09-02T00:00:00Z"), viewsCount: 20 },
      ],
      snapshots: [],
      groups: ["TIKTOK", "INSTAGRAM", "YOUTUBE"],
    });

    expect(rows).toEqual([
      { date: "2026-09-01", totals: { TIKTOK: 10, INSTAGRAM: 0, YOUTUBE: 0 } },
      { date: "2026-09-02", totals: { TIKTOK: 10, INSTAGRAM: 20, YOUTUBE: 0 } },
    ]);
  });

  it("ignores a snapshot whose post is not in scope", () => {
    const rows = carryForwardViewsByDay({
      posts: [{ id: "p1", group: "g", postedAt: at("2026-09-01T00:00:00Z"), viewsCount: 5 }],
      snapshots: [{ postId: "other", recordedAt: at("2026-09-05T00:00:00Z"), viewsCount: 999_999 }],
      groups: ["g"],
    });

    expect(rows).toEqual([{ date: "2026-09-01", totals: { g: 5 } }]);
  });

  it("returns no rows when there is nothing to chart", () => {
    expect(carryForwardViewsByDay({ posts: [], snapshots: [], groups: ["g"] })).toEqual([]);
  });
});

/**
 * The day loop used to re-sum every post's last known reading on every day it
 * emitted -- O(posts x days) to produce one row per day. It now carries running
 * per-group totals and moves them by the delta of the posts that actually got a
 * reading that day. That is a rewrite of the arithmetic, not a refactor of it,
 * so the old implementation is kept HERE, in the test, and the two are compared
 * on randomized inputs. It exists only to be the oracle; nothing ships it.
 */
function carryForwardViewsByDay_reSum<G extends string>(input: {
  posts: readonly { id: string; group: G; postedAt: Date; viewsCount: number | null }[];
  snapshots: readonly { postId: string; recordedAt: Date; viewsCount: number | null }[];
  groups: readonly G[];
}): { date: string; totals: Record<G, number> }[] {
  const { posts, snapshots, groups } = input;
  const groupByPost = new Map<string, G>(posts.map((p) => [p.id, p.group]));
  const latest = new Map<string, Map<string, { at: number; views: number }>>();
  const withSnapshots = new Set<string>();
  const days = new Set<string>();

  for (const snap of snapshots) {
    if (!groupByPost.has(snap.postId)) continue;
    const day = snap.recordedAt.toISOString().slice(0, 10);
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

  const firstSeen = new Map<string, { postId: string; views: number }[]>();
  for (const post of posts) {
    if (withSnapshots.has(post.id)) continue;
    const day = post.postedAt.toISOString().slice(0, 10);
    days.add(day);
    const bucket = firstSeen.get(day);
    const entry = { postId: post.id, views: post.viewsCount ?? 0 };
    if (bucket) bucket.push(entry);
    else firstSeen.set(day, [entry]);
  }

  const lastKnown = new Map<string, number>();
  const rows: { date: string; totals: Record<G, number> }[] = [];
  for (const day of Array.from(days).sort()) {
    for (const [postId, reading] of latest.get(day) ?? []) lastKnown.set(postId, reading.views);
    for (const entry of firstSeen.get(day) ?? []) lastKnown.set(entry.postId, entry.views);

    const totals = Object.fromEntries(groups.map((g) => [g, 0])) as Record<G, number>;
    for (const [postId, views] of lastKnown) {
      const group = groupByPost.get(postId);
      if (group !== undefined && group in totals) totals[group] += views;
    }
    rows.push({ date: day, totals });
  }
  return rows;
}

describe("carryForwardViewsByDay — equivalence with the re-summing implementation", () => {
  /* A tiny deterministic PRNG, so a failure is reproducible from the seed
     printed in the assertion rather than gone on the next run. */
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1_664_525 + 1_013_904_223) >>> 0;
      return s / 0x1_0000_0000;
    };
  }

  const GROUPS = ["TIKTOK", "INSTAGRAM", "YOUTUBE"] as const;
  const DAY_MS = 86_400_000;
  const EPOCH = Date.UTC(2026, 0, 1);

  it("produces identical rows on 300 randomized inputs", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed);
      const int = (n: number) => Math.floor(rand() * n);

      // Small on purpose: overlapping days, repeated readings on one day, posts
      // with no snapshots, snapshots for posts out of scope, and groups that
      // never appear are all likely at these sizes.
      const postCount = 1 + int(5);
      const posts = Array.from({ length: postCount }, (_, i) => ({
        id: `p${i}`,
        group: GROUPS[int(GROUPS.length)],
        postedAt: new Date(EPOCH + int(6) * DAY_MS + int(DAY_MS)),
        // Whole view counts, as every writer of this column produces.
        viewsCount: rand() < 0.15 ? null : int(5_000),
      }));

      const snapCount = int(14);
      const snapshots = Array.from({ length: snapCount }, () => ({
        // ~1 in 8 references a post that is not in scope at all.
        postId: rand() < 0.125 ? "ghost" : `p${int(postCount)}`,
        recordedAt: new Date(EPOCH + int(6) * DAY_MS + int(DAY_MS)),
        viewsCount: rand() < 0.1 ? null : int(20_000),
      }));

      // A group with no posts must still get an explicit 0 column.
      const groups = rand() < 0.3 ? GROUPS.slice(0, 2) : GROUPS;

      const expected = carryForwardViewsByDay_reSum({ posts, snapshots, groups });
      const actual = carryForwardViewsByDay({ posts, snapshots, groups });
      expect({ seed, rows: actual }).toEqual({ seed, rows: expected });
    }
  });
});
