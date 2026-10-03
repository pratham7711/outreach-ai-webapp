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

    // The first day's level also stands on the posting day (see the backdating
    // test below), so two rows, both at the day's LAST reading.
    expect(rows).toEqual([
      { date: "2026-09-01", totals: { "camp-1": 1_200 } },
      { date: "2026-09-02", totals: { "camp-1": 1_200 } },
    ]);
    // Emphatically not 1,000 + 1,200.
    expect(rows[1].totals["camp-1"]).not.toBe(2_200);
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

    // 09-01 is both posts' posting day, carrying their first readings back.
    expect(rows.map((r) => r.totals.g)).toEqual([500, 500, 600]);
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

  /* The axis is the list of rows' dates, so a day with no row was a day missing
     from the axis: a 22-day gap drew as wide as one day. */
  it("emits every day between the first and last, carrying levels through the gap", () => {
    const rows = carryForwardViewsByDay({
      posts: [{ id: "p1", group: "g", postedAt: at("2026-09-04T10:00:00Z"), viewsCount: 900 }],
      snapshots: [
        { postId: "p1", recordedAt: at("2026-09-04T12:00:00Z"), viewsCount: 100 },
        { postId: "p1", recordedAt: at("2026-09-09T12:00:00Z"), viewsCount: 600 },
      ],
      groups: ["g"],
    });

    expect(rows.map((r) => r.date)).toEqual([
      "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09",
    ]);
    expect(rows.map((r) => r.totals.g)).toEqual([100, 100, 100, 100, 100, 600]);
  });

  it("crosses a month and a year boundary one UTC day at a time", () => {
    const rows = carryForwardViewsByDay({
      posts: [{ id: "p1", group: "g", postedAt: at("2026-12-30T23:59:59Z"), viewsCount: 7 }],
      snapshots: [{ postId: "p1", recordedAt: at("2027-01-02T00:00:00Z"), viewsCount: 9 }],
      groups: ["g"],
    });
    expect(rows.map((r) => r.date)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(rows.map((r) => r.totals.g)).toEqual([9, 9, 9, 9]);
  });

  /* Measured on production: a campaign posted from January and first read in
     September charted 44.7M of its 58.8M views arriving on one September day. */
  it("stands a post's first reading from its posting day, not from the day tracking began", () => {
    const rows = carryForwardViewsByDay({
      posts: [
        { id: "old", group: "g", postedAt: at("2026-01-08T00:00:00Z"), viewsCount: 5_000 },
        { id: "new", group: "g", postedAt: at("2026-01-10T00:00:00Z"), viewsCount: 50 },
      ],
      snapshots: [
        { postId: "old", recordedAt: at("2026-01-11T09:00:00Z"), viewsCount: 4_000 },
        { postId: "old", recordedAt: at("2026-01-12T09:00:00Z"), viewsCount: 5_000 },
        { postId: "new", recordedAt: at("2026-01-12T09:00:00Z"), viewsCount: 50 },
      ],
      groups: ["g"],
    });

    expect(rows.map((r) => [r.date, r.totals.g])).toEqual([
      ["2026-01-08", 4_000],
      ["2026-01-09", 4_000],
      ["2026-01-10", 4_050],
      ["2026-01-11", 4_050],
      ["2026-01-12", 5_050],
    ]);
  });

  it("skips a 0-view reading rather than dropping the post's views to zero", () => {
    const rows = carryForwardViewsByDay({
      posts: [{ id: "p1", group: "g", postedAt: at("2026-09-01T00:00:00Z"), viewsCount: 800 }],
      snapshots: [
        { postId: "p1", recordedAt: at("2026-09-01T06:00:00Z"), viewsCount: 700 },
        { postId: "p1", recordedAt: at("2026-09-02T06:00:00Z"), viewsCount: 0 },
        { postId: "p1", recordedAt: at("2026-09-03T06:00:00Z"), viewsCount: 800 },
      ],
      groups: ["g"],
    });
    expect(rows.map((r) => r.totals.g)).toEqual([700, 700, 800]);
  });

  /* Production's one campaign whose chart ended below its Total Views tile: six
     imported posts whose only readings were legacy zeros, so the chart drew 0
     for views the tile (Post.viewsCount) counted. */
  it("charts a post whose readings are all zero at its own current count", () => {
    const rows = carryForwardViewsByDay({
      posts: [{ id: "imported", group: "g", postedAt: at("2026-09-01T00:00:00Z"), viewsCount: 84_357 }],
      snapshots: [{ postId: "imported", recordedAt: at("2026-09-02T18:56:00Z"), viewsCount: 0 }],
      groups: ["g"],
    });
    expect(rows).toEqual([{ date: "2026-09-01", totals: { g: 84_357 } }]);
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
 * so the rules are restated HERE as the slowest obvious re-sum -- every post,
 * every day, its latest positive reading so far (or its first, before that, from
 * its posting day) -- and the two are compared on randomized inputs. It exists
 * only to be the oracle; nothing ships it.
 */
function carryForwardViewsByDay_reSum<G extends string>(input: {
  posts: readonly { id: string; group: G; postedAt: Date; viewsCount: number | null }[];
  snapshots: readonly { postId: string; recordedAt: Date; viewsCount: number | null }[];
  groups: readonly G[];
}): { date: string; totals: Record<G, number> }[] {
  const { posts, snapshots, groups } = input;
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const inScope = new Set(posts.map((p) => p.id));
  // Every positive reading of each post, by day, keeping the day's latest.
  const byPost = new Map<string, Map<string, { at: number; views: number }>>();
  for (const s of snapshots) {
    if (!inScope.has(s.postId) || s.viewsCount === null || !(s.viewsCount > 0)) continue;
    let days = byPost.get(s.postId);
    if (!days) byPost.set(s.postId, (days = new Map()));
    const d = day(s.recordedAt);
    const existing = days.get(d);
    if (!existing || s.recordedAt.getTime() >= existing.at) days.set(d, { at: s.recordedAt.getTime(), views: s.viewsCount });
  }
  const startOf = (p: (typeof posts)[number]) => {
    const readDays = [...(byPost.get(p.id)?.keys() ?? [])].sort();
    const posted = day(p.postedAt);
    return readDays.length && readDays[0] < posted ? readDays[0] : posted;
  };
  const allDays = [...posts.map(startOf), ...[...byPost.values()].flatMap((m) => [...m.keys()])].sort();
  if (allDays.length === 0) return [];
  const rows: { date: string; totals: Record<G, number> }[] = [];
  for (let t = Date.parse(`${allDays[0]}T00:00:00Z`); t <= Date.parse(`${allDays.at(-1)}T00:00:00Z`); t += 86_400_000) {
    const d = day(new Date(t));
    const totals = Object.fromEntries(groups.map((g) => [g, 0])) as Record<G, number>;
    for (const p of posts) {
      if (!(p.group in totals) || d < startOf(p)) continue;
      const reads = byPost.get(p.id);
      let views: number;
      if (!reads) views = p.viewsCount ?? 0;
      else {
        const sorted = [...reads.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
        const upTo = sorted.filter(([rd]) => rd <= d);
        views = (upTo.length ? upTo.at(-1)! : sorted[0])[1].views;
      }
      totals[p.group] += views;
    }
    rows.push({ date: d, totals });
  }
  return rows;
}

describe("carryForwardViewsByDay — equivalence with a per-day re-sum", () => {
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

/* Scale: the shape production actually has -- hundreds of posts read daily for a
   month, posted across the month before tracking began, some read sparsely, some
   never. Checked against the oracle and against the invariants a reader relies
   on: one row per calendar day, the last row equal to every post's last known
   level, and no fall in a series whose every post only ever rises. */
describe("carryForwardViewsByDay at campaign scale", () => {
  it("charts 600 posts x 30 days exactly, with one row per day and a non-falling total", () => {
    const DAY = 86_400_000;
    const start = Date.UTC(2026, 8, 1);
    let seed = 7;
    const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
    const groups = ["TIKTOK", "INSTAGRAM", "YOUTUBE"] as const;

    const posts = Array.from({ length: 600 }, (_, i) => ({
      id: `p${i}`,
      group: groups[i % 3],
      postedAt: new Date(start - Math.floor(rand() * 30) * DAY + Math.floor(rand() * DAY)),
      viewsCount: Math.floor(rand() * 1_000_000),
    }));
    const snapshots: { postId: string; recordedAt: Date; viewsCount: number | null }[] = [];
    const lastLevel = new Map<string, number>();
    for (const post of posts) {
      if (rand() < 0.1) continue; // never read: charted at its own count
      let level = 1 + Math.floor(rand() * 10_000);
      for (let d = 0; d < 30; d++) {
        if (rand() < 0.3) continue; // a skipped sync
        level += Math.floor(rand() * 5_000);
        for (let k = 0; k < 2; k++) {
          // two readings a day, the second higher; plus the odd unmeasured 0
          const reading = k === 0 ? level - 1 : level;
          snapshots.push({ postId: post.id, recordedAt: new Date(start + d * DAY + (k + 1) * 3_600_000), viewsCount: reading });
        }
        if (rand() < 0.05) snapshots.push({ postId: post.id, recordedAt: new Date(start + d * DAY + 20 * 3_600_000), viewsCount: 0 });
        lastLevel.set(post.id, level);
      }
    }

    const rows = carryForwardViewsByDay({ posts, snapshots, groups });

    expect(rows).toEqual(carryForwardViewsByDay_reSum({ posts, snapshots, groups }));
    for (let i = 1; i < rows.length; i++) {
      expect(Date.parse(`${rows[i].date}T00:00:00Z`) - Date.parse(`${rows[i - 1].date}T00:00:00Z`)).toBe(DAY);
      const sum = (r: (typeof rows)[number]) => groups.reduce((s, g) => s + r.totals[g], 0);
      expect(sum(rows[i])).toBeGreaterThanOrEqual(sum(rows[i - 1]));
    }
    const expectedEnd = posts.reduce((s, p) => s + (lastLevel.get(p.id) ?? p.viewsCount), 0);
    const last = rows.at(-1)!;
    expect(groups.reduce((s, g) => s + last.totals[g], 0)).toBe(expectedEnd);
  });
});
