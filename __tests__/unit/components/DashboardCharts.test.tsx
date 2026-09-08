/* DashboardCharts imports the ds barrel, which pulls in @pratham7711/ui — an
   ESM-only package jest cannot resolve. Same virtual mock the other ds suites
   use; none of it is exercised here. */
jest.mock("@pratham7711/ui", () => ({}), { virtual: true });

import { truncateCategoryTick } from "@/app/(dashboard)/dashboard/DashboardCharts";

/**
 * Recharts category ticks do not ellipsize — a long campaign title on
 * ViewsByCampaignBar's y-axis was clipped mid-word with nothing to recover it
 * from. The tick renderer truncates explicitly and carries the full title in an
 * SVG <title>; this covers the truncation half.
 */
describe("truncateCategoryTick", () => {
  it("leaves a title that fits alone", () => {
    expect(truncateCategoryTick("Summer Drop", 13)).toBe("Summer Drop");
    // Exactly at the budget is still untouched.
    expect(truncateCategoryTick("Summer Drop!!", 13)).toBe("Summer Drop!!");
  });

  it("ellipsizes a title that does not, within the budget", () => {
    const out = truncateCategoryTick("Q4 Holiday Sound Activation", 13);
    expect(out).toBe("Q4 Holiday S…");
    expect(out).toHaveLength(13);
  });

  it("does not leave a space hanging before the ellipsis", () => {
    expect(truncateCategoryTick("Autumn  campaign", 8)).toBe("Autumn…");
  });

  it("handles an empty title", () => {
    expect(truncateCategoryTick("", 13)).toBe("");
  });
});
