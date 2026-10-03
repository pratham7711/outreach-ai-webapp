/**
 * The audio detail's horizon tiles.
 *
 * The series they read is depth-limited: /api/trackers fetches
 * snapshotFetchLimit rows, 60 by default, which is ten days at the four-hourly
 * cadence. Falling back to series[0] when nothing predates the cutoff therefore
 * printed the SAME ten-day gain under "14-Day Change" and "30-Day Change".
 */
import { changeOver, soundChangeOver } from "@/app/(dashboard)/trackers/horizonChange";

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

describe("soundChangeOver", () => {
  const rounded = (value: number, daysAgo: number) => ({ ...point(value, daysAgo), rounded: true });

  it("reports a change only when both ends are counts", () => {
    expect(soundChangeOver([point(6_921, 7), point(7_429, 0)], 7)).toEqual({ added: 508, percent: expect.closeTo(7.34, 2) });
  });

  /* 73,500 -> 74,100 on a 74K sound is the K-rounding moving, not 600 videos. */
  it("says 'rounded' when either end is a display-rounded figure", () => {
    expect(soundChangeOver([rounded(73_500, 7), rounded(74_100, 0)], 7)).toBe("rounded");
    expect(soundChangeOver([point(8_659, 7), rounded(12_000, 0)], 7)).toBe("rounded");
    expect(soundChangeOver([rounded(12_000, 7), point(12_345, 0)], 7)).toBe("rounded");
  });

  it("keeps changeOver's absences", () => {
    expect(soundChangeOver([rounded(74_100, 0)], 7)).toBeNull();
    expect(soundChangeOver([rounded(74_000, 3), rounded(74_100, 0)], 7)).toBe("short-history");
  });
});
