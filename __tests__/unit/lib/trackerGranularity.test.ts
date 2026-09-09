import {
  DEFAULT_GRANULARITY,
  READ_CADENCE_HOURS,
  downsample,
  effectiveChartGranularity,
  isDueForRead,
  parseGranularity,
  snapshotFetchLimit,
  readCadenceLabel,
  READ_CADENCES,
} from "@/lib/trackers/granularity";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const snap = (value: number, h: number) => ({ value, recordedAt: hoursAgo(h) });

describe("parseGranularity", () => {
  it("defaults to CreatorCore's shape: daily points, a year of history", () => {
    expect(parseGranularity(null)).toEqual({
      readCadence: "12hourly",
      chartGranularity: "daily",
      retentionDays: 365,
    });
  });

  it("reads a well-formed block", () => {
    expect(
      parseGranularity({ trackers: { readCadence: "6hourly", chartGranularity: "weekly", retentionDays: 90 } })
    ).toEqual({ readCadence: "6hourly", chartGranularity: "weekly", retentionDays: 90 });
  });

  it("coerces a cadence retired on 2026-09-09 instead of honouring it", () => {
    // Rows written before the 6-hour floor still say "hourly" or "4hourly".
    // Narrowing the union is only safe because they land on the default here
    // rather than reaching the reader -- that is what makes the change a code
    // change and not a migration.
    for (const retired of ["hourly", "2hourly", "3hourly", "4hourly"]) {
      expect(parseGranularity({ trackers: { readCadence: retired } }).readCadence).toBe("12hourly");
    }
  });

  it("no longer honours a sub-6h chart bucket either", () => {
    expect(parseGranularity({ trackers: { chartGranularity: "hourly" } }).chartGranularity).toBe("daily");
    expect(parseGranularity({ trackers: { chartGranularity: "4hourly" } }).chartGranularity).toBe("daily");
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
      effectiveChartGranularity({ readCadence: "6hourly", chartGranularity: "daily", retentionDays: 365 })
    ).toBe("daily");
  });

  it("clamps 6-hourly charting on a daily reader up to daily", () => {
    // Otherwise: one point per day drawn on a 6-hourly axis, with three gaps in
    // every four that look exactly like an outage.
    expect(
      effectiveChartGranularity({ readCadence: "daily", chartGranularity: "6hourly", retentionDays: 365 })
    ).toBe("daily");
  });

  it("clamps 6-hourly charting on a 12-hourly reader up to daily", () => {
    // 12-hourly is not itself a chart bucket, so the clamp has to land on the
    // next coarser one that is -- not on the reader's own cadence.
    expect(
      effectiveChartGranularity({ readCadence: "12hourly", chartGranularity: "6hourly", retentionDays: 365 })
    ).toBe("daily");
  });

  it("allows the finest chart bucket only when the reader is at the floor", () => {
    expect(
      effectiveChartGranularity({ readCadence: "6hourly", chartGranularity: "6hourly", retentionDays: 365 })
    ).toBe("6hourly");
  });
});

describe("snapshotFetchLimit", () => {
  it("sizes the fetch from cadence, not a flat 60", () => {
    // The old flat take:60 meant a month at the default cadence — a year-long
    // chart could not be drawn however much history the database held. Stated
    // against the cadence rather than a literal, so retuning the default
    // cannot quietly turn this back into a fixed window.
    const readsInAYear = (365 * 24) / READ_CADENCE_HOURS[DEFAULT_GRANULARITY.readCadence];
    const yearAtDefault = snapshotFetchLimit(DEFAULT_GRANULARITY, 365);
    expect(yearAtDefault).toBeGreaterThanOrEqual(readsInAYear);
  });

  it("keeps a floor so short windows still have something to draw", () => {
    expect(snapshotFetchLimit({ ...DEFAULT_GRANULARITY, readCadence: "daily" }, 1)).toBe(60);
  });

  it("caps the fetch so one sound cannot pull the table", () => {
    expect(snapshotFetchLimit({ ...DEFAULT_GRANULARITY, readCadence: "6hourly" }, 1095)).toBe(5000);
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
    expect(isDueForRead(hoursAgo(12), DEFAULT_GRANULARITY, NOW)).toBe(true);
  });

  it("tolerates a timer that fires slightly early", () => {
    // Without slack, a timer firing 2 minutes early defers every sound a whole
    // cycle — a 12-hourly reader silently becomes daily.
    expect(isDueForRead(hoursAgo(11.98), DEFAULT_GRANULARITY, NOW)).toBe(true);
  });

  it("respects the 6-hourly floor", () => {
    const g = { ...DEFAULT_GRANULARITY, readCadence: "6hourly" as const };
    expect(isDueForRead(hoursAgo(3), g, NOW)).toBe(false);
    expect(isDueForRead(hoursAgo(6), g, NOW)).toBe(true);
  });

  it("has no cadence finer than six hours to offer", () => {
    // The floor is the point of the 2026-09-09 change: nothing is read hourly.
    expect(Math.min(...READ_CADENCES.map((c) => READ_CADENCE_HOURS[c]))).toBe(6);
    expect(READ_CADENCES).not.toContain("hourly");
  });
});

describe("readCadenceLabel", () => {
  it("leaves the one cadence that is already an adverb alone", () => {
    expect(readCadenceLabel("daily")).toBe("daily");
  });

  it("renders an interval cadence as an interval", () => {
    // The stored key is "12hourly", which put "read every 12hourly" on the post
    // detail card. Only the label changed; the key is still the key.
    expect(readCadenceLabel("12hourly")).toBe("every 12h");
    expect(readCadenceLabel("6hourly")).toBe("every 6h");
  });

  it("falls back to the default for anything it does not recognise", () => {
    // It renders API data typed as a bare string, so a stale or hand-edited
    // value must not put "every undefinedh" in front of a user. A cadence
    // retired on 2026-09-09 is exactly such a value, and rows still hold them.
    expect(readCadenceLabel("hourly")).toBe("every 12h");
    expect(readCadenceLabel("4hourly")).toBe("every 12h");
    expect(readCadenceLabel("banana")).toBe("every 12h");
    expect(readCadenceLabel("")).toBe("every 12h");
  });
});
