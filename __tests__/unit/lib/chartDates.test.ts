/**
 * The Performance tab's views chart printed 26 yearless ticks over a series
 * spanning 2010 to 2026, so it read as out of order. These pin the axis that
 * replaced it, and the per-platform colours that replaced three greys.
 */
import { chartDateAxis, evenTicks, sortByDate } from "@/lib/reports/chartDates";
import { platformSeriesColor } from "@/lib/reports/platformSeriesColor";

const days = (from: string, n: number) => {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  return Array.from({ length: n }, (_, i) => ({ date: new Date(start + i * 86_400_000).toISOString().slice(0, 10) }));
};

describe("sortByDate", () => {
  it("puts rows in calendar order without touching the input", () => {
    const rows = [{ date: "2026-10-10" }, { date: "2010-09-01" }, { date: "2018-04-11" }];
    expect(sortByDate(rows).map((r) => r.date)).toEqual(["2010-09-01", "2018-04-11", "2026-10-10"]);
    expect(rows[0].date).toBe("2026-10-10");
  });
});

describe("evenTicks", () => {
  it("keeps a short series whole", () => {
    expect(evenTicks(["a", "b", "c"], 7)).toEqual(["a", "b", "c"]);
  });

  it("caps a long series and keeps both ends", () => {
    const dates = days("2010-09-01", 5_884).map((r) => r.date);
    const ticks = evenTicks(dates, 7);
    expect(ticks).toHaveLength(7);
    expect(ticks[0]).toBe(dates[0]);
    expect(ticks[ticks.length - 1]).toBe(dates[dates.length - 1]);
    expect([...ticks].sort()).toEqual(ticks);
  });
});

describe("chartDateAxis", () => {
  it("leaves the year off a series inside one year", () => {
    const axis = chartDateAxis(days("2026-09-01", 40));
    expect(axis.tick("2026-10-06")).toBe("Oct 6");
    expect(axis.label("2026-10-06")).toBe("Oct 6");
  });

  it("carries the year once the series crosses one", () => {
    const axis = chartDateAxis([{ date: "2026-10-10" }, { date: "2010-09-01" }, { date: "2018-04-11" }]);
    expect(axis.tick("2010-09-01")).toBe("Sep 1 '10");
    expect(axis.tick("2026-10-10")).toBe("Oct 10 '26");
    expect(axis.label("2010-09-01")).toBe("Sep 1, 2010");
    expect(axis.ticks).toEqual(["2010-09-01", "2018-04-11", "2026-10-10"]);
  });

  it("never offers more than seven ticks", () => {
    expect(chartDateAxis(days("2010-09-01", 5_884)).ticks.length).toBeLessThanOrEqual(7);
  });
});

describe("platformSeriesColor", () => {
  it("gives TikTok, Instagram and YouTube three different colours", () => {
    const colors = ["TIKTOK", "INSTAGRAM", "YOUTUBE"].map((p) => platformSeriesColor(p, "var(--chart-1)").color);
    expect(new Set(colors).size).toBe(3);
    for (const c of colors) expect(c).toMatch(/^var\(--cc-/);
  });

  it("draws them solid, since the colour alone tells them apart", () => {
    expect(platformSeriesColor("instagram", "var(--chart-2)").solid).toBe(true);
  });

  it("keeps the caller's series token for a platform with no colour of its own", () => {
    expect(platformSeriesColor("THREADS", "var(--chart-4)")).toEqual({ color: "var(--chart-4)", solid: false });
  });
});
