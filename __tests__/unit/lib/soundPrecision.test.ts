/**
 * A sound's use count is either the platform's exact figure or its display
 * rounding ("73.9K", "15K"), and a change is only knowable between two exact
 * ones. Numbers below are production's (2026-10-03), anonymised.
 */
import {
  readingPrecision,
  roundedAddsNothing,
  roundingStep,
  soundReadingChange,
  usesPrecisionOf,
} from "@/lib/sounds/precision";
import { soundSeries, videosAddedSinceLast } from "@/lib/sounds/usageSeries";

const HOUR = 3_600_000;
const at = (iso: string) => new Date(iso);

describe("usesPrecisionOf", () => {
  it("reads 10K and up in hundreds as rounded, everything else as a count", () => {
    expect(usesPrecisionOf(73_900)).toBe("rounded");
    expect(usesPrecisionOf(15_000)).toBe("rounded");
    expect(usesPrecisionOf(1_200_000)).toBe("rounded");
    expect(usesPrecisionOf(73_912)).toBe("exact");
    // Below 10K both platforms print the count, round hundreds included.
    expect(usesPrecisionOf(7_400)).toBe("exact");
    expect(usesPrecisionOf(44)).toBe("exact");
  });

  it("takes a reader's own word over the value's shape", () => {
    expect(readingPrecision(12_000, "exact")).toBe("exact");
    expect(readingPrecision(1_200, "rounded")).toBe("rounded");
    expect(readingPrecision(12_000)).toBe("rounded");
  });
});

describe("soundReadingChange", () => {
  it("measures a change between two exact counts", () => {
    expect(soundReadingChange(6_921, 7_429)).toEqual({
      known: true, videosAdded24h: 508, deltaUses24h: 508, velocityScore: 7.34,
    });
  });

  it("floors videos added but keeps the signed change", () => {
    const c = soundReadingChange(7_429, 7_428);
    expect(c.videosAdded24h).toBe(0);
    expect(c.deltaUses24h).toBe(-1);
  });

  /* The 74K sound's stored "videos added" summed to 2,500, every unit of it
     the difference between two roundings. */
  it("measures nothing between rounded figures, or across a precision change", () => {
    for (const [prev, cur] of [[73_500, 73_900], [74_000, 74_100], [8_659, 12_000], [12_000, 12_345]]) {
      expect(soundReadingChange(prev, cur)).toEqual({ known: false, videosAdded24h: 0, deltaUses24h: 0, velocityScore: 0 });
    }
    expect(soundReadingChange(undefined, 46).known).toBe(false);
  });
});

describe("roundedAddsNothing", () => {
  it("refuses a rounded figure that agrees with the exact count before it", () => {
    expect(roundingStep(74_000)).toBe(1_000);
    expect(roundingStep(74_100)).toBe(100);
    expect(roundedAddsNothing(73_912, 74_000, "rounded")).toBe(true);
    expect(roundedAddsNothing(73_912, 74_100, "rounded")).toBe(false);
    expect(roundedAddsNothing(8_659, 12_000, "rounded")).toBe(false);
  });

  it("has nothing to protect after a rounded figure or for an exact one", () => {
    expect(roundedAddsNothing(74_000, 74_000, "rounded")).toBe(false);
    expect(roundedAddsNothing(73_912, 73_950, "exact")).toBe(false);
    expect(roundedAddsNothing(undefined, 74_000, "rounded")).toBe(false);
  });
});

describe("soundSeries", () => {
  it("keeps one reading per bucket, the latest", () => {
    const rows = [0, 2, 5, 7].map((s) => ({ recordedAt: new Date(Date.UTC(2026, 8, 23, 19, 44, s)), usesCount: 8_659 + s }));
    const series = soundSeries(rows, { bucketHours: 24 });
    expect(series).toHaveLength(1);
    expect(series[0].usesCount).toBe(8_666);
  });

  it("drops a rounded reading between exact ones, and prefers exact within a bucket", () => {
    const series = soundSeries(
      [
        { recordedAt: at("2026-09-01T04:00:00Z"), usesCount: 73_812 },
        { recordedAt: at("2026-09-02T04:00:00Z"), usesCount: 74_000 }, // between two exact: dropped
        { recordedAt: at("2026-09-03T04:00:00Z"), usesCount: 74_013 },
        { recordedAt: at("2026-09-03T18:00:00Z"), usesCount: 74_100 }, // same day as an exact, later
        { recordedAt: at("2026-09-04T04:00:00Z"), usesCount: 74_160 },
      ],
      { bucketHours: 24 },
    );
    expect(series.map((p) => p.usesCount)).toEqual([73_812, 74_013, 74_160]);
    // 09-01 -> 09-03 skips a bucket, so no velocity; 09-03 -> 09-04 is adjacent.
    expect(series.map((p) => p.velocity)).toEqual([null, null, 0.2]);
  });

  /* Instagram prints a count up to 10K and "12K" after: the rounded tail is the
     only record of that stretch, and is kept. 12K is 11.5 hours after the count
     -- too close to scale to a day -- and 3K past 12K is under five 1K steps;
     15K against the exact 8,659 is wide enough, so it gets an estimate. */
  it("keeps a rounded run after the last exact reading, measuring only changes wider than the rounding", () => {
    const series = soundSeries(
      [
        { recordedAt: at("2026-09-23T16:30:00Z"), usesCount: 8_659 },
        { recordedAt: at("2026-09-24T04:00:00Z"), usesCount: 12_000 },
        { recordedAt: at("2026-09-25T04:00:00Z"), usesCount: 15_000 },
      ],
      { bucketHours: 24 },
    );
    expect(series.map((p) => [p.usesCount, p.precision, p.velocity, p.velocityApprox])).toEqual([
      [8_659, "exact", null, false],
      [12_000, "rounded", null, false],
      // (15,000 / 8,659) ^ (24h / 35.5h) - 1, per day.
      [15_000, "rounded", 44.98, true],
    ]);
  });

  /* What TikTok gives for a sound past 10K: every reading a multiple of 100.
     Before, every point's velocity was null and the chart was empty. */
  it("measures velocity on a TikTok sound whose every reading is rounded", () => {
    const rows = Array.from({ length: 6 }, (_, d) => ({
      recordedAt: new Date(Date.UTC(2026, 9, 11 + d, 20)),
      usesCount: 268_700 + d * 1_800,
    }));
    const series = soundSeries(rows, { bucketHours: 24 });
    expect(series.every((p) => p.precision === "rounded")).toBe(true);
    expect(series[0].velocity).toBeNull();
    for (const p of series.slice(1)) {
      expect(p.velocityApprox).toBe(true);
      expect(p.velocity).toBeGreaterThan(0.6);
      expect(p.velocity).toBeLessThan(0.7);
    }
  });

  it("looks back past a day too slow to beat the rounding, and no further than three", () => {
    const day = (d: number, usesCount: number) => ({ recordedAt: new Date(Date.UTC(2026, 9, 1 + d, 20)), usesCount });
    // +400 a day against a 100 step on each end: two days is under 5 x 200, three is not.
    const slow = soundSeries([0, 1, 2, 3, 4].map((d) => day(d, 268_700 + d * 400)), { bucketHours: 24 });
    expect(slow.map((p) => p.velocity)).toEqual([null, null, null, expect.any(Number), expect.any(Number)]);
    // Per day, not per three days: 1,200 over three days is about 0.15% a day.
    expect(slow[3].velocity).toBeCloseTo(0.15, 2);
    // Never further back than three days: a sound that crawls gets no velocity at all.
    const crawl = soundSeries([0, 1, 2, 3, 4, 5].map((d) => day(d, 268_700 + d * 100)), { bucketHours: 24 });
    expect(crawl.every((p) => p.velocity === null)).toBe(true);
  });

  it("reads a round thousand at the rounding its neighbours show", () => {
    const day = (d: number, usesCount: number) => ({ recordedAt: new Date(Date.UTC(2026, 9, 12 + d, 20)), usesCount });
    // 273,000 alone could be "273K"; beside 271,200 and 274,800 it is "273.0K".
    const series = soundSeries([267_600, 269_400, 271_200, 273_000, 274_800].map((u, d) => day(d, u)), { bucketHours: 24 });
    expect(series.slice(1).map((p) => p.velocity !== null && p.velocityApprox)).toEqual([true, true, true, true]);
    expect(series[3].velocity).toBeCloseTo(0.66, 1);
  });

  it("keeps a thousand's rounding for a sound only ever printed to the thousand", () => {
    const day = (d: number, usesCount: number) => ({ recordedAt: new Date(Date.UTC(2026, 9, 1 + d, 20)), usesCount });
    const series = soundSeries([15_000, 16_000, 17_000, 18_000].map((u, d) => day(d, u)), { bucketHours: 24 });
    expect(series.every((p) => p.velocity === null)).toBe(true);
  });

  it("keeps a velocity between exact counts exact", () => {
    const series = soundSeries(
      [
        { recordedAt: at("2026-09-01T04:00:00Z"), usesCount: 8_001 },
        { recordedAt: at("2026-09-02T04:00:00Z"), usesCount: 8_401 },
      ],
      { bucketHours: 24 },
    );
    expect(series[1]).toMatchObject({ velocity: 5, velocityApprox: false });
  });

  it("does not depend on the order rows arrive in", () => {
    const rows = [1, 2, 3].map((d) => ({ recordedAt: new Date(Date.UTC(2026, 8, d)), usesCount: 100 * d + 1 }));
    expect(soundSeries([...rows].reverse(), { bucketHours: 24 })).toEqual(soundSeries(rows, { bucketHours: 24 }));
  });

  /* Scale: a year of four-hourly reads with a week-long outage, collapsed to
     daily points. One point per day that had a reading, oldest first, the
     outage leaving no point and no velocity across it. */
  it("buckets a year of readings into one point per day read", () => {
    const start = Date.UTC(2025, 9, 1);
    const rows: { recordedAt: Date; usesCount: number }[] = [];
    let uses = 5_001;
    for (let h = 0; h < 365 * 24; h += 4) {
      const day = Math.floor(h / 24);
      if (day >= 200 && day < 207) continue;
      uses += 3;
      rows.push({ recordedAt: new Date(start + h * HOUR), usesCount: uses % 100 === 0 ? uses + 1 : uses });
    }
    const series = soundSeries(rows.reverse(), { bucketHours: 24 });

    expect(series).toHaveLength(358);
    for (let i = 1; i < series.length; i++) expect(series[i].t).toBeGreaterThan(series[i - 1].t);
    const afterOutage = series.findIndex((p) => p.t >= start + 207 * 24 * HOUR);
    expect(series[afterOutage].velocity).toBeNull();
    expect(series[afterOutage + 1].velocity).not.toBeNull();
  });
});

describe("videosAddedSinceLast", () => {
  it("is the change between the two newest readings when both are exact", () => {
    expect(videosAddedSinceLast([{ recordedAt: at("2026-09-02"), usesCount: 44 }, { recordedAt: at("2026-09-01"), usesCount: 23 }])).toBe(21);
  });

  it("is unknown with one reading, or a rounded figure at either end", () => {
    expect(videosAddedSinceLast([{ recordedAt: at("2026-09-02"), usesCount: 44 }])).toBeNull();
    expect(videosAddedSinceLast([{ recordedAt: at("2026-09-02"), usesCount: 74_100 }, { recordedAt: at("2026-09-01"), usesCount: 73_700 }])).toBeNull();
    expect(videosAddedSinceLast([{ recordedAt: at("2026-09-02"), usesCount: 12_000 }, { recordedAt: at("2026-09-01"), usesCount: 8_659 }])).toBeNull();
  });
});
