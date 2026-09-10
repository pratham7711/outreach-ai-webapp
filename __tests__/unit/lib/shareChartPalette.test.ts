/**
 * @jest-environment node
 *
 * The shared report's chart is greyscale because the reference's is, and these
 * pin the palette that was measured off it. A later edit that reintroduces a
 * brand colour here changes what a brand sees on a document the agency sends
 * them, so it should have to delete a test to do it.
 */
import { CHART_GREYS, CHART_SEPARATOR, chartGreysFor, chartStrokeFor } from "@/lib/reports/shareChartPalette";

it("holds the greys sampled off the reference chart", () => {
  // #000000 over #1C1C1C with a #535353 separator is what the pixel scan found.
  expect(CHART_GREYS).toContain("#000000");
  expect(CHART_GREYS).toContain("#1C1C1C");
  expect(CHART_GREYS).toContain("#535353");
  expect(CHART_SEPARATOR).toBe("#535353");
});

it("carries no hue at all", () => {
  // A grey has equal channels; anything else is a brand colour that crept back.
  for (const hex of CHART_GREYS) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect([g, b]).toEqual([r, r]);
  }
});

it("reproduces the reference's own two-band chart exactly", () => {
  // Bottom band then top band, the order the areas are stacked in.
  expect(chartGreysFor(2)).toEqual(["#1C1C1C", "#000000"]);
});

it("puts black on top whatever the series count", () => {
  for (const n of [1, 2, 3, 4, 6]) {
    expect(chartGreysFor(n).at(-1)).toBe("#000000");
    expect(chartGreysFor(n)).toHaveLength(n);
  }
});

it("pads rather than running out when a campaign has more platforms than steps", () => {
  const six = chartGreysFor(6);
  expect(six.every((c) => typeof c === "string" && c.startsWith("#"))).toBe(true);
  // Still darkest-last, so the stack reads the same way.
  expect(six.at(-1)).toBe("#000000");
  expect(six[0]).toBe(CHART_GREYS[0]);
});

it("returns nothing for no series", () => {
  expect(chartGreysFor(0)).toEqual([]);
});

/* The measurement is what picks the exception: the internal boundary carries a
   light separator, while the top of the stack meets the card ground going
   straight from nothing to black with no lighter line above it. */
it("separates the internal bands but not the top of the stack", () => {
  expect(chartStrokeFor(0, 2)).toBe("#535353");
  expect(chartStrokeFor(1, 2)).toBe("#000000");
});

it("strokes a lone band with its own fill", () => {
  expect(chartStrokeFor(0, 1)).toBe("#000000");
});
