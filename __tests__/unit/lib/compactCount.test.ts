import { compactCount, formatCompactCount } from "@/lib/format";

describe("compactCount", () => {
  it("shortens a grouped count from 10,000 up", () => {
    expect(compactCount("268,036")).toEqual({ short: "268K", exact: "268,036" });
    expect(compactCount("1,823,228,537")?.short).toBe("1.8B");
  });
  it("leaves money, percentages, small counts and words alone", () => {
    for (const t of ["$10,000", "9.59%", "9,999", "72", "—", "1,500 views"]) expect(compactCount(t)).toBeNull();
  });
  it("formatCompactCount switches at the same threshold", () => {
    expect(formatCompactCount(9_999)).toBe("9,999");
    expect(formatCompactCount(268_036)).toBe("268K");
  });
});
