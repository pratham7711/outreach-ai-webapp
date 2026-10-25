/**
 * The comparisons My stats draws: none may invent a figure. Each returns null
 * when its inputs do not support an answer, and the screen leaves it out.
 */
import {
  engagementPerView,
  median,
  medianEngagementPerView,
  timesMedian,
  trendChange,
  trendForAccount,
  type Trend,
} from "@/lib/portal/statsMath";

describe("median", () => {
  it("is null for no values, the middle for odd counts, the mean of the middle two for even", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("engagementPerView", () => {
  it("adds likes, comments and shares over views", () => {
    expect(engagementPerView({ views: 1000, likes: 80, comments: 10, shares: 10 })).toBeCloseTo(0.1);
  });

  it("leaves shares out where the platform does not report them", () => {
    expect(engagementPerView({ views: 1000, likes: 80, comments: 20, shares: null })).toBeCloseTo(0.1);
  });

  it("is null when views were not measured or are zero", () => {
    expect(engagementPerView({ views: null, likes: 80, comments: 20, shares: 0 })).toBeNull();
    expect(engagementPerView({ views: 0, likes: 80, comments: 20, shares: 0 })).toBeNull();
  });

  it("is null, not zero, when neither likes nor comments came back", () => {
    expect(engagementPerView({ views: 1000, likes: null, comments: null, shares: 5 })).toBeNull();
  });

  it("takes the median over only the posts that have a rate", () => {
    const posts = [
      { views: 100, likes: 10, comments: 0, shares: null },
      { views: null, likes: 50, comments: 5, shares: null },
      { views: 100, likes: 30, comments: 0, shares: null },
    ];
    expect(medianEngagementPerView(posts)).toBeCloseTo(0.2);
    expect(medianEngagementPerView([{ views: null, likes: 1, comments: 1, shares: null }])).toBeNull();
  });
});

describe("timesMedian", () => {
  it("is the post's views as a multiple of the median", () => {
    expect(timesMedian(21_000, 10_500, 3)).toBe(2);
  });

  it("needs three posts before a median means 'typical'", () => {
    expect(timesMedian(21_000, 10_500, 2)).toBeNull();
  });

  it("is null without both figures or with a zero median", () => {
    expect(timesMedian(null, 10_500, 5)).toBeNull();
    expect(timesMedian(21_000, null, 5)).toBeNull();
    expect(timesMedian(21_000, 0, 5)).toBeNull();
  });
});

describe("trendForAccount", () => {
  const trends: Trend[] = [
    { platform: "TIKTOK", handle: "Mia_Demo", source: "public_profile", points: [] },
    { platform: "INSTAGRAM", handle: "mia_demo", source: "public_profile", points: [] },
  ];

  it("matches on platform and handle, ignoring @ and case", () => {
    expect(trendForAccount(trends, "TIKTOK", "@mia_demo")?.platform).toBe("TIKTOK");
    expect(trendForAccount(trends, "instagram", "MIA_DEMO")?.platform).toBe("INSTAGRAM");
  });

  it("does not hand one platform's readings to another", () => {
    expect(trendForAccount(trends, "YOUTUBE", "mia_demo")).toBeNull();
  });
});

describe("trendChange", () => {
  const day = (offset: number) => new Date(Date.UTC(2026, 9, 25) - offset * 86_400_000).toISOString().slice(0, 10);

  it("is null with fewer than two readings", () => {
    expect(trendChange([])).toBeNull();
    expect(trendChange([{ day: day(0), followers: 10 }])).toBeNull();
  });

  it("compares the newest reading with the first one inside the window", () => {
    const c = trendChange([
      { day: day(45), followers: 900 },
      { day: day(30), followers: 1000 },
      { day: day(10), followers: 1050 },
      { day: day(0), followers: 1100 },
    ]);
    expect(c).toMatchObject({ from: 1000, to: 1100, change: 100, since: day(30), wholeWindow: true });
    expect(c?.pct).toBeCloseTo(0.1);
  });

  it("says 'since' its first day when the readings start inside the window", () => {
    const c = trendChange([
      { day: day(12), followers: 500 },
      { day: day(0), followers: 450 },
    ]);
    expect(c).toMatchObject({ change: -50, since: day(12), wholeWindow: false });
  });

  it("has no percentage when it starts from zero", () => {
    expect(trendChange([{ day: day(5), followers: 0 }, { day: day(0), followers: 10 }])?.pct).toBeNull();
  });

  it("is null when the window holds only the newest reading", () => {
    expect(trendChange([{ day: day(60), followers: 1 }, { day: day(0), followers: 2 }])).toBeNull();
  });
});
