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

/**
 * The full number, grouped: 300500000 -> "300,500,000".
 *
 * This is the default for any figure a person is meant to READ as a quantity --
 * post views, campaign totals, follower counts. Compact notation rounds, and a
 * rounded number is the wrong thing to show someone reconciling a payout or
 * comparing two posts: "1.4M" is any of 1,350,000 to 1,449,999, and two posts
 * that both read "1.4M" can be eighty thousand views apart.
 *
 * formatCompact still exists and is still correct for chart AXIS TICKS, where
 * the label has a fixed few characters of room and the precision is carried by
 * the tooltip instead.
 */
export function formatFull(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

/** formatFull's currency twin, for the same reason. */
export function formatFullCurrency(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

/**
 * Font size for a figure that must fit a fixed-width tile.
 *
 * A bold tabular digit costs about 0.6em and a group separator about 0.3em, so
 * "300,500,000" is roughly 6.0em wide and "$1,135,602,774" roughly 7.4em. Tiles
 * across this app were sized when these read "1.4M", so at the base size the
 * full figure runs past the card -- and it cannot wrap, because CSS finds no
 * break opportunity inside a comma-grouped number.
 *
 * Stepping the size down by length keeps the whole figure visible, which is the
 * entire point of showing it in full.
 */
export function fitFigureSize(text: string, base: number): number {
  const n = text.length;
  /* Calibrated against a rendered 6-across tile grid at 1440px, where each
     tile has ~128px of inner width: "8,601,712" is nine characters and 4.8em,
     which is 134px at 28px and was being ellipsised. Nine is where stepping
     has to start, not ten. */
  if (n >= 15) return Math.round(base * 0.55);
  if (n >= 12) return Math.round(base * 0.66);
  if (n >= 9) return Math.round(base * 0.78);
  return base;
}

export type ParsedCount =
  | { ok: true; value: number | undefined }
  | { ok: false; error: string };

export const COUNT_INPUT_ERROR =
  'Enter a whole number of people — "2.4m", "890k" and "1,200,000" all work.';

/**
 * The inverse of formatCompact, for a field a human types into.
 *
 * Follower counts are read off a profile page, where they are already written
 * as "2.4M" — so that is what gets pasted in. `Number("2.4m")` is NaN, which
 * JSON.stringify turns into `null`, which the route's `z.number().int()`
 * rejects with a 400 the modal used to swallow whole: the button simply did
 * nothing. Parsing here means the form either sends an integer or says why it
 * cannot.
 *
 * Blank is not an error — both fields are optional — and comes back as
 * `undefined` so the caller can omit the key rather than send a zero it was
 * never given.
 */
export function parseCountInput(raw: string): ParsedCount {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: undefined };

  // Thousands separators and the spaces people leave before a suffix.
  const cleaned = trimmed.replace(/[,\s_]/g, "");
  const match = /^(\d+(?:\.\d+)?)([kmb])?$/i.exec(cleaned);
  if (!match) return { ok: false, error: COUNT_INPUT_ERROR };

  const multiplier = { k: 1e3, m: 1e6, b: 1e9 }[match[2]?.toLowerCase() ?? ""] ?? 1;
  const value = Math.round(Number(match[1]) * multiplier);
  if (!Number.isSafeInteger(value)) return { ok: false, error: COUNT_INPUT_ERROR };

  return { ok: true, value };
}

export function formatCompactCurrency(n: number, currency = "USD"): string {
  // Zero in the caller's currency, not a hardcoded "$0": the whole point of the
  // currency argument is that this function is not USD-only.
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
    trailingZeroDisplay: "stripIfInteger",
  }).format(Number.isFinite(n) ? n : 0);
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
