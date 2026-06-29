import {
  normalizeDistribution,
  estimateAudience,
} from "@/lib/ai/audience/intelligence";
import type { AudienceSignals } from "@/lib/ai/audience/intelligence";

function sumShares(distribution: Array<{ share: number }>): number {
  return distribution.reduce((acc, entry) => acc + entry.share, 0);
}

function hasNaN(distribution: Array<{ share: number }>): boolean {
  return distribution.some((entry) => Number.isNaN(entry.share));
}

describe("normalizeDistribution", () => {
  it("normalizes shares that sum to ~1 within 1e-9", () => {
    const dist = normalizeDistribution({ US: 30, IN: 50, GB: 20 });
    expect(Math.abs(sumShares(dist) - 1)).toBeLessThan(1e-9);
  });

  it("returns [] for empty/undefined input with no NaN", () => {
    expect(normalizeDistribution(undefined)).toEqual([]);
    expect(normalizeDistribution({})).toEqual([]);
    const allZero = normalizeDistribution({ a: 0, b: 0 });
    expect(allZero).toEqual([]);
    expect(hasNaN(allZero)).toBe(false);
  });

  it("sorts by share desc then key asc as tie-break", () => {
    const dist = normalizeDistribution({ z: 10, a: 10, m: 30 });
    expect(dist.map((e) => e.key)).toEqual(["m", "a", "z"]);
    expect(Math.abs(sumShares(dist) - 1)).toBeLessThan(1e-9);
  });

  it("clamps negative counts to zero", () => {
    const dist = normalizeDistribution({ good: 75, bad: -25 });
    const good = dist.find((e) => e.key === "good");
    const bad = dist.find((e) => e.key === "bad");
    expect(good?.share).toBeCloseTo(1, 9);
    expect(bad?.share).toBe(0);
    expect(Math.abs(sumShares(dist) - 1)).toBeLessThan(1e-9);
  });

  it("returns share 1 for a single bucket", () => {
    const dist = normalizeDistribution({ only: 5 });
    expect(dist).toEqual([{ key: "only", share: 1 }]);
  });
});

describe("estimateAudience", () => {
  const full: AudienceSignals = {
    countrySamples: { US: 600, IN: 400 },
    ageSamples: { "18-24": 500, "25-34": 500 },
    interestSamples: { music: 700, fashion: 300 },
    sampleSize: 2000,
  };

  it("fires LOW_SAMPLE below 1000 and not at/above 1000", () => {
    const low = estimateAudience({ ...full, sampleSize: 999 });
    expect(low.quality.flags).toContain("LOW_SAMPLE");

    const ok = estimateAudience({ ...full, sampleSize: 1000 });
    expect(ok.quality.flags).not.toContain("LOW_SAMPLE");
  });

  it("fires GEO_CONCENTRATION when top geo share > 0.85, not otherwise", () => {
    const concentrated = estimateAudience({
      ...full,
      countrySamples: { US: 900, IN: 100 },
    });
    expect(concentrated.quality.flags).toContain("GEO_CONCENTRATION");

    const spread = estimateAudience({
      ...full,
      countrySamples: { US: 800, IN: 200 },
    });
    expect(spread.quality.flags).not.toContain("GEO_CONCENTRATION");
  });

  it("fires SPARSE_INTERESTS when fewer than 2 interest buckets", () => {
    const sparse = estimateAudience({
      ...full,
      interestSamples: { music: 1000 },
    });
    expect(sparse.quality.flags).toContain("SPARSE_INTERESTS");

    const rich = estimateAudience(full);
    expect(rich.quality.flags).not.toContain("SPARSE_INTERESTS");
  });

  it("scales confidence with sampleSize and dimensions present", () => {
    expect(estimateAudience(full).quality.confidence).toBe("high");

    const someDims = estimateAudience({
      countrySamples: { US: 1000 },
      sampleSize: 2000,
    });
    expect(someDims.quality.confidence).toBe("medium");

    const bigButPartial = estimateAudience({
      ageSamples: { "18-24": 500, "25-34": 500 },
      sampleSize: 5000,
    });
    expect(bigButPartial.quality.confidence).toBe("medium");

    const nothing = estimateAudience({ sampleSize: 5000 });
    expect(nothing.quality.confidence).toBe("low");
  });

  it("is deterministic: same input -> deep-equal output", () => {
    const a = estimateAudience(full);
    const b = estimateAudience(full);
    expect(a).toEqual(b);
  });

  it("produces normalized geo/age/interest distributions summing to ~1", () => {
    const result = estimateAudience(full);
    expect(Math.abs(sumShares(result.geo) - 1)).toBeLessThan(1e-9);
    expect(Math.abs(sumShares(result.age) - 1)).toBeLessThan(1e-9);
    expect(Math.abs(sumShares(result.interests) - 1)).toBeLessThan(1e-9);
  });

  it("handles fully empty input without NaN and as low confidence", () => {
    const result = estimateAudience({});
    expect(result.geo).toEqual([]);
    expect(result.age).toEqual([]);
    expect(result.interests).toEqual([]);
    expect(result.quality.confidence).toBe("low");
    expect(result.quality.flags).toContain("LOW_SAMPLE");
    expect(result.quality.flags).toContain("SPARSE_INTERESTS");
  });
});
