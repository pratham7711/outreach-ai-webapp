import { formatCompact } from "@/lib/format";
import { PLATFORM_FILTER_OPTIONS } from "@/lib/platforms/constants";

export function formatNumber(n: number): string {
  return formatCompact(n);
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function formatPercent(rate: number): string {
  return (rate * 100).toFixed(1) + "%";
}

export const RANGE_PRESETS = [
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
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

export const PLATFORM_PALETTE: Record<string, string> = {
  TIKTOK: "var(--chart-1)",
  INSTAGRAM: "var(--chart-2)",
  YOUTUBE: "var(--chart-3)",
  TWITTER: "var(--chart-4)",
  X: "var(--chart-4)",
  LINKEDIN: "var(--chart-5)",
  SNAPCHAT: "var(--chart-2)",
};

const PLATFORM_FALLBACK = SERIES_COLORS;

export function platformColor(platform: string | null | undefined, index = 0): string {
  const key = (platform ?? "").toUpperCase();
  return PLATFORM_PALETTE[key] ?? PLATFORM_FALLBACK[index % PLATFORM_FALLBACK.length];
}
