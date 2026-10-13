import { CATEGORY_COLORS, distinctPlatformColors, platformColor } from "@/app/(dashboard)/analytics/shared";

describe("distinctPlatformColors", () => {
  it("keeps each platform's own colour when nothing collides", () => {
    const platforms = ["TIKTOK", "INSTAGRAM", "YOUTUBE"];
    expect(distinctPlatformColors(platforms)).toEqual(platforms.map((p, i) => platformColor(p, i)));
  });

  it("never hands two slices the same colour", () => {
    // Instagram and Snapchat share a palette entry; an unmapped third falls
    // back by index onto YouTube's.
    const colors = distinctPlatformColors(["INSTAGRAM", "SNAPCHAT", "FACEBOOK", "YOUTUBE"]);
    expect(new Set(colors).size).toBe(4);
    expect(colors[0]).toBe(platformColor("INSTAGRAM"));
    colors.forEach((c) => expect(CATEGORY_COLORS).toContain(c));
  });

  it("draws platforms in the platform hues, not the grey chart ramp", () => {
    // The black-and-white themes' --chart-* are five greys; --cc-cat-* are not.
    for (const p of ["TIKTOK", "INSTAGRAM", "YOUTUBE", "X", "LINKEDIN", "SOMETHING_NEW"]) {
      expect(platformColor(p)).toMatch(/^var\(--cc-cat-[1-5]\)$/);
    }
  });
});
