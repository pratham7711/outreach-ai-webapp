export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
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

export const PLATFORM_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "TIKTOK", label: "TikTok" },
  { key: "INSTAGRAM", label: "Instagram" },
  { key: "YOUTUBE", label: "YouTube" },
];

export function rangeToFrom(range: string): string | null {
  const days: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
  const d = days[range];
  if (!d) return null;
  const from = new Date();
  from.setDate(from.getDate() - d);
  return from.toISOString();
}

export const SERIES_COLORS = ["#5B5BD6", "#E4405F", "#10B981", "#F59E0B", "#06B6D4"];
