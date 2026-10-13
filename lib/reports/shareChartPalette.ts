import { platformBrandColor } from "@/lib/platforms/registry";

/**
 * The client report's platform colours: each platform's brand colour, as fixed
 * hex, shared by the Views Over Time stack and the Views by Platform pie so a
 * platform is the same colour in both.
 *
 * The pie used to take the app's --chart-N tokens, which follow the viewer's
 * theme. Both themes a client can land in are greyscale, and Dark's are light
 * greys for a dark card, so on the report's white card a phone in dark mode
 * drew TikTok at #F5F5F5 (1.09:1) and the slice and its tooltip disappeared.
 * The stack beside it was a fixed grey ramp copied from the reference report,
 * which left the two charts encoding the same platforms differently.
 *
 * A brand colour gives way to a grey where it would not read as its own band:
 * under 3:1 against the white card (Snapchat's yellow), or too close to a
 * colour an earlier platform already took (TikTok's black beside X's).
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

/** One colour per platform, in the order given; give the order by views, so the biggest keeps its brand colour. */
export function platformColorsFor(platforms: string[]): string[] {
  const taken: string[] = [];
  const usable = (hex: string) =>
    contrast(hex, PIE_CARD) >= MIN_SLICE_CONTRAST && taken.every((t) => distance(hex, t) >= MIN_SLICE_DISTANCE);
  for (const platform of platforms) {
    const brand = platformBrandColor(platform).toUpperCase();
    taken.push(usable(brand) ? brand : PIE_FALLBACKS.find(usable) ?? brand);
  }
  return taken;
}
