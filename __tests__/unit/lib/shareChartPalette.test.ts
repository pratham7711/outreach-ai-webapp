/**
 * @jest-environment node
 *
 * The client report's platform colours. Both charts on the report used to take
 * theirs from elsewhere -- the pie from the app's theme tokens (greyscale, and
 * near-white in dark mode), the stack from a grey ramp copied off the reference
 * report -- so a platform was invisible in one and unnamed by colour in the other.
 */
import { bandFillsFor, chartDelta, platformColorsFor } from "@/lib/reports/shareChartPalette";
import { PLATFORM_KEYS } from "@/lib/platforms/registry";

const onWhite = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
};

function subsets(keys: readonly string[], max: number): string[][] {
  const out: string[][] = [];
  const walk = (from: number, acc: string[]) => {
    if (acc.length >= 2) out.push([...acc]);
    if (acc.length === max) return;
    for (let i = from; i < keys.length; i++) walk(i + 1, [...acc, keys[i]]);
  };
  walk(0, []);
  return out;
}

describe("platformColorsFor", () => {
  it("gives each platform its brand colour as fixed hex, not a theme token", () => {
    expect(platformColorsFor(["TIKTOK", "INSTAGRAM"])).toEqual(["#010101", "#E4405F"]);
    for (const c of platformColorsFor(["TIKTOK", "INSTAGRAM", "YOUTUBE", "FACEBOOK"])) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("moves Instagram to its purple beside YouTube's red, whichever has more views", () => {
    // Pink #E4405F and red #FF0000 are 8.2 apart in OKLab: one red band in the stack.
    expect(chartDelta("#E4405F", "#FF0000")).toBeLessThan(15);
    expect(platformColorsFor(["INSTAGRAM", "YOUTUBE", "TIKTOK"])).toEqual(["#833AB4", "#FF0000", "#010101"]);
    expect(platformColorsFor(["TIKTOK", "YOUTUBE", "INSTAGRAM"])).toEqual(["#010101", "#FF0000", "#833AB4"]);
  });

  it("keeps the biggest platform in its own colours when three clash", () => {
    // Instagram's pink is too close to YouTube's red and its purple to Twitch's.
    // A greedy pass greyed Instagram out although it had the most views.
    expect(platformColorsFor(["INSTAGRAM", "YOUTUBE", "TWITCH"])).toEqual(["#833AB4", "#FF0000", "#6E6E6E"]);
  });

  it("keeps every pair apart under normal vision and red-green colour blindness", () => {
    const sets = [
      ["INSTAGRAM", "YOUTUBE", "TIKTOK"],
      ["INSTAGRAM", "SNAPCHAT"],
      ["TIKTOK", "TWITTER", "THREADS"],
      ["FACEBOOK", "LINKEDIN", "TWITCH"],
      ["PINTEREST", "YOUTUBE", "INSTAGRAM"],
      ["INSTAGRAM", "YOUTUBE", "TWITCH", "LINKEDIN"],
      ["YOUTUBE", "TIKTOK", "INSTAGRAM", "FACEBOOK", "TWITTER"],
    ];
    for (const set of sets) {
      const colors = platformColorsFor(set);
      for (let i = 0; i < colors.length; i++) {
        for (let j = i + 1; j < colors.length; j++) {
          expect(chartDelta(colors[i], colors[j])).toBeGreaterThanOrEqual(15);
          expect(chartDelta(colors[i], colors[j], "protan")).toBeGreaterThanOrEqual(8);
          expect(chartDelta(colors[i], colors[j], "deutan")).toBeGreaterThanOrEqual(8);
        }
      }
    }
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

  it("gives Snapchat a readable stand-in when TikTok, X and Threads have used up the greys", () => {
    // Was ["#010101", "#6E6E6E", "#3D3D3D", "#FFFC00"]: Snapchat's yellow at 1.07:1 on the white card.
    const colors = platformColorsFor(["TIKTOK", "TWITTER", "THREADS", "SNAPCHAT"]);
    expect(colors[3]).not.toBe("#FFFC00");
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) expect(chartDelta(colors[i], colors[j])).toBeGreaterThanOrEqual(15);
    }
  });

  it("never draws a slice under 3:1 or repeats a colour, across every set of two to four platforms", () => {
    const sets = subsets(PLATFORM_KEYS, 4);
    expect(sets.length).toBe(375);
    for (const set of sets) {
      const colors = platformColorsFor(set);
      for (const c of colors) expect(onWhite(c)).toBeGreaterThanOrEqual(3);
      expect(new Set(colors).size).toBe(colors.length);
    }
  });

  it("returns one colour per slice, in slice order", () => {
    expect(platformColorsFor([])).toEqual([]);
    expect(platformColorsFor(["YOUTUBE", "TIKTOK"])).toEqual(["#FF0000", "#010101"]);
  });
});

describe("bandFillsFor", () => {
  const apart = (fills: string[]) => {
    for (let i = 0; i < fills.length; i++) {
      for (let j = i + 1; j < fills.length; j++) {
        expect(chartDelta(fills[i], fills[j])).toBeGreaterThanOrEqual(15);
        expect(chartDelta(fills[i], fills[j], "protan")).toBeGreaterThanOrEqual(8);
        expect(chartDelta(fills[i], fills[j], "deutan")).toBeGreaterThanOrEqual(8);
      }
    }
  };

  it("lightens the brand colours toward the white card", () => {
    // Instagram purple, YouTube red, TikTok black at 60%.
    expect(bandFillsFor(["#833AB4", "#FF0000", "#010101"])).toEqual(["#B589D2", "#FF6666", "#676767"]);
  });

  it("lightens less when the lighter step would pull two bands together", () => {
    const colors = platformColorsFor(["INSTAGRAM", "YOUTUBE", "TWITCH"]);
    const fills = bandFillsFor(colors);
    apart(fills);
    // Twitch's grey and Instagram's purple meet at 60%, so this set keeps more colour.
    expect(fills[0]).not.toBe("#B589D2");
    expect(fills).not.toEqual(colors);
  });

  it("keeps every pair apart across mixed platform sets", () => {
    for (const set of [
      ["TIKTOK", "INSTAGRAM"],
      ["INSTAGRAM", "YOUTUBE", "TIKTOK"],
      ["TIKTOK", "YOUTUBE", "FACEBOOK", "TWITTER"],
      ["YOUTUBE", "TWITCH", "TIKTOK"],
    ]) {
      apart(bandFillsFor(platformColorsFor(set)));
    }
  });

  it("returns the colours unchanged when even full strength cannot part them", () => {
    expect(bandFillsFor(["#000000", "#010101"])).toEqual(["#000000", "#010101"]);
  });

  it("returns one fill per colour, in order", () => {
    expect(bandFillsFor([])).toEqual([]);
    expect(bandFillsFor(["#FF0000"])).toEqual(["#FF6666"]);
  });
});
