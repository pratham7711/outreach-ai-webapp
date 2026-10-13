/**
 * @jest-environment node
 *
 * The client report's platform colours. Both charts on the report used to take
 * theirs from elsewhere -- the pie from the app's theme tokens (greyscale, and
 * near-white in dark mode), the stack from a grey ramp copied off the reference
 * report -- so a platform was invisible in one and unnamed by colour in the other.
 */
import { platformColorsFor } from "@/lib/reports/shareChartPalette";

describe("platformColorsFor", () => {
  it("gives each platform its brand colour as fixed hex, not a theme token", () => {
    expect(platformColorsFor(["TIKTOK", "INSTAGRAM", "YOUTUBE"])).toEqual(["#010101", "#E4405F", "#FF0000"]);
    for (const c of platformColorsFor(["TIKTOK", "INSTAGRAM", "YOUTUBE", "FACEBOOK"])) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("swaps a colour that would vanish into the white card for a grey", () => {
    const [snap] = platformColorsFor(["SNAPCHAT"]);
    expect(snap).not.toBe("#FFFC00");
    expect(snap).toBe("#6E6E6E");
  });

  it("never gives two slices the same colour", () => {
    // TikTok and X are both black in the registry.
    const [tiktok, x] = platformColorsFor(["TIKTOK", "TWITTER"]);
    expect(tiktok).toBe("#010101");
    expect(x).not.toBe("#000000");
    expect(x).not.toBe(tiktok);
  });

  it("returns one colour per slice, in slice order", () => {
    expect(platformColorsFor([])).toEqual([]);
    expect(platformColorsFor(["YOUTUBE", "TIKTOK"])).toEqual(["#FF0000", "#010101"]);
  });
});
