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
