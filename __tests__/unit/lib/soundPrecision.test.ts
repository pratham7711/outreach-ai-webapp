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
     only record of that stretch, and is kept -- without a change across it. */
  it("keeps a rounded run after the last exact reading, with no velocity", () => {
    const series = soundSeries(
      [
        { recordedAt: at("2026-09-23T16:30:00Z"), usesCount: 8_659 },
        { recordedAt: at("2026-09-24T04:00:00Z"), usesCount: 12_000 },
        { recordedAt: at("2026-09-25T04:00:00Z"), usesCount: 15_000 },
      ],
      { bucketHours: 24 },
    );
    expect(series.map((p) => [p.usesCount, p.precision, p.velocity])).toEqual([
      [8_659, "exact", null],
      [12_000, "rounded", null],
      [15_000, "rounded", null],
    ]);
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
