/**
 * Whether a platform's colour alone identifies its series on the campaign
 * Performance tab's views chart and the pie beside it.
 *
 * Both used platformColor, which in the light and dark themes handed out a grey
 * ramp told apart by dash pattern, so a stacked chart of TikTok, Instagram and
 * YouTube drew three near-identical greys and the pie three grey slices. This
 * module first fixed that with --cc-brand-* colours; platformColor itself now
 * gives each platform a real hue in every theme (--cc-cat-*, app/globals.css),
 * so the colour is the caller's -- the same one /analytics, the dashboard
 * donut, the campaign Analytics section and the song page use. Brand colours
 * here made one campaign's YouTube red on Performance and orange on Analytics.
 *
 * `solid` says the colour alone identifies the series, so the chart can switch
 * off the theme's dash pattern for it (it reached the client report as a dotted
 * line along the top of the stack). Only the named platforms get it; any other
 * keeps the theme's dashes, since its colour is an index fallback.
 */
const NAMED = new Set(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER", "X"]);

export function platformSeriesColor(platform: string, color: string): { color: string; solid: boolean } {
  return { color, solid: NAMED.has(platform.toUpperCase()) };
}
