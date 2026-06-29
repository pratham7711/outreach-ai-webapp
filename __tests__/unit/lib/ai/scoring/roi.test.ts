import { forecastRoi, RoiForecast, RoiInput } from "@/lib/ai/scoring/roi";

const BASE: RoiInput = {
  followers: 100_000,
  engagementRate: 0.05,
  avgViews: 20_000,
  productPrice: 50,
  estimatedCost: 1_000,
  category: "saas",
};

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

describe("forecastRoi", () => {
  it("monotonic: higher avgViews -> higher expectedReach and >= score", () => {
    const low = forecastRoi({ ...BASE, avgViews: 10_000 });
    const high = forecastRoi({ ...BASE, avgViews: 200_000 });
    expect(high.projection.expectedReach).toBeGreaterThan(low.projection.expectedReach);
    expect(high.score).toBeGreaterThanOrEqual(low.score);
  });

  it("estimatedCost = 0 does not throw and yields a finite expectedRoiMultiple", () => {
    let result: RoiForecast | undefined;
    expect(() => {
      result = forecastRoi({ ...BASE, estimatedCost: 0 });
    }).not.toThrow();
    expect(result).toBeDefined();
    const r = result as RoiForecast;
    expect(Number.isFinite(r.projection.expectedRoiMultiple)).toBe(true);
    expect(r.projection.expectedRoiMultiple).not.toBe(Infinity);
    expect(Number.isFinite(r.score)).toBe(true);
  });

  it("higher productPrice -> higher expectedRevenue", () => {
    const cheap = forecastRoi({ ...BASE, productPrice: 10 });
    const pricey = forecastRoi({ ...BASE, productPrice: 500 });
    expect(pricey.projection.expectedRevenue).toBeGreaterThan(cheap.projection.expectedRevenue);
  });

  it("pastCampaignConversions raises confidence vs absent", () => {
    const minimal = forecastRoi({
      followers: 100_000,
      engagementRate: 0.05,
      avgViews: 20_000,
    });
    const withHistory = forecastRoi({
      followers: 100_000,
      engagementRate: 0.05,
      avgViews: 20_000,
      pastCampaignConversions: [200, 250, 300],
      productPrice: 50,
      estimatedCost: 1_000,
    });
    const order = { low: 0, medium: 1, high: 2 } as const;
    expect(order[withHistory.confidence]).toBeGreaterThan(order[minimal.confidence]);
    expect(withHistory.confidence).toBe("high");
  });

  it("score is always within [0, 100]", () => {
    const cases: RoiInput[] = [
      BASE,
      { ...BASE, productPrice: 1_000_000, estimatedCost: 1 },
      { ...BASE, productPrice: 0, estimatedCost: 0 },
      { followers: 0, engagementRate: 0, avgViews: 0 },
      { followers: -5, engagementRate: 9, avgViews: -100, productPrice: -10, estimatedCost: -10 },
    ];
    for (const c of cases) {
      const r = forecastRoi(c);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(Number.isFinite(r.score)).toBe(true);
    }
  });

  it("internal consistency: expectedConversions == expectedReach * effectiveConvRate", () => {
    const r = forecastRoi(BASE);
    const impliedRate = r.projection.expectedConversions / r.projection.expectedReach;
    const recomputed = r.projection.expectedReach * impliedRate;
    expect(recomputed).toBeCloseTo(r.projection.expectedConversions, 6);
    expect(impliedRate).toBeGreaterThanOrEqual(0);
    expect(impliedRate).toBeLessThanOrEqual(1);
  });

  it("determinism: same input -> same output", () => {
    const a = forecastRoi(BASE);
    const b = forecastRoi({ ...BASE });
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("factors include the present-signal labels", () => {
    const r = forecastRoi({
      ...BASE,
      pastCampaignConversions: [100, 120, 140],
    });
    const labels = r.factors.map((f) => f.label);
    expect(labels).toContain("Projected reach");
    expect(labels).toContain("Historical conversion");
    expect(labels).toContain("Category");
    expect(labels).toContain("Cost leverage");
    for (const f of r.factors) {
      expect(Number.isFinite(f.impact)).toBe(true);
      expect(f.impact).toBeGreaterThanOrEqual(-1);
      expect(f.impact).toBeLessThanOrEqual(1);
    }
  });

  it("omitting pastCampaignConversions drops the Historical conversion factor", () => {
    const r = forecastRoi({
      followers: 100_000,
      engagementRate: 0.05,
      avgViews: 20_000,
    });
    const labels = r.factors.map((f) => f.label);
    expect(labels).not.toContain("Historical conversion");
    expect(labels).toContain("Projected reach");
  });

  it("all-zero / empty input yields a finite low score without throwing", () => {
    let r: RoiForecast | undefined;
    expect(() => {
      r = forecastRoi({ followers: 0, engagementRate: 0, avgViews: 0 });
    }).not.toThrow();
    const result = r as RoiForecast;
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBe(0);
    expect(result.confidence).toBe("low");
    expect(isFinitePositive(result.projection.expectedReach)).toBe(true);
    expect(isFinitePositive(result.projection.expectedConversions)).toBe(true);
    expect(isFinitePositive(result.projection.expectedRevenue)).toBe(true);
    expect(Number.isFinite(result.projection.expectedRoiMultiple)).toBe(true);
  });

  it("monotonic in historical conversions: more past conversions never lowers conversions or score", () => {
    const lowHistory = forecastRoi({ ...BASE, pastCampaignConversions: [50, 50, 50] });
    const highHistory = forecastRoi({ ...BASE, pastCampaignConversions: [400, 400, 400] });
    expect(highHistory.projection.expectedConversions).toBeGreaterThanOrEqual(
      lowHistory.projection.expectedConversions,
    );
    expect(highHistory.score).toBeGreaterThanOrEqual(lowHistory.score);
  });
});
