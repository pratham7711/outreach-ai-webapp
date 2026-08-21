import { summarizePostMetrics, type MeasurablePost } from "@/lib/metricDisplay";

function post(over: Partial<MeasurablePost> = {}): MeasurablePost {
  return {
    viewsCount: 0,
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    savesCount: 0,
    downloadsCount: 0,
    lastSyncedAt: null,
    ...over,
  };
}

describe("summarizePostMetrics", () => {
  it("reports views but no engagement totals when nothing was ever fetched", () => {
    // The imported-from-CreatorCore case: view counts are real, the rest are
    // schema defaults that must not be summed into a confident zero.
    const s = summarizePostMetrics([
      post({ viewsCount: 40_000 }),
      post({ viewsCount: 60_000 }),
    ]);

    expect(s.posts).toBe(2);
    expect(s.views).toBe(100_000);
    expect(s.likes).toBeNull();
    expect(s.comments).toBeNull();
    expect(s.shares).toBeNull();
    expect(s.saves).toBeNull();
    expect(s.engagement).toBeNull();
    expect(s.avgPostRate).toBeNull();
    expect(s.campaignRate).toBeNull();
  });

  it("sums engagement across measured posts and includes downloads", () => {
    const s = summarizePostMetrics([
      post({
        viewsCount: 10_000,
        likesCount: 900,
        commentsCount: 60,
        sharesCount: 30,
        savesCount: 15,
        downloadsCount: 10,
        lastSyncedAt: "2026-08-20T10:00:00.000Z",
      }),
      post({
        viewsCount: 30_000,
        likesCount: 2_100,
        commentsCount: 140,
        sharesCount: 70,
        savesCount: 35,
        downloadsCount: 20,
        lastSyncedAt: "2026-08-20T10:00:00.000Z",
      }),
    ]);

    expect(s.likes).toBe(3_000);
    expect(s.comments).toBe(200);
    expect(s.shares).toBe(100);
    expect(s.saves).toBe(50);
    // Five terms, matching CreatorCore's own `engagement` field: likes +
    // comments + shares + downloads + saves. Audited over 9,372 of their
    // records, 0 of which matched any other formula.
    expect(s.engagement).toBe(3_000 + 200 + 100 + 30 + 50);
  });

  it("rates a mixed campaign on measured views only, so unfetched posts cannot dilute it", () => {
    const s = summarizePostMetrics([
      post({
        viewsCount: 10_000,
        likesCount: 500,
        lastSyncedAt: "2026-08-20T10:00:00.000Z",
      }),
      post({ viewsCount: 90_000 }), // never fetched
    ]);

    expect(s.views).toBe(100_000); // views are real for both
    expect(s.engagement).toBe(500);
    // 500 / 10,000 = 5%, NOT 500 / 100,000 = 0.5%
    expect(s.campaignRate).toBeCloseTo(5, 5);
  });

  it("keeps the two rates distinct: mean of per-post rates vs campaign-wide", () => {
    const s = summarizePostMetrics([
      post({ viewsCount: 1_000, likesCount: 100, lastSyncedAt: "2026-08-20T10:00:00.000Z" }), // 10%
      post({ viewsCount: 99_000, likesCount: 990, lastSyncedAt: "2026-08-20T10:00:00.000Z" }), // 1%
    ]);

    expect(s.avgPostRate).toBeCloseTo((10 + 1) / 2, 5); // 5.5%
    expect(s.campaignRate).toBeCloseTo((1_090 / 100_000) * 100, 5); // 1.09%
    expect(s.avgPostRate).not.toBeCloseTo(s.campaignRate!, 5);
  });

  it("keeps a genuine zero once the post has been synced", () => {
    const s = summarizePostMetrics([
      post({ viewsCount: 500, likesCount: 0, lastSyncedAt: "2026-08-20T10:00:00.000Z" }),
    ]);

    expect(s.likes).toBe(0);
    expect(s.engagement).toBe(0);
    expect(s.campaignRate).toBe(0);
  });
});
