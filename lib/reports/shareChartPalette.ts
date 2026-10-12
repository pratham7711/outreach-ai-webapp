import { platformBrandColor } from "@/lib/platforms/registry";

/**
 * The greyscale the shared client report's stacked area chart is drawn in.
 *
 * Measured off the reference client report's Views/Engagement chart. It is
 * Chart.js on a 596x250 canvas, so there is no SVG to read and the colours were
 * sampled pixel by pixel: a vertical slice at x=150 runs #000000 from y=42 to
 * 123, a two-pixel #535353 separator across 124-127, then #1C1C1C down to 165.
 * Two flat bands, darkest on top, no gradient, and no grid line at any y in any
 * of the three columns scanned. The axis labels came back #AEB9C2, the same
 * grey the reference's audio card spends on its own axes.
 *
 * #535353, #1C1C1C and #000000 are measured. #6E6E6E is interpolated, for a
 * campaign carrying more platforms than the reference report ever showed.
 */
export const CHART_GREYS = ["#6E6E6E", "#535353", "#1C1C1C", "#000000"] as const;

/**
 * The separator drawn at the top edge of every band except the topmost.
 *
 * The measurement is what picks the exception: the internal boundary carries a
 * light #535353 line, while the top of the stack meets the card ground going
 * straight from nothing to #000000, with no lighter line above it.
 */
export const CHART_SEPARATOR = "#535353";

/**
 * One grey per series, ordered as the chart stacks them: the first entry is the
 * bottom band and the last is the top, which is always black.
 *
 * Taking the ramp's tail rather than its head is what keeps that true -- two
 * platforms give #1C1C1C under #000000, reproducing the reference's own chart
 * exactly, rather than the two lightest greys with nothing black at all.
 */
export function chartGreysFor(count: number): string[] {
  if (count <= 0) return [];
  const ramp = CHART_GREYS.slice(Math.max(0, CHART_GREYS.length - count));
  // More series than the ramp has steps: pad from the lightest end.
  const pad = Array.from({ length: Math.max(0, count - ramp.length) }, () => CHART_GREYS[0]);
  return [...pad, ...ramp];
}

/** The stroke for the band at `index` in a stack of `count`. */
export function chartStrokeFor(index: number, count: number): string {
  return index === count - 1 ? chartGreysFor(count)[index] : CHART_SEPARATOR;
}

/**
 * The fills for the report's Views by Platform pie: each platform's brand
 * colour, as fixed hex.
 *
 * They used to be the app's --chart-N tokens, which follow the viewer's theme.
 * Both themes a client can land in are greyscale, and Dark's are light greys
 * for a dark card, so on the report's white card a phone in dark mode drew
 * TikTok at #F5F5F5 (1.09:1) and the slice and its tooltip text disappeared.
 *
 * A brand colour gives way to a grey where it would not read as its own slice:
 * under 3:1 against the white card (Snapchat's yellow), or too close to a
 * colour an earlier slice already took (TikTok's black beside X's).
 */
const PIE_CARD = "#FFFFFF";
const PIE_FALLBACKS = ["#6E6E6E", "#8A8A8A", "#3D3D3D"] as const;
const MIN_SLICE_CONTRAST = 3;
const MIN_SLICE_DISTANCE = 60;

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function distance(a: string, b: string): number {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** One fill per platform, in the order given (the pie's slice order). */
export function pieColorsFor(platforms: string[]): string[] {
  const taken: string[] = [];
  const usable = (hex: string) =>
    contrast(hex, PIE_CARD) >= MIN_SLICE_CONTRAST && taken.every((t) => distance(hex, t) >= MIN_SLICE_DISTANCE);
  for (const platform of platforms) {
    const brand = platformBrandColor(platform).toUpperCase();
    taken.push(usable(brand) ? brand : PIE_FALLBACKS.find(usable) ?? brand);
  }
  return taken;
}
