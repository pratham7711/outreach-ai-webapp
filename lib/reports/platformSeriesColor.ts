/**
 * One colour per platform for the campaign Performance tab's views chart and
 * the pie beside it.
 *
 * Both used platformColor, which hands out the theme's --chart-N series tokens.
 * The light and dark themes define those as a grey ramp and tell series apart
 * by dash pattern, so a stacked chart of TikTok, Instagram and YouTube drew
 * three near-identical greys and the pie three grey slices. The client report
 * already coloured each platform by its brand (lib/reports/shareChartPalette)
 * and read fine; this is the same idea expressed in the app's own tokens, so it
 * follows the theme:
 *
 *   - Instagram, YouTube and X/Twitter take --cc-brand-*, which no theme
 *     re-points.
 *   - TikTok's brand is black, which disappears on the dark theme's card, so
 *     it takes the theme's ink (--cc-text): black on light, white on dark --
 *     both TikTok's own colours.
 *   - Any other platform keeps the caller's fallback -- platformColor's series
 *     token, as before. Passed in rather than imported, so lib/ does not reach
 *     into app/.
 *
 * `solid` says the colour alone identifies the series, so the chart can switch
 * off the theme's dash pattern for it (it reached the client report as a dotted
 * line along the top of the stack).
 */
const OWN_COLOR: Record<string, string> = {
  TIKTOK: "var(--cc-text)",
  INSTAGRAM: "var(--cc-brand-instagram)",
  YOUTUBE: "var(--cc-brand-youtube)",
  TWITTER: "var(--cc-brand-twitter)",
  X: "var(--cc-brand-twitter)",
};

export function platformSeriesColor(platform: string, fallback: string): { color: string; solid: boolean } {
  const own = OWN_COLOR[platform.toUpperCase()];
  return own ? { color: own, solid: true } : { color: fallback, solid: false };
}
