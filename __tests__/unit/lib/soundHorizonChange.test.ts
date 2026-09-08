/**
 * The audio detail's horizon tiles.
 *
 * The series they read is depth-limited: /api/trackers fetches
 * snapshotFetchLimit rows, 60 by default, which is ten days at the four-hourly
 * cadence. Falling back to series[0] when nothing predates the cutoff therefore
 * printed the SAME ten-day gain under "14-Day Change" and "30-Day Change".
 */
import { changeOver } from "@/app/(dashboard)/trackers/horizonChange";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-01T00:00:00.000Z");

function point(value: number, daysAgo: number) {
  return { value, recordedAt: new Date(NOW - daysAgo * DAY).toISOString() };
}

// Ten days of history, oldest first — what a 60-row fetch holds.
const tenDays = [point(1_000, 10), point(20_000, 5), point(51_000, 0)];

it("measures a horizon the series covers", () => {
  expect(changeOver(tenDays, 7)).toEqual({ added: 50_000, percent: 5_000 });
});

it("refuses a horizon longer than the series instead of borrowing series[0]", () => {
  expect(changeOver(tenDays, 14)).toBe("short-history");
  expect(changeOver(tenDays, 30)).toBe("short-history");
});

it("still says nothing at all when there is only one reading", () => {
  expect(changeOver([point(5, 0)], 1)).toBeNull();
});
