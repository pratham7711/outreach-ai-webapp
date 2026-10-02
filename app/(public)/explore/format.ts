import type { PlatformRate } from "@/lib/marketplace/public";
import { formatFull } from "@/lib/format";

export const PLATFORM_META: Record<string, { label: string; bg: string; color: string }> = {
  TIKTOK: { label: "TikTok", bg: "var(--cc-accent-bg)", color: "var(--cc-accent-fg)" },
  INSTAGRAM: { label: "Instagram", bg: "color-mix(in srgb, var(--cc-brand-instagram) 8%, transparent)", color: "var(--cc-brand-instagram)" },
  YOUTUBE: { label: "YouTube", bg: "var(--cc-danger-bg)", color: "var(--cc-danger-fg)" },
  TWITTER: { label: "Twitter", bg: "color-mix(in srgb, var(--cc-info) 8%, transparent)", color: "var(--cc-info)" },
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
  return formatFull(n);
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
