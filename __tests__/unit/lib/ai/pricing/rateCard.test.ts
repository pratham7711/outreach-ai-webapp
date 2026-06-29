import {
  percentileOf,
  benchmarkRate,
  BenchmarkResult,
} from "@/lib/ai/pricing/rateCard";

const KNOWN = [10, 20, 30, 40, 50];

describe("percentileOf", () => {
  it("returns 0 at the strict minimum tie-aware position for the smallest value", () => {
    expect(percentileOf(10, KNOWN)).toBe(10);
  });

  it("returns 50 for the median of a known symmetric set", () => {
    expect(percentileOf(30, KNOWN)).toBe(50);
  });

  it("returns the tie-aware high position for the maximum value", () => {
    expect(percentileOf(50, KNOWN)).toBe(90);
  });

  it("places a value below all peers at 0 and above all peers at 100", () => {
    expect(percentileOf(0, KNOWN)).toBe(0);
    expect(percentileOf(1000, KNOWN)).toBe(100);
  });

  it("guards an empty distribution with a neutral value and no NaN", () => {
    const p = percentileOf(42, []);
    expect(p).toBe(50);
    expect(Number.isNaN(p)).toBe(false);
  });

  it("guards a non-finite value with a neutral value", () => {
    expect(percentileOf(Number.NaN, KNOWN)).toBe(50);
    expect(percentileOf(Number.POSITIVE_INFINITY, KNOWN)).toBe(50);
  });
});

describe("benchmarkRate classification", () => {
  const peers = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

  it("classifies a clearly-low rate as below", () => {
    const result = benchmarkRate({ rate: 90, peerRates: peers });
    expect(result.band).toBe("below");
    expect(result.percentile).toBeLessThan(25);
  });

  it("classifies a mid rate as fair", () => {
    const result = benchmarkRate({ rate: 550, peerRates: peers });
    expect(result.band).toBe("fair");
  });

  it("classifies a clearly-high rate as above", () => {
    const result = benchmarkRate({ rate: 1100, peerRates: peers });
    expect(result.band).toBe("above");
    expect(result.percentile).toBeGreaterThan(75);
  });
});

describe("benchmarkRate suggestedRange and median", () => {
  const peers = [10, 20, 30, 40, 50];

  it("suggestedRange has low <= high and lies within peer min/max", () => {
    const result = benchmarkRate({ rate: 30, peerRates: peers });
    expect(result.suggestedRange.low).toBeLessThanOrEqual(result.suggestedRange.high);
    expect(result.suggestedRange.low).toBeGreaterThanOrEqual(10);
    expect(result.suggestedRange.high).toBeLessThanOrEqual(50);
  });

  it("computes the correct median on a known set", () => {
    const result = benchmarkRate({ rate: 30, peerRates: peers });
    expect(result.median).toBe(30);
  });

  it("returns the explainable factors shape", () => {
    const result = benchmarkRate({ rate: 30, peerRates: peers });
    expect(Array.isArray(result.factors)).toBe(true);
    expect(result.factors.length).toBeGreaterThan(0);
    for (const factor of result.factors) {
      expect(typeof factor.label).toBe("string");
      expect(Number.isFinite(factor.impact)).toBe(true);
    }
  });
});

describe("benchmarkRate safety", () => {
  const peers = [100, 200, 300, 400, 500];

  it("monotone: a higher rate yields a percentile >= a lower rate's", () => {
    const lowRate = benchmarkRate({ rate: 150, peerRates: peers });
    const highRate = benchmarkRate({ rate: 450, peerRates: peers });
    expect(highRate.percentile).toBeGreaterThanOrEqual(lowRate.percentile);
  });

  it("guards a non-finite rate without throwing or producing NaN", () => {
    let result: BenchmarkResult | undefined;
    expect(() => {
      result = benchmarkRate({ rate: Number.NaN, peerRates: peers });
    }).not.toThrow();
    const r = result as BenchmarkResult;
    expect(Number.isNaN(r.percentile)).toBe(false);
    expect(Number.isNaN(r.median)).toBe(false);
  });

  it("empty peerRates yields a defined low-confidence result, never a throw or NaN", () => {
    let result: BenchmarkResult | undefined;
    expect(() => {
      result = benchmarkRate({ rate: 500, peerRates: [] });
    }).not.toThrow();
    const r = result as BenchmarkResult;
    expect(r.band).toBe("fair");
    expect(r.percentile).toBe(50);
    expect(Number.isNaN(r.percentile)).toBe(false);
    expect(r.factors.length).toBeGreaterThan(0);
  });

  it("is deterministic: same input -> deep-equal output", () => {
    const a = benchmarkRate({ rate: 350, peerRates: peers, opts: { fairLowPct: 20, fairHighPct: 80 } });
    const b = benchmarkRate({ rate: 350, peerRates: peers, opts: { fairLowPct: 20, fairHighPct: 80 } });
    expect(a).toEqual(b);
  });

  it("ignores filthy peer values (NaN/Infinity) instead of corrupting the distribution", () => {
    const dirty = benchmarkRate({
      rate: 300,
      peerRates: [100, Number.NaN, 200, Number.POSITIVE_INFINITY, 300, 400, 500],
    });
    expect(Number.isNaN(dirty.median)).toBe(false);
    expect(dirty.median).toBe(300);
  });
});
