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
