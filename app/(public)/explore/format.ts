import type { PlatformRate } from "@/lib/marketplace/public";

export const PLATFORM_META: Record<string, { label: string; bg: string; color: string }> = {
  TIKTOK: { label: "TikTok", bg: "#EEF2FF", color: "#4F46E5" },
  INSTAGRAM: { label: "Instagram", bg: "#FDF2F8", color: "#DB2777" },
  YOUTUBE: { label: "YouTube", bg: "#FEF2F2", color: "#DC2626" },
  TWITTER: { label: "Twitter", bg: "#EFF6FF", color: "#2563EB" },
};

export const CAMPAIGN_TYPE_LABEL: Record<string, string> = {
  VIEW_BASED: "Pay per view",
  BUDGET_BASED: "Fixed budget",
  OPEN_COMMUNITY: "Open community",
  PRIVATE_INVITE: "Invite only",
};

export function formatMoney(amount: number, symbol: string): string {
  const rounded = Math.round(amount * 100) / 100;
  const str =
    rounded % 1 === 0
      ? rounded.toLocaleString("en-US")
      : rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol}${str}`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

export function formatDeadline(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

/** "₹1.50 / 1k views" style label for a single platform rate. */
export function rateLabel(rate: PlatformRate, symbol: string): string {
  return `${formatMoney(rate.ratePerThousand, symbol)} / 1k views`;
}
