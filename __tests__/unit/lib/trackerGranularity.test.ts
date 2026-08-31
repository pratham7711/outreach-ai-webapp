import {
  DEFAULT_GRANULARITY,
  downsample,
  effectiveChartGranularity,
  isDueForRead,
  parseGranularity,
  snapshotFetchLimit,
} from "@/lib/trackers/granularity";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const snap = (value: number, h: number) => ({ value, recordedAt: hoursAgo(h) });

describe("parseGranularity", () => {
  it("defaults to CreatorCore's shape: daily points, a year of history", () => {
    expect(parseGranularity(null)).toEqual({
      readCadence: "4hourly",
      chartGranularity: "daily",
      retentionDays: 365,
    });
  });

  it("reads a well-formed block", () => {
    expect(
      parseGranularity({ trackers: { readCadence: "hourly", chartGranularity: "weekly", retentionDays: 90 } })
    ).toEqual({ readCadence: "hourly", chartGranularity: "weekly", retentionDays: 90 });
  });

  it("falls back per-field, so one bad key cannot blank the rest", () => {
    // A garbage granularity must not silently re-point the reader as well.
    const g = parseGranularity({ trackers: { readCadence: "daily", chartGranularity: "every-nanosecond" } });
    expect(g.readCadence).toBe("daily");
    expect(g.chartGranularity).toBe(DEFAULT_GRANULARITY.chartGranularity);
  });

  it("rejects out-of-range retention rather than trusting the blob", () => {
    expect(parseGranularity({ trackers: { retentionDays: 0 } }).retentionDays).toBe(365);
    expect(parseGranularity({ trackers: { retentionDays: 99999 } }).retentionDays).toBe(365);
    expect(parseGranularity({ trackers: { retentionDays: "seven" } }).retentionDays).toBe(365);
  });

  it("survives a blob with no trackers key at all", () => {
    expect(parseGranularity({ nav: ["/campaigns"] })).toEqual(DEFAULT_GRANULARITY);
  });
});

describe("effectiveChartGranularity — never chart finer than you sample", () => {
  it("leaves a chart coarser than the reader alone", () => {
    expect(
      effectiveChartGranularity({ readCadence: "4hourly", chartGranularity: "daily", retentionDays: 365 })
    ).toBe("daily");
  });

  it("clamps hourly charting on a daily reader up to daily", () => {
    // Otherwise: one point per day drawn on an hourly axis, with 23 gaps that
    // look exactly like an outage.
    expect(
      effectiveChartGranularity({ readCadence: "daily", chartGranularity: "hourly", retentionDays: 365 })
    ).toBe("daily");
  });

  it("clamps hourly charting on a 4-hourly reader up to 4-hourly", () => {
    expect(
      effectiveChartGranularity({ readCadence: "4hourly", chartGranularity: "hourly", retentionDays: 365 })
    ).toBe("4hourly");
  });

  it("allows hourly charting only when the reader is hourly", () => {
    expect(
      effectiveChartGranularity({ readCadence: "hourly", chartGranularity: "hourly", retentionDays: 365 })
    ).toBe("hourly");
  });
});

describe("snapshotFetchLimit", () => {
  it("sizes the fetch from cadence, not a flat 60", () => {
    // The old flat take:60 meant ten days at 4-hourly — a year-long chart could
    // not be drawn however much history the database held.
    const yearAt4h = snapshotFetchLimit(DEFAULT_GRANULARITY, 365);
    expect(yearAt4h).toBeGreaterThan(2000);
  });

  it("keeps a floor so short windows still have something to draw", () => {
    expect(snapshotFetchLimit({ ...DEFAULT_GRANULARITY, readCadence: "daily" }, 1)).toBe(60);
  });

  it("caps the fetch so one sound cannot pull the table", () => {
    expect(snapshotFetchLimit({ ...DEFAULT_GRANULARITY, readCadence: "hourly" }, 1095)).toBe(5000);
  });
});

describe("downsample", () => {
  it("keeps the last reading in each bucket, not the mean", () => {
    // usesCount is a level. The close of a day was really observed; an average
    // of six readings was true at no moment.
    const raw = [snap(10, 30), snap(12, 26), snap(15, 25), snap(20, 5), snap(22, 1)];
    const out = downsample(raw, "daily");
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.value)).toEqual([15, 22]);
  });

  it("returns points in ascending time order whatever order it was given", () => {
    const out = downsample([snap(30, 1), snap(10, 50), snap(20, 25)], "daily");
    expect(out.map((s) => s.value)).toEqual([10, 20, 30]);
  });

  it("anchors buckets to epoch so two sounds share gridlines", () => {
    // Same calendar day, read 3 hours apart -> one bucket, not two.
    const a = downsample([snap(5, 20), snap(6, 17)], "daily");
    expect(a).toHaveLength(1);
  });

  it("preserves a decline — the value can go down", () => {
    // Confirmed against CreatorCore, whose velocity axis runs to -10,000.
    const out = downsample([snap(46, 50), snap(45, 26), snap(44, 2)], "daily");
    expect(out.map((s) => s.value)).toEqual([46, 45, 44]);
  });

  it("is empty-safe", () => {
    expect(downsample([], "daily")).toEqual([]);
  });
});

describe("isDueForRead", () => {
  it("treats a never-read sound as due", () => {
    expect(isDueForRead(null, DEFAULT_GRANULARITY, NOW)).toBe(true);
  });

  it("holds a sound read inside its cadence", () => {
    expect(isDueForRead(hoursAgo(1), DEFAULT_GRANULARITY, NOW)).toBe(false);
  });

  it("releases it once the cadence has elapsed", () => {
    expect(isDueForRead(hoursAgo(4), DEFAULT_GRANULARITY, NOW)).toBe(true);
  });

  it("tolerates a timer that fires slightly early", () => {
    // Without slack, a timer firing 2 minutes early defers every sound a whole
    // cycle — a 4-hourly reader silently becomes 8-hourly.
    expect(isDueForRead(hoursAgo(3.98), DEFAULT_GRANULARITY, NOW)).toBe(true);
  });

  it("respects an hourly cadence", () => {
    const g = { ...DEFAULT_GRANULARITY, readCadence: "hourly" as const };
    expect(isDueForRead(hoursAgo(0.5), g, NOW)).toBe(false);
    expect(isDueForRead(hoursAgo(1), g, NOW)).toBe(true);
  });
});
