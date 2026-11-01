/**
 * The Daily / Cumulative conversions every time-series chart uses. The cases
 * that matter are the ones a chart would draw wrongly: a change stated across
 * a gap, a week boundary misread as a gap, a fall hidden, a missing day
 * dropped from a per-day chart.
 */
import {
  bucketChanges,
  fillUtcDays,
  nextBucketBy,
  nextPeriodBy,
  periodIndex,
  periodLabel,
  periodNoun,
  toChanges,
  toRunningTotals,
} from "@/lib/charts/seriesMode";

const HOUR = 3_600_000;

describe("periodIndex", () => {
  it("numbers consecutive days, ISO weeks and months 1 apart", () => {
    expect(periodIndex("2026-03-01")! - periodIndex("2026-02-28")!).toBe(1);
    expect(periodIndex("2026-W10")! - periodIndex("2026-W09")!).toBe(1);
    expect(periodIndex("2026-01")! - periodIndex("2025-12")!).toBe(1);
  });

  it("treats the last ISO week of a 53-week year as adjacent to week 1", () => {
    // 2026 has 53 ISO weeks (it starts on a Thursday); 2025 has 52.
    expect(periodIndex("2027-W01")! - periodIndex("2026-W53")!).toBe(1);
    expect(periodIndex("2026-W01")! - periodIndex("2025-W52")!).toBe(1);
  });

  it("returns null for keys it does not understand", () => {
    expect(periodIndex("Oct 2026")).toBeNull();
    expect(periodIndex("")).toBeNull();
  });
});

describe("periodNoun / periodLabel", () => {
  it("reads the bucket off the key's shape", () => {
    expect(periodNoun("2026-10-30")).toBe("day");
    expect(periodNoun("2026-W44")).toBe("week");
    expect(periodNoun("2026-10")).toBe("month");
    expect(periodNoun(undefined)).toBe("day");
    expect(periodLabel("2026-W44")).toBe("Weekly");
    expect(periodLabel("2026-10")).toBe("Monthly");
    expect(periodLabel("2026-10-30")).toBe("Daily");
  });
});

describe("toChanges", () => {
  const byDate = nextPeriodBy((r: { date: string }) => r.date);

  it("states each day's change from the day before, and nothing for the first day", () => {
    const rows = [
      { date: "2026-10-01", views: 100 },
      { date: "2026-10-02", views: 250 },
      { date: "2026-10-03", views: 300 },
    ];
    expect(toChanges(rows, ["views"], byDate).map((r) => r.views)).toEqual([null, 150, 50]);
  });

  it("leaves a change across a gap null instead of drawing it as one day's spike", () => {
    const rows = [
      { date: "2026-10-01", views: 100 },
      { date: "2026-10-04", views: 400 },
      { date: "2026-10-05", views: 450 },
    ];
    expect(toChanges(rows, ["views"], byDate).map((r) => r.views)).toEqual([null, null, 50]);
  });

  it("keeps a fall as a negative change", () => {
    const rows = [
      { date: "2026-10-01", views: 500 },
      { date: "2026-10-02", views: 420 },
    ];
    expect(toChanges(rows, ["views"], byDate)[1].views).toBe(-80);
  });

  it("leaves a change null when either side is missing, and passes other fields through", () => {
    const rows: { date: string; a: number | null; b: number }[] = [
      { date: "2026-10-01", a: null, b: 1 },
      { date: "2026-10-02", a: 10, b: 3 },
    ];
    expect(toChanges(rows, ["a", "b"], byDate)[1]).toEqual({ date: "2026-10-02", a: null, b: 2 });
  });

  it("treats consecutive ISO weeks as adjacent", () => {
    const rows = [
      { date: "2026-W52", views: 10 },
      { date: "2026-W53", views: 30 },
      { date: "2027-W01", views: 70 },
    ];
    expect(toChanges(rows, ["views"], byDate).map((r) => r.views)).toEqual([null, 20, 40]);
  });
});

describe("toRunningTotals", () => {
  it("sums each key from the first row, carrying across a missing value", () => {
    const rows: { month: string; paid: number | null; pending: number }[] = [
      { month: "2026-08", paid: 100, pending: 5 },
      { month: "2026-09", paid: null, pending: 0 },
      { month: "2026-10", paid: 40, pending: 10 },
    ];
    expect(toRunningTotals(rows, ["paid", "pending"])).toEqual([
      { month: "2026-08", paid: 100, pending: 5 },
      { month: "2026-09", paid: 100, pending: 5 },
      { month: "2026-10", paid: 140, pending: 15 },
    ]);
  });
});

describe("fillUtcDays", () => {
  it("adds the days with no row as empty days, so a per-day chart shows them", () => {
    const rows = [
      { day: "2026-10-28", joins: 2 },
      { day: "2026-10-31", joins: 1 },
    ];
    const filled = fillUtcDays(rows, (r) => r.day, (day) => ({ day, joins: 0 }));
    expect(filled).toEqual([
      { day: "2026-10-28", joins: 2 },
      { day: "2026-10-29", joins: 0 },
      { day: "2026-10-30", joins: 0 },
      { day: "2026-10-31", joins: 1 },
    ]);
  });

  it("crosses a month end", () => {
    const filled = fillUtcDays(
      [{ day: "2026-02-27" }, { day: "2026-03-02" }],
      (r) => r.day,
      (day) => ({ day }),
    );
    expect(filled.map((r) => r.day)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  });

  it("returns the rows unchanged when they cannot be read as days", () => {
    const rows = [{ day: "x" }, { day: "y" }];
    expect(fillUtcDays(rows, (r) => r.day, (day) => ({ day }))).toEqual(rows);
  });
});

describe("nextBucketBy", () => {
  it("is adjacent only for neighbouring buckets", () => {
    const next = nextBucketBy((r: { t: number }) => r.t, 6);
    expect(next({ t: 1 * HOUR }, { t: 7 * HOUR })).toBe(true);
    expect(next({ t: 1 * HOUR }, { t: 5 * HOUR })).toBe(false);
    expect(next({ t: 1 * HOUR }, { t: 13 * HOUR })).toBe(false);
  });
});

describe("bucketChanges", () => {
  const at = (r: { at: number }) => r.at;

  it("takes the last reading in each bucket, minus the last in the bucket before", () => {
    const rows = [
      { at: 1 * HOUR, views: 10 },
      { at: 20 * HOUR, views: 50 },
      { at: 26 * HOUR, views: 70 },
      { at: 47 * HOUR, views: 120 },
    ];
    expect(bucketChanges(rows, at, ["views"], 24)).toEqual([{ t: 24 * HOUR, views: 70 }]);
  });

  it("gives an empty bucket a slot, and no change on either side of it", () => {
    const rows = [
      { at: 1 * HOUR, views: 10 },
      { at: 25 * HOUR, views: 30 },
      { at: 73 * HOUR, views: 90 },
      { at: 97 * HOUR, views: 100 },
    ];
    expect(bucketChanges(rows, at, ["views"], 24)).toEqual([
      { t: 24 * HOUR, views: 20 },
      { t: 48 * HOUR, views: null },
      { t: 72 * HOUR, views: null },
      { t: 96 * HOUR, views: 10 },
    ]);
  });

  it("sorts unsorted readings and keeps a fall as negative", () => {
    const rows = [
      { at: 30 * HOUR, views: 80 },
      { at: 2 * HOUR, views: 100 },
    ];
    expect(bucketChanges(rows, at, ["views"], 24)).toEqual([{ t: 24 * HOUR, views: -20 }]);
  });

  it("returns nothing for fewer than two readings or a non-positive bucket", () => {
    expect(bucketChanges([{ at: HOUR, views: 1 }], at, ["views"], 24)).toEqual([]);
    expect(
      bucketChanges(
        [
          { at: HOUR, views: 1 },
          { at: 30 * HOUR, views: 2 },
        ],
        at,
        ["views"],
        0,
      ),
    ).toEqual([]);
  });

  it("falls back to occupied buckets only past the slot cap", () => {
    const rows = [
      { at: 0, views: 1 },
      { at: 3_000 * HOUR, views: 5 },
      { at: 3_001 * HOUR, views: 9 },
    ];
    // 1h buckets, 3001 apart: past the 2,000-slot cap, so only the three
    // occupied buckets are slots; the first pair is not adjacent.
    expect(bucketChanges(rows, at, ["views"], 1)).toEqual([
      { t: 3_000 * HOUR, views: null },
      { t: 3_001 * HOUR, views: 4 },
    ]);
  });
});
