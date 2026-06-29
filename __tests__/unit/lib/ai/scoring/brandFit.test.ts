import { scoreBrandFit, type BrandFitInput } from "@/lib/ai/scoring/brandFit";

function baseInput(overrides: Partial<BrandFitInput> = {}): BrandFitInput {
  return {
    creatorCategories: ["fitness", "wellness"],
    creatorAudience: {
      countryShares: { US: 0.7, CA: 0.2 },
      ageShares: { "18-24": 0.5, "25-34": 0.4 },
      interestShares: { fitness: 0.6, nutrition: 0.3 },
    },
    creatorBrandSafetyFlags: [],
    brand: {
      categories: ["fitness", "wellness"],
      targetCountries: ["US", "CA"],
      targetAgeBands: ["18-24", "25-34"],
      targetInterests: ["fitness", "nutrition"],
      brandSafetyLevel: "standard",
    },
    ...overrides,
  };
}

describe("scoreBrandFit", () => {
  it("scores high when category overlap and audience are fully aligned", () => {
    const result = scoreBrandFit(baseInput());
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.confidence).toBe("high");
  });

  it("SAFETY DOMINANCE: a flagged creator under a strict brand scores <=25 even with perfect category overlap", () => {
    const result = scoreBrandFit(
      baseInput({
        creatorBrandSafetyFlags: ["adult"],
        brand: {
          categories: ["fitness", "wellness"],
          targetCountries: ["US", "CA"],
          targetAgeBands: ["18-24", "25-34"],
          targetInterests: ["fitness", "nutrition"],
          brandSafetyLevel: "strict",
        },
      }),
    );
    expect(result.score).toBeLessThanOrEqual(25);
    const safety = result.factors.find((f) => f.label === "Brand safety");
    expect(safety).toBeDefined();
    expect(safety!.impact).toBeLessThan(0);
  });

  it("handles empty creatorCategories and empty brand.categories with Jaccard 0 and no NaN", () => {
    const result = scoreBrandFit(
      baseInput({
        creatorCategories: [],
        brand: {
          categories: [],
          targetCountries: ["US"],
          targetInterests: ["fitness"],
          targetAgeBands: ["18-24"],
          brandSafetyLevel: "standard",
        },
      }),
    );
    expect(Number.isNaN(result.score)).toBe(false);
    const category = result.factors.find((f) => f.label === "Category match");
    expect(category).toBeDefined();
    expect(category!.impact).toBe(0);
  });

  it("is monotonic: adding a matching category raises the score", () => {
    const without = scoreBrandFit(
      baseInput({
        creatorCategories: ["fitness"],
        creatorAudience: {},
        brand: { categories: ["fitness", "wellness", "beauty"] },
      }),
    );
    const withMatch = scoreBrandFit(
      baseInput({
        creatorCategories: ["fitness", "wellness"],
        creatorAudience: {},
        brand: { categories: ["fitness", "wellness", "beauty"] },
      }),
    );
    expect(withMatch.score).toBeGreaterThan(without.score);
  });

  it("missing audience data lowers confidence but does not throw", () => {
    const result = scoreBrandFit(
      baseInput({
        creatorAudience: {},
        brand: { categories: ["fitness", "wellness"] },
      }),
    );
    expect(result.confidence).toBe("low");
    expect(Number.isNaN(result.score)).toBe(false);
  });

  it("keeps score within [0, 100] across varied inputs", () => {
    const cases: BrandFitInput[] = [
      baseInput(),
      baseInput({ creatorBrandSafetyFlags: ["adult", "political", "gambling"], brand: { categories: ["x"], brandSafetyLevel: "strict" } }),
      baseInput({ creatorCategories: [], brand: { categories: [] } }),
      baseInput({
        creatorAudience: { countryShares: { US: 5 }, interestShares: { fitness: 9 } },
        brand: { categories: ["fitness"], targetCountries: ["US"], targetInterests: ["fitness"] },
      }),
    ];
    for (const c of cases) {
      const result = scoreBrandFit(c);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(Number.isFinite(result.score)).toBe(true);
    }
  });

  it("is deterministic: same input yields identical output", () => {
    const input = baseInput();
    const a = scoreBrandFit(input);
    const b = scoreBrandFit(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("includes present-dimension factor labels", () => {
    const result = scoreBrandFit(baseInput());
    const labels = result.factors.map((f) => f.label);
    expect(labels).toContain("Category match");
    expect(labels).toContain("Audience geo fit");
    expect(labels).toContain("Interest fit");
    expect(labels).toContain("Age fit");
  });

  it("omits dimension factors when their data is absent", () => {
    const result = scoreBrandFit(
      baseInput({
        creatorAudience: { countryShares: { US: 0.8 } },
        brand: { categories: ["fitness"], targetCountries: ["US"] },
      }),
    );
    const labels = result.factors.map((f) => f.label);
    expect(labels).toContain("Audience geo fit");
    expect(labels).not.toContain("Interest fit");
    expect(labels).not.toContain("Age fit");
  });

  it("penalizes a standard brand with a minor flag but does NOT cap it to <=25", () => {
    const result = scoreBrandFit(
      baseInput({
        creatorBrandSafetyFlags: ["mild-language"],
        brand: {
          categories: ["fitness", "wellness"],
          targetCountries: ["US", "CA"],
          targetAgeBands: ["18-24", "25-34"],
          targetInterests: ["fitness", "nutrition"],
          brandSafetyLevel: "standard",
        },
      }),
    );
    const clean = scoreBrandFit(baseInput());
    expect(result.score).toBeLessThan(clean.score);
    expect(result.score).toBeGreaterThan(25);
  });

  it("monotonic in standard-brand flag count: more flags never raises the score", () => {
    const oneFlag = scoreBrandFit(baseInput({ creatorBrandSafetyFlags: ["mild-language"] }));
    const threeFlags = scoreBrandFit(
      baseInput({ creatorBrandSafetyFlags: ["mild-language", "profanity", "edgy-humor"] }),
    );
    expect(threeFlags.score).toBeLessThanOrEqual(oneFlag.score);
  });
});
