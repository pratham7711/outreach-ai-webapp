/**
 * Avg. Views is the mean of a creator's ten newest posts, pinned ones left out.
 * The same rule on every platform, so the tracker compares like with like.
 */
import {
  latestAverageViews,
  pinnedByGridOrder,
  tiktokPostedAtFromId,
} from "@/lib/trackers/recentViews";

const day = (n: number) => new Date(Date.UTC(2026, 8, n, 12)).toISOString();

/** A TikTok-shaped id: creation time in the top 32 bits. */
const tiktokId = (iso: string, low = 12345) =>
  ((BigInt(Math.floor(Date.parse(iso) / 1000)) << BigInt(32)) + BigInt(low)).toString();

describe("latestAverageViews", () => {
  it("averages the ten newest posts and ignores older ones", () => {
    const posts = Array.from({ length: 15 }, (_, i) => ({ views: (i + 1) * 100, postedAt: day(i + 1) }));
    // Newest ten are days 6..15, views 600..1500.
    expect(latestAverageViews(posts)).toEqual({ avgViews: 1050, sampledPosts: 10 });
  });

  it("orders by date, not by where the reader listed the post", () => {
    const posts = [
      { views: 1_000_000, postedAt: day(1) },
      ...Array.from({ length: 10 }, (_, i) => ({ views: 100, postedAt: day(i + 10) })),
    ];
    expect(latestAverageViews(posts)).toEqual({ avgViews: 100, sampledPosts: 10 });
  });

  it("leaves pinned posts out and tops the ten back up with older ones", () => {
    const posts = [
      { views: 9_000_000, postedAt: day(20), pinned: true },
      ...Array.from({ length: 11 }, (_, i) => ({ views: 200, postedAt: day(i + 1) })),
    ];
    expect(latestAverageViews(posts)).toEqual({ avgViews: 200, sampledPosts: 10 });
  });

  it("skips a post with no view count rather than counting it as zero", () => {
    const posts = [
      { views: undefined, postedAt: day(5) },
      { views: null, postedAt: day(4) },
      { views: 300, postedAt: day(3) },
      { views: 100, postedAt: day(2) },
    ];
    expect(latestAverageViews(posts)).toEqual({ avgViews: 200, sampledPosts: 2 });
  });

  it("keeps a real zero", () => {
    expect(latestAverageViews([{ views: 0, postedAt: day(2) }, { views: 100, postedAt: day(1) }])).toEqual({
      avgViews: 50,
      sampledPosts: 2,
    });
  });

  it("uses the reader's order for posts without dates, after the dated ones", () => {
    const posts = [
      { views: 1, postedAt: null },
      ...Array.from({ length: 10 }, (_, i) => ({ views: 10, postedAt: day(i + 1) })),
    ];
    expect(latestAverageViews(posts)).toEqual({ avgViews: 10, sampledPosts: 10 });
    const undated = Array.from({ length: 12 }, (_, i) => ({ views: i < 10 ? 50 : 5000, postedAt: undefined }));
    expect(latestAverageViews(undated)).toEqual({ avgViews: 50, sampledPosts: 10 });
  });

  it("reports nothing measured when no post carries a count", () => {
    expect(latestAverageViews([])).toEqual({ avgViews: 0, sampledPosts: 0 });
    expect(latestAverageViews([{ views: null, postedAt: day(1) }])).toEqual({ avgViews: 0, sampledPosts: 0 });
  });
});

describe("tiktokPostedAtFromId", () => {
  it("reads the creation time out of the id", () => {
    expect(tiktokPostedAtFromId(tiktokId("2026-09-29T13:24:05.000Z"))).toBe("2026-09-29T13:24:05.000Z");
  });

  it("refuses anything that is not a plausible TikTok id", () => {
    expect(tiktokPostedAtFromId("1")).toBeNull();
    expect(tiktokPostedAtFromId("abc")).toBeNull();
    expect(tiktokPostedAtFromId(tiktokId("2015-06-01T00:00:00.000Z"))).toBeNull();
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(tiktokPostedAtFromId(tiktokId(future))).toBeNull();
  });
});

describe("pinnedByGridOrder", () => {
  it("marks whatever sits ahead of the newest video", () => {
    const grid = [day(1), day(3), day(2), day(28), day(27), day(26)].map((postedAt) => ({ postedAt }));
    expect(pinnedByGridOrder(grid)).toEqual([true, true, true, false, false, false]);
  });

  it("marks nothing when the newest video is first", () => {
    const grid = [day(28), day(27), day(20)].map((postedAt) => ({ postedAt }));
    expect(pinnedByGridOrder(grid)).toEqual([false, false, false]);
  });

  it("never marks more than TikTok's three pins", () => {
    const grid = [day(1), day(2), day(3), day(4), day(28)].map((postedAt) => ({ postedAt }));
    expect(pinnedByGridOrder(grid)).toEqual([false, false, false, false, false]);
  });

  it("marks nothing when the grid carries no dates", () => {
    expect(pinnedByGridOrder([{ postedAt: null }, { postedAt: null }])).toEqual([false, false]);
  });
});
