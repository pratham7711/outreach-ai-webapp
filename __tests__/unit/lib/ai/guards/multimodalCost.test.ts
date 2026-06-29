import {
  DEFAULT_MULTIMODAL_RATES,
  estimateMultimodalCost,
  assertWithinMultimodalBudget,
  assertWithinMultimodalBudgetOrThrow,
  type MultimodalUsage,
  type MultimodalRates,
} from "@/lib/ai/guards/multimodalCost";

describe("estimateMultimodalCost", () => {
  it("sums a full multimodal usage by the default rates", () => {
    const usage: MultimodalUsage = {
      inputTokens: 2000,
      outputTokens: 1000,
      images: 3,
      videoSeconds: 10,
      audioSeconds: 30,
    };
    const r = DEFAULT_MULTIMODAL_RATES;
    const expected =
      (2000 / 1000) * r.inputPer1kTokens +
      (1000 / 1000) * r.outputPer1kTokens +
      3 * r.perImage +
      10 * r.perVideoSecond +
      30 * r.perAudioSecond;

    const result = estimateMultimodalCost(usage);
    expect(result.totalUsd).toBeCloseTo(expected, 12);
    expect(result.totalUsd).toBeGreaterThan(0);
  });

  it("produces a correct byModality breakdown", () => {
    const usage: MultimodalUsage = {
      inputTokens: 1000,
      outputTokens: 2000,
      images: 5,
      videoSeconds: 4,
      audioSeconds: 100,
    };
    const r = DEFAULT_MULTIMODAL_RATES;
    const result = estimateMultimodalCost(usage);

    expect(Object.keys(result.byModality).sort()).toEqual(
      ["audio", "images", "text", "video"].sort(),
    );
    expect(result.byModality.text).toBeCloseTo(
      (1000 / 1000) * r.inputPer1kTokens + (2000 / 1000) * r.outputPer1kTokens,
      12,
    );
    expect(result.byModality.images).toBeCloseTo(5 * r.perImage, 12);
    expect(result.byModality.video).toBeCloseTo(4 * r.perVideoSecond, 12);
    expect(result.byModality.audio).toBeCloseTo(100 * r.perAudioSecond, 12);
    expect(result.byModality.text + result.byModality.images + result.byModality.video + result.byModality.audio).toBeCloseTo(
      result.totalUsd,
      12,
    );
  });

  it("treats non-finite and negative units as zero contribution (no NaN)", () => {
    const usage: MultimodalUsage = {
      inputTokens: Number.NaN,
      outputTokens: Number.POSITIVE_INFINITY,
      images: -5,
      videoSeconds: Number.NEGATIVE_INFINITY,
      audioSeconds: -0.0001,
    };
    const result = estimateMultimodalCost(usage);
    expect(Number.isNaN(result.totalUsd)).toBe(false);
    expect(Number.isFinite(result.totalUsd)).toBe(true);
    expect(result.totalUsd).toBe(0);
    expect(result.byModality.text).toBe(0);
    expect(result.byModality.images).toBe(0);
    expect(result.byModality.video).toBe(0);
    expect(result.byModality.audio).toBe(0);
  });

  it("does not zero a valid sibling modality when one field is non-finite (fail-closed for budget)", () => {
    const r = DEFAULT_MULTIMODAL_RATES;
    const result = estimateMultimodalCost({
      inputTokens: Number.NaN,
      images: 5,
      videoSeconds: 10,
    });
    expect(result.byModality.text).toBe(0);
    expect(result.byModality.images).toBeCloseTo(5 * r.perImage, 12);
    expect(result.byModality.video).toBeCloseTo(10 * r.perVideoSecond, 12);
    expect(result.totalUsd).toBeCloseTo(5 * r.perImage + 10 * r.perVideoSecond, 12);
    expect(result.totalUsd).toBeGreaterThan(0);
  });

  it("still flags an over-budget run when an unrelated field is NaN", () => {
    const assertion = assertWithinMultimodalBudget(
      { inputTokens: Number.NaN, images: 1000 },
      0.01,
    );
    expect(assertion.ok).toBe(false);
    expect(assertion.totalUsd).toBeGreaterThan(0.01);
  });

  it("returns totalUsd 0 for empty usage", () => {
    const result = estimateMultimodalCost({});
    expect(result.totalUsd).toBe(0);
    expect(result.byModality.text).toBe(0);
    expect(result.byModality.images).toBe(0);
    expect(result.byModality.video).toBe(0);
    expect(result.byModality.audio).toBe(0);
  });

  it("applies custom rates that override the defaults", () => {
    const customRates: MultimodalRates = {
      inputPer1kTokens: 1,
      outputPer1kTokens: 2,
      perImage: 10,
      perVideoSecond: 100,
      perAudioSecond: 1000,
    };
    const usage: MultimodalUsage = {
      inputTokens: 1000,
      outputTokens: 1000,
      images: 1,
      videoSeconds: 1,
      audioSeconds: 1,
    };
    const result = estimateMultimodalCost(usage, customRates);
    expect(result.byModality.text).toBeCloseTo(1 * 1 + 1 * 2, 12);
    expect(result.byModality.images).toBe(10);
    expect(result.byModality.video).toBe(100);
    expect(result.byModality.audio).toBe(1000);
    expect(result.totalUsd).toBeCloseTo(3 + 10 + 100 + 1000, 12);
  });

  it("falls back to default rates when given malformed rates", () => {
    const badRates = { inputPer1kTokens: "free" } as unknown as MultimodalRates;
    const usage: MultimodalUsage = { inputTokens: 1000 };
    const result = estimateMultimodalCost(usage, badRates);
    expect(result.byModality.text).toBeCloseTo(DEFAULT_MULTIMODAL_RATES.inputPer1kTokens, 12);
  });

  it("is deterministic for the same input", () => {
    const usage: MultimodalUsage = {
      inputTokens: 1234,
      outputTokens: 5678,
      images: 7,
      videoSeconds: 9,
      audioSeconds: 11,
    };
    const a = estimateMultimodalCost(usage);
    const b = estimateMultimodalCost(usage);
    expect(a).toEqual(b);
  });
});

describe("assertWithinMultimodalBudget", () => {
  const usage: MultimodalUsage = {
    inputTokens: 1000,
    outputTokens: 1000,
    images: 1,
  };

  it("is ok when total is strictly under the cap", () => {
    const { totalUsd } = estimateMultimodalCost(usage);
    const res = assertWithinMultimodalBudget(usage, totalUsd + 1);
    expect(res.ok).toBe(true);
    expect(res.totalUsd).toBeCloseTo(totalUsd, 12);
  });

  it("blocks exactly at the cap (>=, boundary fail-closed)", () => {
    const { totalUsd } = estimateMultimodalCost(usage);
    const res = assertWithinMultimodalBudget(usage, totalUsd);
    expect(res.ok).toBe(false);
  });

  it("blocks when over the cap", () => {
    const { totalUsd } = estimateMultimodalCost(usage);
    const res = assertWithinMultimodalBudget(usage, totalUsd - 0.0001);
    expect(res.ok).toBe(false);
  });

  it("fail-closes on a non-finite or negative cap (never grants unlimited)", () => {
    expect(assertWithinMultimodalBudget(usage, Number.NaN).ok).toBe(false);
    expect(assertWithinMultimodalBudget(usage, Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(assertWithinMultimodalBudget(usage, -100).ok).toBe(false);
    expect(assertWithinMultimodalBudget({}, 0).ok).toBe(false);
  });

  it("throwing variant throws when blocked and returns when ok", () => {
    const { totalUsd } = estimateMultimodalCost(usage);
    expect(() => assertWithinMultimodalBudgetOrThrow(usage, totalUsd)).toThrow();
    const res = assertWithinMultimodalBudgetOrThrow(usage, totalUsd + 1);
    expect(res.ok).toBe(true);
    expect(res.totalUsd).toBeCloseTo(totalUsd, 12);
  });
});
