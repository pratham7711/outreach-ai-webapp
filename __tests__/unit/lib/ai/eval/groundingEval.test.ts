import {
  evaluateGrounding,
  evaluateSample,
  assertGroundingQuality,
  GroundingQualityError,
} from "@/lib/ai/eval/groundingEval";

describe("evaluateGrounding", () => {
  it("marks evidence-only output as grounded with rate 0", () => {
    const result = evaluateGrounding(
      "Engagement was 4.2% across 120 posts.",
      [4.2, 120],
    );
    expect(result.grounded).toBe(true);
    expect(result.total).toBe(2);
    expect(result.supported).toBe(2);
    expect(result.unsupported).toEqual([]);
    expect(result.hallucinationRate).toBe(0);
  });

  it("lists an invented number as unsupported and computes rate", () => {
    const result = evaluateGrounding(
      "Engagement was 4.2% but reach hit 99999.",
      [4.2],
    );
    expect(result.grounded).toBe(false);
    expect(result.total).toBe(2);
    expect(result.supported).toBe(1);
    expect(result.unsupported).toEqual(["99999"]);
    expect(result.hallucinationRate).toBeCloseTo(0.5, 10);
  });

  it("does NOT auto-allow a derived value absent from evidenceValues", () => {
    const result = evaluateGrounding(
      "Two factors of 10 and 20 sum to 30.",
      [10, 20],
    );
    expect(result.grounded).toBe(false);
    expect(result.unsupported).toEqual(["30"]);
    expect(result.supported).toBe(2);
    expect(result.total).toBe(3);
  });

  it("does NOT auto-allow a rounded/scaled variant of an evidence value", () => {
    const result = evaluateGrounding(
      "Score of 4.2 rounds to 4 or scales to 420.",
      [4.2],
    );
    expect(result.grounded).toBe(false);
    expect(result.supported).toBe(1);
    expect(result.unsupported).toEqual(["4", "420"]);
  });

  it("returns rate 0 and grounded true when output has no numbers (total=0)", () => {
    const result = evaluateGrounding("The campaign performed well overall.", [5, 6]);
    expect(result.total).toBe(0);
    expect(result.hallucinationRate).toBe(0);
    expect(result.grounded).toBe(true);
    expect(result.supported).toBe(0);
    expect(result.unsupported).toEqual([]);
  });

  it("keeps hallucinationRate bounded in [0,1] with multiple unsupported", () => {
    const result = evaluateGrounding(
      "Numbers 1 2 3 4 appeared, none in evidence.",
      [],
    );
    expect(result.total).toBe(4);
    expect(result.unsupported.length).toBe(4);
    expect(result.hallucinationRate).toBe(1);
    expect(result.hallucinationRate).toBeGreaterThanOrEqual(0);
    expect(result.hallucinationRate).toBeLessThanOrEqual(1);
  });

  it("normalizes percent tokens and string evidence consistently", () => {
    const result = evaluateGrounding("CTR was 12.5%.", ["rate was 12.5%"]);
    expect(result.grounded).toBe(true);
    expect(result.supported).toBe(1);
    expect(result.unsupported).toEqual([]);
  });

  it("ignores non-finite numeric evidence (NaN/Infinity) safely", () => {
    const result = evaluateGrounding("Value 50 reported.", [Number.NaN, Infinity, 50]);
    expect(result.grounded).toBe(true);
    expect(result.supported).toBe(1);
    expect(result.total).toBe(1);
  });

  it("treats a hyphenated range as two bounds, not a spurious negative", () => {
    const result = evaluateGrounding("Engagement sat in the 10-20 range.", [10, 20]);
    expect(result.grounded).toBe(true);
    expect(result.total).toBe(2);
    expect(result.supported).toBe(2);
    expect(result.unsupported).toEqual([]);
  });

  it("is deterministic across repeated calls on the same input", () => {
    const a = evaluateGrounding("Saw 7 and 8 and 999.", [7, 8]);
    const b = evaluateGrounding("Saw 7 and 8 and 999.", [7, 8]);
    expect(a).toEqual(b);
  });
});

describe("evaluateSample", () => {
  it("aggregates mean, worst, failures and passRate over a mix", () => {
    const sample = evaluateSample([
      { output: "Clean 10 and 20.", evidenceValues: [10, 20] },
      { output: "Has invented 5.", evidenceValues: [] },
      { output: "Half good 3 and bad 4.", evidenceValues: [3] },
    ]);
    expect(sample.caseCount).toBe(3);
    expect(sample.failures).toBe(2);
    expect(sample.worst).toEqual({ index: 1, rate: 1 });
    expect(sample.passRate).toBeCloseTo(1 / 3, 10);
    expect(sample.meanHallucinationRate).toBeCloseTo((0 + 1 + 0.5) / 3, 10);
  });

  it("returns an empty-safe result for an empty sample", () => {
    const sample = evaluateSample([]);
    expect(sample).toEqual({
      caseCount: 0,
      meanHallucinationRate: 0,
      worst: null,
      failures: 0,
      passRate: 1,
    });
  });

  it("changes pass/fail with the threshold opt", () => {
    const cases = [{ output: "Good 1 bad 2.", evidenceValues: [1] }];
    const strict = evaluateSample(cases);
    const lenient = evaluateSample(cases, { threshold: 0.6 });
    expect(strict.failures).toBe(1);
    expect(strict.passRate).toBe(0);
    expect(lenient.failures).toBe(0);
    expect(lenient.passRate).toBe(1);
  });

  it("validates malformed cases via zod", () => {
    expect(() =>
      evaluateSample([{ output: 123 } as unknown as { output: string; evidenceValues: number[] }]),
    ).toThrow();
  });
});

describe("assertGroundingQuality", () => {
  it("throws a typed error when mean rate exceeds the bar", () => {
    const sample = evaluateSample([{ output: "bad 9", evidenceValues: [] }]);
    expect(() => assertGroundingQuality(sample, { maxMeanRate: 0.1 })).toThrow(
      GroundingQualityError,
    );
  });

  it("throws a typed error when pass rate is below the bar", () => {
    const sample = evaluateSample([{ output: "bad 9", evidenceValues: [] }]);
    expect(() => assertGroundingQuality(sample, { minPassRate: 0.9 })).toThrow(
      GroundingQualityError,
    );
  });

  it("passes silently when the sample is above the bar", () => {
    const sample = evaluateSample([{ output: "good 5", evidenceValues: [5] }]);
    expect(() =>
      assertGroundingQuality(sample, { maxMeanRate: 0.1, minPassRate: 0.9 }),
    ).not.toThrow();
  });
});
