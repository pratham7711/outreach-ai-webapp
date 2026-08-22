import {
  byMetricDescending,
  followerCount,
  isCreatorTrackerSort,
  metricsFromRow,
  sortValueFor,
  toNumber,
  windowBounds,
} from "@/lib/trackers/creatorMetrics";

/* The creator tracker reports two figures it does not own the collection of, so
   every rule here is about the difference between a measurement and a default.
   Creator.followersCount is a Float @default(0) filled on 11 of 1,834 rows; a
   creator with no posts in a window has no average, not an average of zero. */

const HOUR = 3600_000;

describe("windowBounds", () => {
  it("puts the previous window immediately before the current one, same length", () => {
    const now = new Date("2026-08-22T00:00:00.000Z");
    const { current, previous } = windowBounds("7d", now);
    expect(current.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(previous.toISOString()).toBe("2026-08-08T00:00:00.000Z");
    // Equal spans, so the two averages are comparable.
    expect(current.getTime() - previous.getTime()).toBe(now.getTime() - current.getTime());
  });

  it("scales with the window", () => {
    const now = new Date("2026-08-22T00:00:00.000Z");
    expect(now.getTime() - windowBounds("14d", now).current.getTime()).toBe(14 * 24 * HOUR);
    expect(now.getTime() - windowBounds("30d", now).current.getTime()).toBe(30 * 24 * HOUR);
  });
});

describe("toNumber", () => {
  it("accepts what Postgres actually sends back", () => {
    // numeric arrives as a string, count as a bigint, avg over nothing as null.
    expect(toNumber("1234.5")).toBe(1234.5);
    expect(toNumber(42)).toBe(42);
    expect(toNumber(BigInt(7) as unknown)).toBe(7);
    expect(toNumber("0")).toBe(0);
  });

  it("reports anything unreadable as absent rather than zero", () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber("not a number")).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber(Infinity)).toBeNull();
  });
});

describe("metricsFromRow", () => {
  it("computes the change against the preceding window", () => {
    const m = metricsFromRow({
      creatorId: "c1",
      avgCurrent: 576955,
      postsCurrent: 3,
      avgPrevious: 114245,
      postsPrevious: 4,
    });
    expect(m.avgViews).toBe(576955);
    expect(m.changePercent).toBeCloseTo(405.02, 2);
    expect(m.changeAbsentReason).toBeNull();
    expect(m.postsInWindow).toBe(3);
    expect(m.postsInPrevious).toBe(4);
  });

  it("reports a fall as a negative percentage", () => {
    const m = metricsFromRow({
      creatorId: "c1",
      avgCurrent: 186,
      postsCurrent: 4,
      avgPrevious: 5864,
      postsPrevious: 30,
    });
    expect(m.changePercent).toBeCloseTo(-96.83, 1);
  });

  it("has no average at all for a creator who posted nothing in the window", () => {
    const m = metricsFromRow({
      creatorId: "c1",
      avgCurrent: null,
      postsCurrent: 0,
      avgPrevious: 47288,
      postsPrevious: 33,
    });
    // Not 0. They did not average zero views; there is nothing to average.
    expect(m.avgViews).toBeNull();
    expect(m.changePercent).toBeNull();
    expect(m.changeAbsentReason).toBe("no-posts-in-window");
  });

  it("has no baseline for a creator who only started posting this window", () => {
    const m = metricsFromRow({
      creatorId: "c1",
      avgCurrent: 5000,
      postsCurrent: 2,
      avgPrevious: null,
      postsPrevious: 0,
    });
    expect(m.avgViews).toBe(5000);
    expect(m.changePercent).toBeNull();
    expect(m.changeAbsentReason).toBe("no-posts-before");
  });

  it("refuses to grow a percentage out of a zero baseline", () => {
    const m = metricsFromRow({
      creatorId: "c1",
      avgCurrent: 900,
      postsCurrent: 3,
      avgPrevious: 0,
      postsPrevious: 5,
    });
    // +100% would be inventing a denominator, and +Infinity is not a figure.
    expect(m.changePercent).toBeNull();
    expect(m.changeAbsentReason).toBe("zero-baseline");
  });

  it("ignores an average that arrived without any posts behind it", () => {
    // Belt and braces: a count of 0 wins over whatever avg says.
    const m = metricsFromRow({
      creatorId: "c1",
      avgCurrent: 999,
      postsCurrent: 0,
      avgPrevious: 111,
      postsPrevious: 0,
    });
    expect(m.avgViews).toBeNull();
    expect(m.changeAbsentReason).toBe("no-posts-in-window");
  });

  it("treats a creator missing from the aggregate as measured-nothing", () => {
    const m = metricsFromRow(undefined);
    expect(m).toEqual({
      avgViews: null,
      postsInWindow: 0,
      changePercent: null,
      changeAbsentReason: "no-posts-in-window",
      postsInPrevious: 0,
    });
  });
});

describe("followerCount", () => {
  it("passes a real count through", () => {
    expect(followerCount(2891236)).toBe(2891236);
  });

  it("treats the column default as no reading", () => {
    // 0 is what the import leaves behind on 1,823 of 1,834 creators.
    expect(followerCount(0)).toBeNull();
    expect(followerCount(null)).toBeNull();
    expect(followerCount(undefined)).toBeNull();
    expect(followerCount(-5)).toBeNull();
    expect(followerCount(Number.NaN)).toBeNull();
  });
});

describe("sorting", () => {
  const row = (avgViews: number | null, changePercent: number | null, posts: number, followers: number | null) => ({
    metrics: { avgViews, changePercent, postsInWindow: posts },
    followersCount: followers,
  });

  it("reads the field each sort names", () => {
    const r = row(500, -12, 4, 90000);
    expect(sortValueFor(r, "views")).toBe(500);
    expect(sortValueFor(r, "change")).toBe(-12);
    expect(sortValueFor(r, "posts")).toBe(4);
    expect(sortValueFor(r, "followers")).toBe(90000);
  });

  it("counts no posts as no value, so it cannot beat one post", () => {
    expect(sortValueFor(row(null, null, 0, null), "posts")).toBeNull();
  });

  it("puts the unmeasured last however the list is sorted", () => {
    const rows = [
      row(null, null, 0, null),
      row(1000, 5, 2, 100),
      row(null, null, 0, 900),
      row(50, -80, 1, null),
    ];
    // A creator we know nothing about must not head a leaderboard because null
    // happened to compare high.
    expect(byMetricDescending(rows, "views").map((r) => r.metrics.avgViews)).toEqual([1000, 50, null, null]);
    expect(byMetricDescending(rows, "change").map((r) => r.metrics.changePercent)).toEqual([5, -80, null, null]);
    expect(byMetricDescending(rows, "followers").map((r) => r.followersCount)).toEqual([900, 100, null, null]);
  });

  it("does not mutate the array it was given", () => {
    const rows = [row(1, null, 1, null), row(9, null, 1, null)];
    const first = rows[0];
    byMetricDescending(rows, "views");
    expect(rows[0]).toBe(first);
  });

  it("only accepts sorts it implements", () => {
    expect(isCreatorTrackerSort("views")).toBe(true);
    expect(isCreatorTrackerSort("followers")).toBe(true);
    expect(isCreatorTrackerSort("velocity")).toBe(false);
    expect(isCreatorTrackerSort(null)).toBe(false);
  });
});
