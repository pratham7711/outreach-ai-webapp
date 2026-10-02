import React from "react";
import {
  ageMs,
  formatAge,
  formatAsOf,
  isStale,
  type AgeContext,
  type AgeField,
} from "@/lib/dataAge";

export type AgeLabelProps = {
  /** When the figure beside this was measured. Null or missing means never. */
  at: string | Date | null | undefined;
  /** What kind of figure it is, which decides when it goes stale. */
  field: AgeField;
  ctx?: AgeContext;
  /** Where the figure came from, for the tooltip: "TikTok profile page". */
  source?: string | null;
  /** What to say when there is no time. Null renders nothing at all. */
  never?: string | null;
  /** Word before the age: "read 3h ago". */
  prefix?: string;
  /** The clock to measure against; defaults to now. Tests pass one. */
  now?: Date;
  style?: React.CSSProperties;
};

/**
 * A figure's age, as small muted text beside it: "3h ago", or "Stale · 3d ago"
 * once it is past twice its target cadence (lib/dataAge).
 *
 * Server- and client-safe: no hooks, so a server-rendered page can print it
 * and a client table can too. The age is relative to the clock it is rendered
 * against, so a server render and the hydrating browser can straddle a minute
 * -- the same reason RemovedPostOverlay suppresses the warning on its own
 * relative time.
 *
 * The absolute time and the source sit in the tooltip and in visually hidden
 * text, so a screen reader hears "read 2 Oct 2026, 14:05 UTC" rather than an
 * age with no anchor.
 */
export function AgeLabel({ at, field, ctx, source, never = "not read yet", prefix, now, style }: AgeLabelProps) {
  const clock = now ?? new Date();
  const age = formatAge(at, clock);

  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: "var(--cc-t-11)",
    fontWeight: 400,
    lineHeight: 1.3,
    color: "var(--cc-text-muted)",
    whiteSpace: "nowrap",
    ...style,
  };

  if (age === null) {
    if (never === null) return null;
    /* A time that exists but would not parse, or sits in the future, is not
       "never read" -- it is a time we will not vouch for. */
    const words = at && ageMs(at, clock) === null ? "time unknown" : never;
    return (
      <span data-age="none" title={source ? `${words} · ${source}` : undefined} style={base}>
        {words}
      </span>
    );
  }

  const stale = isStale(at, field, ctx, clock);
  const absolute = formatAsOf(at);
  const description = [`${prefix ? `${prefix} ` : "Read "}${absolute}`, source, stale ? "older than it should be" : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      suppressHydrationWarning
      data-age={stale ? "stale" : "fresh"}
      title={description}
      style={base}
    >
      {stale && (
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "0 5px",
            borderRadius: 6,
            fontSize: "var(--cc-t-10)",
            fontWeight: "var(--cc-fw-strong)",
            lineHeight: 1.5,
            // The house warning treatment (RemovedPostOverlay): the status
            // token over a tint mixed from it, so every theme re-colours it.
            color: "var(--cc-warning)",
            background: "color-mix(in srgb, var(--cc-warning) 16%, var(--cc-card))",
            border: "1px solid color-mix(in srgb, var(--cc-warning) 45%, transparent)",
          }}
        >
          Stale
        </span>
      )}
      <span aria-hidden="true" suppressHydrationWarning>
        {prefix ? `${prefix} ${age.toLowerCase()}` : age}
      </span>
      <span className="sr-only" suppressHydrationWarning>
        {stale ? "Stale. " : ""}
        {description}
      </span>
    </span>
  );
}
