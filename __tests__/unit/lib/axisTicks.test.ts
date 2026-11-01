/**
 * @jest-environment node
 *
 * The client report's value axis. Recharts' default stepped a 2.5M stack by
 * 650K and labelled the 1.95M line "2M"; its round-number mode put the same
 * stack on a 0-4M axis.
 */
import { formatTick, niceAxis, niceTicks, stackExtent } from "@/lib/charts/axisTicks";

/** "1.25M" -> 1250000: reads a compact label back, to check it names its tick. */
function readCompact(label: string): number {
  const m = /^(-?[\d.]+)([KMBT]?)$/.exec(label);
  if (!m) throw new Error(`not a compact label: ${label}`);
  return Number(m[1]) * { "": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2] as "" | "K" | "M" | "B" | "T"];
}

describe("niceTicks", () => {
  it("ends at the first round value above the data, in at most five steps", () => {
    expect(niceTicks(0, 2_506_072)).toEqual([0, 1_000_000, 2_000_000, 3_000_000]);
    expect(niceTicks(0, 1_300_000)).toEqual([0, 500_000, 1_000_000, 1_500_000]);
    expect(niceTicks(0, 1000)).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(niceTicks(0, 2_400)).toEqual([0, 500, 1000, 1500, 2000, 2500]);
  });

  it("only steps by 1, 2, 2.5 or 5 times a power of ten, never below 1", () => {
    for (const max of [1, 3, 7, 19, 99, 101, 4_321, 77_777, 650_000, 9_999_999, 123_456_789]) {
      const ticks = niceTicks(0, max)!;
      const step = ticks[1] - ticks[0];
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 2.5, 5]).toContain(Number(mantissa.toPrecision(6)));
      expect(step).toBeGreaterThanOrEqual(1);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
      expect(ticks.length - 1).toBeLessThanOrEqual(5);
    }
  });

  it("keeps zero as a tick when the stack goes below it, and marks only the steps the dip reaches", () => {
    expect(niceTicks(-30_000, 90_000)).toEqual([-25_000, 0, 25_000, 50_000, 75_000, 100_000]);
    // One view down on one day used to cost a whole step: -50 under a 0-150 axis.
    expect(niceTicks(-1, 105)).toEqual([0, 25, 50, 75, 100, 125]);
    expect(niceTicks(-105, 0)).toEqual([-100, -80, -60, -40, -20, 0]);
  });

  it("never steps by a fraction of a view", () => {
    expect(niceTicks(0, 12)).toEqual([0, 5, 10, 15]);
    expect(niceTicks(0, 1)).toEqual([0, 1]);
  });

  it("gives nothing to mark for an empty range", () => {
    expect(niceTicks(0, 0)).toBeUndefined();
    expect(niceTicks(Number.NaN, 5)).toBeUndefined();
    expect(niceTicks(-1.7e308, 1.7e308)).toBeUndefined();
  });
});

describe("formatTick", () => {
  it("labels every tick with its exact value", () => {
    expect(formatTick(1_250_000)).toBe("1.25M");
    for (const max of [9, 120, 1_100, 1_250, 7_400, 12_345, 1_100_000, 3_600_000, 11_000_000, 1_150_000_000]) {
      for (const tick of niceTicks(-max / 7, max)!) expect(readCompact(formatTick(tick))).toBeCloseTo(tick, 6);
    }
  });
});

describe("niceAxis", () => {
  it("pins the domain to the first and last tick, and leaves an empty range to Recharts", () => {
    expect(niceAxis([0, 2_506_072])).toEqual({ ticks: [0, 1_000_000, 2_000_000, 3_000_000], domain: [0, 3_000_000] });
    expect(niceAxis([0, 0])).toEqual({});
    expect(niceAxis([-1, 105])).toEqual({ ticks: [0, 25, 50, 75, 100, 125], domain: [-1, 125] });
  });
});

describe("stackExtent", () => {
  it("sums each row's negatives and positives apart, as a signed stack draws them", () => {
    const rows = [
      { date: "a", TIKTOK: 5, YOUTUBE: -2, INSTAGRAM: null },
      { date: "b", TIKTOK: -4, YOUTUBE: -3, INSTAGRAM: 10 },
    ];
    expect(stackExtent(rows, ["TIKTOK", "YOUTUBE", "INSTAGRAM"])).toEqual([-7, 10]);
  });
});
