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
  TWITTER: "Twitter",
  X: "X",
};

export function platformLabel(platform: string | null | undefined): string {
  const p = (platform ?? "").trim();
  if (!p) return "";
  return PLATFORM_LABELS[p.toUpperCase()] ?? p.charAt(0) + p.slice(1).toLowerCase();
}

export function formatDateAbs(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTimeAbs(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}, ${time}`;
}
