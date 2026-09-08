import { AlertTriangle } from "lucide-react";
import { removedPostLabel, removedSince } from "@/lib/postRemoval";
import type { LastFetchNote } from "@/lib/metricDisplay";

/**
 * The "this post is gone" pill, in the two places it has to sit.
 *
 * CreatorCore puts a warning pill across the top of the thumbnail and leaves
 * every number on the card exactly as it was, which is the behaviour worth
 * copying: the views were earned, the post is what disappeared. So this marks
 * the artwork and nothing else — no dimming, no blanking, no zeroes.
 *
 * `overlay` is absolutely positioned and expects a positioned ancestor (the
 * grid card, the shared report's thumbnail box). `inline` is the same pill in
 * normal flow, for the list row and the post header where there is no image to
 * sit on.
 *
 * The timestamp lives in `title`/`aria-label` rather than in the visible text
 * because the pill has to fit a 240px card, and because "Last checked 3d ago"
 * is the follow-up question, not the headline.
 */
export default function RemovedPostOverlay({
  note,
  variant = "overlay",
  compact = false,
}: {
  /** The `__lastFetch` note, when the caller has it. Only its `at` is used. */
  note?: LastFetchNote | null;
  variant?: "overlay" | "inline";
  /** Smaller type for the dense list row, where the full sentence wrapped to
      three lines inside the status column. The visible text drops to the noun
      phrase ("Post unavailable"); the full sentence stays in title/aria, so the
      finding reads the same everywhere and hover shows the rest. */
  compact?: boolean;
}) {
  const label = removedPostLabel();
  const since = removedSince(note);
  const description = since ? `${label}. ${since}.` : label;
  const visible = compact ? label.split(" — ")[0] : label;

  return (
    <span
      // Relative time against the client clock: the server renders one minute
      // and the browser can hydrate into the next, which React reports as a
      // mismatch. Same reason SharedPostList suppresses it on "Last updated".
      suppressHydrationWarning
      role="status"
      title={description}
      aria-label={description}
      style={{
        ...(variant === "overlay"
          ? { position: "absolute" as const, top: 38, left: 10, right: 10 }
          : { position: "static" as const }),
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: compact ? "2px 7px" : "5px 9px",
        borderRadius: 8,
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        lineHeight: 1.35,
        textAlign: "left",
        whiteSpace: compact ? "nowrap" : "normal",
        // The house warning treatment: the status token plus a tint mixed from
        // it, so all three themes re-colour this with the rest of the palette.
        color: "var(--cc-warning)",
        background: "color-mix(in srgb, var(--cc-warning) 16%, var(--cc-card))",
        border: "1px solid color-mix(in srgb, var(--cc-warning) 45%, transparent)",
      }}
    >
      <AlertTriangle size={compact ? 11 : 13} aria-hidden="true" style={{ flexShrink: 0 }} />
      {visible}
    </span>
  );
}
