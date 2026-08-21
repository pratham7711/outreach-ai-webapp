import { cpm, formatMetric, periodDelta } from "@/lib/metrics/trend";

describe("periodDelta", () => {
  it("returns null below four points, because half of three is not a period", () => {
    expect(periodDelta([1, 2, 3])).toBeNull();
  });

  it("returns null when the earlier half is zero, rather than an infinite rise", () => {
    expect(periodDelta([0, 0, 5, 9])).toBeNull();
  });

  it("compares the two halves", () => {
    // previous = 10+10 = 20, current = 15+15 = 30 → +50%
    expect(periodDelta([10, 10, 15, 15])).toMatchObject({ value: "+50.0%", trend: "up" });
  });

  it("separates direction from tone", () => {
    const rising = [10, 10, 15, 15];
    expect(periodDelta(rising, { higherIsBetter: true })).toMatchObject({ trend: "up", isGood: true });
    // Same rise, but for spend a rise is not a win.
    expect(periodDelta(rising, { higherIsBetter: false })).toMatchObject({ trend: "up", isGood: false });
  });

  it("reads an unchanged series as flat, not as a 0% move in some direction", () => {
    expect(periodDelta([7, 7, 7, 7])).toMatchObject({ trend: "flat", isGood: true });
  });
});

describe("formatMetric", () => {
  it("distinguishes never-measured from zero", () => {
    expect(formatMetric(null, String)).toBe("—");
    expect(formatMetric(undefined, String)).toBe("—");
    expect(formatMetric(NaN, String)).toBe("—");
    expect(formatMetric(0, String)).toBe("0");
  });
});

describe("cpm", () => {
  it("is null with no views to divide by", () => {
    expect(cpm(100, 0)).toBeNull();
  });

  it("is spend per thousand views", () => {
    expect(cpm(50, 100_000)).toBe(0.5);
  });
});
