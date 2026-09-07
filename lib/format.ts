/**
 * What we print when a number is not known. A measured zero and an unmeasured value
 * look identical once both render as "0", and the second one is a claim we cannot make —
 * a sound tracker that has never been snapshotted is not a sound with no uses.
 */
export const UNKNOWN = "—";

export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
    trailingZeroDisplay: "stripIfInteger",
  }).format(n);
}

export function formatCompactCurrency(n: number, currency = "USD"): string {
  if (!Number.isFinite(n)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
    trailingZeroDisplay: "stripIfInteger",
  }).format(n);
}

export function stripAt(handle: string | null | undefined): string {
  return (handle ?? "").replace(/^@+/, "");
}

export function formatHandle(handle: string | null | undefined): string {
  const h = stripAt(handle);
  return h ? `@${h}` : "";
}

const PLATFORM_LABELS: Record<string, string> = {
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
  // The product is called X; TWITTER is only the stored enum value.
  TWITTER: "X",
  X: "X",
  LINKEDIN: "LinkedIn",
  SNAPCHAT: "Snapchat",
};

export function platformLabel(platform: string | null | undefined): string {
  const p = (platform ?? "").trim();
  if (!p) return "";
  return PLATFORM_LABELS[p.toUpperCase()] ?? p.charAt(0) + p.slice(1).toLowerCase();
}

/**
 * Every date these render is pinned to UTC, and it has to be.
 *
 * Without it the server renders in its own zone and the browser renders in the
 * reader's, and for any instant near midnight those are different days. On the
 * public client report that was a live hydration mismatch: production served
 * "21 Aug 2026" for a post that the browser, five and a half hours ahead,
 * called "22 Aug 2026". It never appeared in development, where the server and
 * the browser are the same machine in the same zone.
 *
 * UTC rather than the reader's zone, because these dates are the campaign's
 * record and not the reader's clock: a report sent to three offices should
 * quote the same day to all three. It is also the zone the rest of the report
 * already speaks -- the views-over-time axis pins UTC, and the series behind it
 * is bucketed by UTC day, so a local-time label would disagree with its own
 * chart.
 */
const UTC_DATE = { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } as const;

export function formatDateAbs(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", UTC_DATE);
}

export function formatDateTimeAbs(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-GB", UTC_DATE);
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${date}, ${time}`;
}

export function timeAgo(iso: string | Date | null | undefined): string {
  // A missing timestamp used to render as "Recently", which is a freshness claim we
  // have no basis for — "Last updated Recently" on a row nobody has touched in a year.
  if (!iso) return UNKNOWN;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return UNKNOWN;
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}
