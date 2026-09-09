"use client";

import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

export type SortDir = "asc" | "desc";
export type SortValue = string | number | null | undefined;
export type SortState = { key: string; dir: SortDir };

/** How to read each sortable column out of a row. Define this at module scope so
 *  the memo below actually memoises. */
export type SortAccessors<T> = Record<string, (row: T) => SortValue>;

function compare(a: SortValue, b: SortValue): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  // Unknown values sink to the bottom whichever way the column is pointed. A
  // creator with no follower count is not the least-followed creator, so it must
  // not win "fewest followers" either.
  if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function useTableSort<T>(rows: T[], accessors: SortAccessors<T>, initial: SortState | null = null) {
  const [sort, setSort] = useState<SortState | null>(initial);

  const sorted = useMemo(() => {
    const get = sort && accessors[sort.key];
    if (!get) return rows;
    const sign = sort!.dir === "asc" ? 1 : -1;
    // Empties are pinned by compare(), so they must not be flipped by `sign`.
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      const aEmpty = av === null || av === undefined || av === "";
      const bEmpty = bv === null || bv === undefined || bv === "";
      if (aEmpty || bEmpty) return compare(av, bv);
      return compare(av, bv) * sign;
    });
  }, [rows, sort, accessors]);

  const toggle = (key: string) =>
    setSort((s) => {
      if (s?.key === key) return { key, dir: s.dir === "asc" ? "desc" : "asc" };
      // First click on a number column should show the biggest, not the smallest.
      const sample = rows.map((r) => accessors[key]?.(r)).find((v) => v !== null && v !== undefined && v !== "");
      return { key, dir: typeof sample === "number" ? "desc" : "asc" };
    });

  return { sorted, sort, toggle };
}

const thBase: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--cc-text-subtle)",
  padding: "12px 24px",
};

export function SortableTh({
  label,
  sortKey,
  sort,
  onToggle,
  align = "left",
}: {
  label: string;
  /** Omit to render a plain, non-sortable header. */
  sortKey?: string;
  sort?: SortState | null;
  onToggle?: (key: string) => void;
  align?: "left" | "right";
}) {
  const active = !!sortKey && sort?.key === sortKey;
  const style: React.CSSProperties = { ...thBase, textAlign: align };

  if (!sortKey || !onToggle) return <th style={style}>{label}</th>;

  const Icon = active ? (sort!.dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;

  return (
    <th style={style} aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          flexDirection: align === "right" ? "row-reverse" : "row",
          background: "none",
          border: "none",
          padding: 0,
          font: "inherit",
          letterSpacing: "inherit",
          textTransform: "inherit",
          cursor: "pointer",
          color: active ? "var(--cc-text)" : "inherit",
        }}
      >
        {label}
        <Icon size={13} aria-hidden="true" style={{ opacity: active ? 1 : 0.45 }} />
      </button>
    </th>
  );
}

/** Right-aligned tabular figures, so digits line up column-wise and magnitudes
 *  are comparable at a glance instead of ragged. */
export const numericCell: React.CSSProperties = {
  padding: "14px 24px",
  fontSize: 14,
  fontWeight: 500,
  color: "var(--cc-text)",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  /* Full figures are long enough that a narrow column will wrap them, and CSS
     happily breaks after a comma at a table-cell width -- "300,500," over
     "000" is worse than a wider column or a scrollbar. Tables here sit in
     .rsp-table-wrap, which scrolls. */
  whiteSpace: "nowrap",
};
