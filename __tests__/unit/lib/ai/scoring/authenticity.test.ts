import {
  scoreAuthenticity,
  type AuthenticityInput,
  type ScoreResult,
} from "@/lib/ai/scoring/authenticity";

const cleanHealthy: AuthenticityInput = {
  followers: 100_000,
  following: 800,
  avgLikes: 4_000,
  avgComments: 220,
  avgViews: 60_000,
  postCount: 240,
  followerGrowthSeries: [900, 1_100, 1_000, 1_200, 950, 1_050],
  audienceCountryShares: { US: 0.4, GB: 0.2, CA: 0.15, AU: 0.15, IN: 0.1 },
};

const boughtEngagement: AuthenticityInput = {
  followers: 100_000,
  following: 200,
  avgLikes: 40_000,
  avgComments: 40,
  avgViews: 50_000,
  postCount: 30,
  followerGrowthSeries: [200, 250, 180, 220, 210, 195],
  audienceCountryShares: { US: 0.5, GB: 0.3, CA: 0.2 },
};

const labelsOf = (result: ScoreResult): string[] => result.factors.map((f) => f.label);

describe("scoreAuthenticity", () => {
  it("scores a clean healthy creator high (>=70)", () => {
    const result = scoreAuthenticity(cleanHealthy);
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("scores a bought-engagement profile low (<50)", () => {
    const result = scoreAuthenticity({
      ...cleanHealthy,
      avgLikes: 40_000,
      avgComments: 40,
    });
    expect(result.score).toBeLessThan(50);
  });

  it("penalizes an implausibly-high engagement rate instead of rewarding it", () => {
    const moderate = scoreAuthenticity({
      ...cleanHealthy,
      avgLikes: 5_000,
      avgComments: 300,
    });
    const implausible = scoreAuthenticity({
      ...cleanHealthy,
      avgLikes: 30_000,
      avgComments: 1_000,
    });
    const engFactor = implausible.factors.find((f) => f.label === "Engagement rate");
    expect(engFactor).toBeDefined();
    expect(engFactor!.impact).toBeLessThan(0);
    expect(implausible.score).toBeLessThan(moderate.score);
  });

  it("MONOTONICITY: adding a growth spike strictly lowers the score", () => {
    const baseline = scoreAuthenticity(cleanHealthy);
    const withSpike = scoreAuthenticity({
      ...cleanHealthy,
      followerGrowthSeries: [900, 1_100, 1_000, 1_200, 950, 80_000],
    });
    expect(withSpike.score).toBeLessThan(baseline.score);
    expect(labelsOf(withSpike)).toContain("Suspicious growth spike");
    expect(labelsOf(baseline)).not.toContain("Suspicious growth spike");
  });

  it("does not throw and does not produce NaN for zero followers", () => {
    const result = scoreAuthenticity({
      followers: 0,
      following: 0,
      avgLikes: 0,
      avgComments: 0,
      avgViews: 0,
      postCount: 0,
    });
    expect(Number.isFinite(result.score)).toBe(true);
    for (const factor of result.factors) {
      expect(Number.isFinite(factor.impact)).toBe(true);
    }
  });

  it("keeps score within [0,100] across several inputs", () => {
    const inputs: AuthenticityInput[] = [
      cleanHealthy,
      boughtEngagement,
      { followers: 1, following: 1_000_000, avgLikes: 0, avgComments: 0, avgViews: 0, postCount: 1 },
      {
        followers: 50,
        following: 50,
        avgLikes: 49,
        avgComments: 0,
        avgViews: 100,
        postCount: 3,
        followerGrowthSeries: [1, 1, 1, 999_999],
        audienceCountryShares: { US: 0.99, GB: 0.01 },
      },
      {
        followers: Number.NaN,
        following: Number.POSITIVE_INFINITY,
        avgLikes: Number.NaN,
        avgComments: 0,
        avgViews: 0,
        postCount: 12,
      },
    ];
    for (const input of inputs) {
      const result = scoreAuthenticity(input);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(Number.isFinite(result.score)).toBe(true);
    }
  });

  it("contains the expected factor labels for the signals present", () => {
    const result = scoreAuthenticity(boughtEngagement);
    const labels = labelsOf(result);
    expect(labels).toContain("Engagement rate");
    expect(labels).toContain("Comment quality");
    expect(labels).toContain("Follow ratio");
  });

  it("emits geo + growth factor labels only when those signals fire", () => {
    const concentrated = scoreAuthenticity({
      ...cleanHealthy,
      audienceCountryShares: { US: 0.92, GB: 0.08 },
    });
    expect(labelsOf(concentrated)).toContain("Audience geo concentration");

    const noGeo = scoreAuthenticity({
      followers: 10_000,
      following: 300,
      avgLikes: 400,
      avgComments: 30,
      avgViews: 5_000,
      postCount: 8,
    });
    expect(labelsOf(noGeo)).not.toContain("Audience geo concentration");
    expect(labelsOf(noGeo)).not.toContain("Suspicious growth spike");
  });

  it("is deterministic: same input twice -> deep-equal result", () => {
    const a = scoreAuthenticity(cleanHealthy);
    const b = scoreAuthenticity(cleanHealthy);
    expect(a).toEqual(b);
  });

  it("reports 'low' confidence with minimal data and 'high' with full data", () => {
    const minimal = scoreAuthenticity({
      followers: 5_000,
      following: 400,
      avgLikes: 200,
      avgComments: 15,
      avgViews: 3_000,
      postCount: 4,
    });
    expect(minimal.confidence).toBe("low");

    const full = scoreAuthenticity(cleanHealthy);
    expect(full.confidence).toBe("high");
  });

  it("keeps every factor impact within roughly [-1, 1]", () => {
    const result = scoreAuthenticity({
      ...cleanHealthy,
      followerGrowthSeries: [1, 1, 1, 5_000_000],
      audienceCountryShares: { US: 0.999, GB: 0.001 },
    });
    for (const factor of result.factors) {
      expect(factor.impact).toBeGreaterThanOrEqual(-1);
      expect(factor.impact).toBeLessThanOrEqual(1);
    }
  });

  it("MONOTONICITY (like-bot axis): more likes against flat comments never raises the score", () => {
    const baseline = scoreAuthenticity({ ...cleanHealthy, avgLikes: 4_000, avgComments: 220 });
    const moreLikeBots = scoreAuthenticity({ ...cleanHealthy, avgLikes: 60_000, avgComments: 220 });
    expect(moreLikeBots.score).toBeLessThanOrEqual(baseline.score);
  });

  it("MONOTONICITY (follow-farm axis): raising following into farm territory never raises the score", () => {
    const baseline = scoreAuthenticity({ ...cleanHealthy, following: 800 });
    const farm = scoreAuthenticity({ ...cleanHealthy, following: 500_000 });
    expect(farm.score).toBeLessThanOrEqual(baseline.score);
  });

  it("MONOTONICITY (geo axis): higher single-country concentration never raises the score", () => {
    const spread = scoreAuthenticity({ ...cleanHealthy, audienceCountryShares: { US: 0.4, GB: 0.3, CA: 0.3 } });
    const concentrated = scoreAuthenticity({ ...cleanHealthy, audienceCountryShares: { US: 0.95, GB: 0.05 } });
    expect(concentrated.score).toBeLessThanOrEqual(spread.score);
  });
});
