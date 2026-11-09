import { formatFull } from "@/lib/format";
import { PLATFORM_FILTER_OPTIONS } from "@/lib/platforms/constants";

export function formatNumber(n: number): string {
  return formatFull(n);
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function formatPercent(rate: number): string {
  return (rate * 100).toFixed(1) + "%";
}

export const RANGE_PRESETS = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "all", label: "All" },
];

export const PLATFORM_FILTERS = PLATFORM_FILTER_OPTIONS;

export function rangeToFrom(range: string): string | null {
  const days: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
  const d = days[range];
  if (!d) return null;
  const from = new Date();
  from.setDate(from.getDate() - d);
  return from.toISOString();
}

export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/* The platform hues (--cc-cat-*, app/globals.css). They are the chart ramp in
   the coloured themes, and real hues in the black-and-white ones, where the
   ramp is five greys and a platform split read as one ring. */
export const CATEGORY_COLORS = [
  "var(--cc-cat-1)",
  "var(--cc-cat-2)",
  "var(--cc-cat-3)",
  "var(--cc-cat-4)",
  "var(--cc-cat-5)",
];

export const PLATFORM_PALETTE: Record<string, string> = {
  TIKTOK: CATEGORY_COLORS[0],
  INSTAGRAM: CATEGORY_COLORS[1],
  YOUTUBE: CATEGORY_COLORS[2],
  TWITTER: CATEGORY_COLORS[3],
  X: CATEGORY_COLORS[3],
  LINKEDIN: CATEGORY_COLORS[4],
  SNAPCHAT: CATEGORY_COLORS[1],
};

const PLATFORM_FALLBACK = CATEGORY_COLORS;

export function platformColor(platform: string | null | undefined, index = 0): string {
  const key = (platform ?? "").toUpperCase();
  return PLATFORM_PALETTE[key] ?? PLATFORM_FALLBACK[index % PLATFORM_FALLBACK.length];
}

/**
 * One colour per slice for slices drawn side by side, none repeated.
 *
 * platformColor alone can hand two neighbours the same colour: Instagram and
 * Snapchat share --chart-2, and an unmapped platform's index fallback can land
 * on a mapped one's (the third slice falls back to --chart-3, YouTube's). On a
 * donut that reads as one slice. Each platform keeps its own colour when it is
 * free, so the common case is unchanged; a repeat takes the first platform
 * hue nobody has used yet.
 */
export function distinctPlatformColors(platforms: (string | null | undefined)[]): string[] {
  const taken = new Set<string>();
  return platforms.map((platform, i) => {
    let color = platformColor(platform, i);
    if (taken.has(color)) color = CATEGORY_COLORS.find((c) => !taken.has(c)) ?? color;
    taken.add(color);
    return color;
  });
}
