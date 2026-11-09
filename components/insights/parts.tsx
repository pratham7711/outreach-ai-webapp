"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { formatCount } from "@/components/portal/app/ui";

/**
 * The pieces a stats screen is built from, shared by the creator's My stats
 * and the Instagram insights the agency's creator page shows, so the two read
 * as one vocabulary: a strip of headline figures, a section heading that names
 * its window, a 100% bar for a split, a toggle, a row of per-post counters,
 * and a cover. Colours are --cc-* tokens only; every number is set in tabular
 * figures so columns of them line up digit for digit.
 */

export const NUM = { fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" } as const;

export const muted = { fontSize: 13, color: "var(--cc-text-muted)", margin: 0, lineHeight: 1.5 } as const;

/** 0.079 → "7.9%"; a share under 10% keeps one decimal, above it none. */
export function formatPercent(ratio: number): string {
  const pct = ratio * 100;
  return `${pct < 10 ? pct.toFixed(1).replace(/\.0$/, "") : Math.round(pct)}%`;
}

/** 2.14 → "2.1×", 12.6 → "13×". */
export function formatTimes(ratio: number): string {
  return `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1).replace(/\.0$/, "")}×`;
}

export type Figure = {
  label: string;
  value: number | null | undefined;
  /** Written in place of the number when the figure is a ratio or a rate. */
  display?: string;
  /** One line of context under the number: its comparison or how it was made. */
  note?: ReactNode;
  /** Shown on hover: how the figure is computed. */
  hint?: string;
};

/** The figures the platform actually returned. One it did not is left out,
    never drawn as an empty tile. */
export function measured(figures: Figure[]): Figure[] {
  return figures.filter((f) => f.display !== undefined || typeof f.value === "number");
}

const STRIP_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
};

/**
 * The few figures a section leads with, side by side and ruled apart by
 * hairlines: four across a desktop, two by two on a phone. Each says what it
 * is compared with underneath, so no number stands alone without a window.
 */
export function FigureStrip({ figures: all, missing }: { figures: Figure[]; missing?: (labels: string[]) => ReactNode }) {
  const figures = measured(all);
  const left = all.filter((f) => !figures.includes(f)).map((f) => f.label);
  if (figures.length === 0) return missing && left.length > 0 ? <p style={{ ...muted, fontSize: 13 }}>{missing(left)}</p> : null;
  return (
    <>
    <dl
      className={`grid ${STRIP_COLUMNS[figures.length] ?? "grid-cols-2 md:grid-cols-3"}`}
      style={{ gap: 1, margin: 0, background: "var(--cc-border)", border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden" }}
    >
      {figures.map((f) => (
        <div key={f.label} title={f.hint} style={{ background: "var(--cc-card)", padding: "14px 16px 16px", minWidth: 0 }}>
          <dt style={{ fontSize: 13, color: "var(--cc-text-muted)", lineHeight: 1.35 }}>{f.label}</dt>
          <dd style={{ margin: "6px 0 0" }}>
            <span style={{ ...NUM, display: "block", fontSize: "clamp(22px, 2.4vw, 28px)", fontWeight: 700, color: "var(--cc-text)", lineHeight: 1.1 }}>
              {f.display ?? formatCount(f.value)}
            </span>
            {f.note && (
              <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-muted)", lineHeight: 1.4, marginTop: 6 }}>{f.note}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
    {missing && left.length > 0 && <p style={{ ...muted, fontSize: 12, marginTop: 8 }}>{missing(left)}</p>}
    </>
  );
}

/** "Views and reach", "Views, reach and saves". */
export function listWords(words: string[]): string {
  const w = words.map((x, i) => (i === 0 ? x : x.toLowerCase()));
  return w.length <= 1 ? w.join("") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
}

/** A section's heading with what it covers on the right: its window or source. */
export function SectionHeading({ title, aside, id, level = 3 }: { title: ReactNode; aside?: ReactNode; id?: string; level?: 2 | 3 }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "4px 12px", flexWrap: "wrap", marginBottom: 14 }}>
      <H id={id} style={{ fontSize: level === 2 ? 17 : 15, fontWeight: 700, color: "var(--cc-text)", margin: 0, lineHeight: 1.3 }}>
        {title}
      </H>
      {aside && <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{aside}</span>}
    </div>
  );
}

/** A card-level block on the dashboard's grid. One level deep: nothing inside it is boxed again. */
export function Panel({ children, labelledBy, style }: { children: ReactNode; labelledBy?: string; style?: CSSProperties }) {
  return (
    <section
      aria-labelledby={labelledBy}
      style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-r-card)", padding: "var(--cc-card-inset)", minWidth: 0, ...style }}
    >
      {children}
    </section>
  );
}

/**
 * A small set of mutually exclusive views, as pressed buttons: the app's
 * segmented control at the compact height, so a switch in a card header is the
 * same control as the date range in a page header -- one framed row, the
 * chosen option in the ink tint, one weight for both states.
 */
export function Toggle<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="cc-segmented cc-segmented-sm">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className="cc-segmented-btn"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type Segment = { key: string; label: string; value: number; color: string };

/**
 * A split of one whole, as a single bar with a legend that carries every
 * figure in words, so the colours only reinforce what the text already says.
 * Segments too thin to see still keep their legend entry.
 */
export function SplitBar({ segments, label, valueFormat = "percent" }: { segments: Segment[]; label: string; valueFormat?: "percent" | "count" }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;
  return (
    <figure style={{ margin: 0 }}>
      <div role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${formatPercent(s.value / total)}`).join(", ")}`} style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", gap: 2, background: "var(--cc-card)" }}>
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <span key={s.key} style={{ flex: `${s.value} 0 0`, minWidth: 3, background: s.color }} />
          ))}
      </div>
      <figcaption>
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: "8px 18px" }}>
          {segments.map((s) => (
            <li key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--cc-text)", whiteSpace: "nowrap" }}>
              <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
              {s.label}
              <strong style={{ ...NUM, fontWeight: 700 }}>{valueFormat === "count" ? formatCount(s.value) : formatPercent(s.value / total)}</strong>
              {valueFormat === "count" && <span style={{ ...NUM, color: "var(--cc-text-muted)" }}>{formatPercent(s.value / total)}</span>}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

/** Ranked rows with a bar each, largest first: top countries. */
export function RankBars({ rows }: { rows: Array<{ key: string; label: string; share: number }> }) {
  const top = Math.max(...rows.map((r) => r.share), 0.0001);
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => (
        <li key={r.key} style={{ display: "grid", gridTemplateColumns: "minmax(0, 7.5rem) 1fr auto", alignItems: "center", gap: 10, fontSize: 13, color: "var(--cc-text)" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <span aria-hidden="true" style={{ height: 8, borderRadius: 4, background: "var(--cc-hover-bg)", overflow: "hidden" }}>
            <span style={{ display: "block", width: `${(r.share / top) * 100}%`, height: "100%", borderRadius: 4, background: "var(--cc-primary)" }} />
          </span>
          <span style={{ ...NUM, fontWeight: 700, minWidth: 36, textAlign: "right" }}>{formatPercent(r.share)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Bands in their own order with a column each: age groups, youngest first. */
export function ColumnBars({ rows, label }: { rows: Array<{ key: string; label: string; share: number }>; label: string }) {
  const top = Math.max(...rows.map((r) => r.share), 0.0001);
  return (
    <div role="img" aria-label={`${label}: ${rows.map((r) => `${r.label} ${formatPercent(r.share)}`).join(", ")}`}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`, alignItems: "end", gap: 6, height: 112 }}>
        {rows.map((r) => (
          <div key={r.key} style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%", minWidth: 0 }}>
            <span style={{ ...NUM, fontSize: 12, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>{formatPercent(r.share)}</span>
            <span style={{ width: "100%", maxWidth: 34, height: `${Math.max(2, (r.share / top) * 78)}px`, borderRadius: "5px 5px 2px 2px", background: "var(--cc-primary)" }} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`, gap: 6, marginTop: 6, borderTop: "1px solid var(--cc-border)", paddingTop: 6 }}>
        {rows.map((r) => (
          <span key={r.key} style={{ fontSize: 12, color: "var(--cc-text-muted)", textAlign: "center", whiteSpace: "nowrap" }}>
            {r.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * A post's counters as a row of small labelled cells. Every row of a list gets
 * the same columns, so they line up down the list; a column the post has no
 * figure for is left blank rather than written as a dash, so a platform that
 * never reports it does not look broken.
 */
export type Cell = { label: string; value: number | null | undefined; blank?: boolean };

export function MetricCells({ cells }: { cells: Cell[] }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {cells.map((c) => (
        <div key={c.label} style={{ minWidth: 56, textAlign: "right" }} aria-hidden={c.blank || undefined}>
          {!c.blank && (
            <>
              <div style={{ ...NUM, fontSize: 14, fontWeight: 700, color: "var(--cc-text)", lineHeight: 1.3 }}>{formatCount(c.value)}</div>
              <div style={{ fontSize: 12, color: "var(--cc-text-muted)", lineHeight: 1.3 }}>{c.label}</div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** A post's cover. Platform image URLs are signed and expire, so a dead one
    becomes `fallback` (or a plain tile) rather than a broken image. */
export function Thumb({
  src,
  width = 44,
  height = 44,
  radius = 8,
  fallback,
  fill = false,
}: {
  src: string | null;
  width?: number;
  height?: number;
  radius?: number;
  fallback?: ReactNode;
  /** Fill the parent box instead of a fixed size. */
  fill?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const box = fill
    ? ({ position: "absolute", inset: 0, width: "100%", height: "100%", borderRadius: radius, background: "var(--cc-hover-bg)" } as const)
    : ({ width, height, borderRadius: radius, flexShrink: 0, background: "var(--cc-hover-bg)", border: "1px solid var(--cc-border)" } as const);
  if (!src || broken)
    return (
      <span aria-hidden="true" style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--cc-text-muted)" }}>
        {fallback}
      </span>
    );
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img src={src} alt="" width={fill ? undefined : width} height={fill ? undefined : height} loading="lazy" onError={() => setBroken(true)} style={{ ...box, objectFit: "cover", display: "block" }} />
  );
}
