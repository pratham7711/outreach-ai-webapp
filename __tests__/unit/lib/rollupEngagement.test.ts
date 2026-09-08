/**
 * The single engagement-rate definition.
 *
 * Before this helper the same campaign could show three different engagement
 * rates on three screens: the Overview tile averaged Post.engagementRate over
 * every post including never-measured zeroes, the Posts tab divided a five-term
 * engagement by measured views, and the Performance tab and client report
 * divided a four-term one. These tests pin the surviving definition —
 * (likes + comments + shares + saves) / views of measured posts, as a fraction.
 */
import { rollupEngagement, summarizePostMetrics, type EngagementRatePost } from "@/lib/metricDisplay";

const SYNCED = "2026-08-20T10:00:00.000Z";

function post(over: Partial<EngagementRatePost> = {}): EngagementRatePost {
  return {
    viewsCount: 0,
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    savesCount: 0,
    lastSyncedAt: null,
    ...over,
  };
}

describe("rollupEngagement", () => {
  it("adds likes, comments, shares and saves over measured views", () => {
    const r = rollupEngagement([
      post({ viewsCount: 10_000, likesCount: 900, commentsCount: 60, sharesCount: 30, savesCount: 10, lastSyncedAt: SYNCED }),
    ]);

    expect(r.engagements).toBe(1_000);
    expect(r.measuredViews).toBe(10_000);
    expect(r.rate).toBeCloseTo(0.1, 10); // a fraction, not a percentage
  });

  /* The Overview tile's old bug, stated as a test: 18,602 production posts carry
     a default 0 engagement because nobody ever fetched them. A mean over all of
     them buries a real rate. */
  it("ignores never-measured posts instead of averaging their zeroes in", () => {
    const r = rollupEngagement([
      post({ viewsCount: 10_000, likesCount: 500, lastSyncedAt: SYNCED }),
      post({ viewsCount: 90_000 }), // imported, never fetched
    ]);

    expect(r.measuredViews).toBe(10_000);
    expect(r.rate).toBeCloseTo(0.05, 10); // 5%, not 0.5% and not 2.5%
  });

  it("reports null rather than zero when no post was ever measured", () => {
    const r = rollupEngagement([post({ viewsCount: 40_000 }), post({ viewsCount: 60_000 })]);
    expect(r.engagements).toBeNull();
    expect(r.measuredViews).toBe(0);
    expect(r.rate).toBeNull();
  });

  it("keeps a measured zero, which is a real reading", () => {
    const r = rollupEngagement([post({ viewsCount: 500, likesCount: 0, lastSyncedAt: SYNCED })]);
    expect(r.engagements).toBe(0);
    expect(r.rate).toBe(0);
  });

  it("has no rate for a measured post with no views to divide by", () => {
    const r = rollupEngagement([post({ viewsCount: 0, likesCount: 12, lastSyncedAt: SYNCED })]);
    expect(r.engagements).toBe(12);
    expect(r.rate).toBeNull();
  });

  it("returns nothing for an empty campaign", () => {
    expect(rollupEngagement([])).toEqual({ engagements: null, measuredViews: 0, rate: null });
  });

  /* The whole point of the exercise: the Posts tab reads the same definition the
     Performance tab and the shared client report do. */
  it("is the same number summarizePostMetrics reports as its campaign rate", () => {
    const posts = [
      { viewsCount: 10_000, likesCount: 900, commentsCount: 60, sharesCount: 30, savesCount: 15, downloadsCount: 10, lastSyncedAt: SYNCED },
      { viewsCount: 30_000, likesCount: 2_100, commentsCount: 140, sharesCount: 70, savesCount: 35, downloadsCount: 20, lastSyncedAt: SYNCED },
    ];

    const summary = summarizePostMetrics(posts);
    const rollup = rollupEngagement(posts);

    expect(summary.campaignRate).toBeCloseTo(rollup.rate! * 100, 10);
    /* And downloads stay out of the rate even though CreatorCore's `engagement`
       field, which this column is audited against, still counts them. */
    expect(summary.engagement).toBe(3_380); // + 30 downloads
    expect(rollup.engagements).toBe(3_350);
  });
});
