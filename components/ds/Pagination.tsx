"use client";

import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatFull } from "@/lib/format";
import { Dropdown } from "./Dropdown";

export type PaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  total?: number;
  pageSize?: number;
  loading?: boolean;
  /** Offer a page-size choice (e.g. [10, 25, 50]) on the right. Needs onPageSizeChange. */
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
  style?: React.CSSProperties;
  className?: string;
};

/**
 * The page numbers to draw: first, last, and the current page with its
 * neighbours, with a gap where pages are skipped. A single skipped page is
 * drawn as itself, since "…" would take the same room and say less.
 */
export function pageItems(page: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const keep = new Set([1, totalPages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => keep.add(p));
  if (page >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach((p) => keep.add(p));
  const pages = [...keep].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  pages.forEach((p, i) => {
    const prev = pages[i - 1];
    if (prev !== undefined && p - prev === 2) out.push(prev + 1);
    else if (prev !== undefined && p - prev > 2) out.push("gap");
    out.push(p);
  });
  return out;
}

/**
 * Where you are in a long list, and how to move: the range on the left
 * ("26–50 of 3,118"), the pages in the middle, the page size on the right.
 * It sits flush in a DataTable's footer.
 *
 * With one page there is nowhere to go, so the controls are not drawn -- the
 * old bar showed a disabled Prev and Next under every short list -- but the
 * range stays, because "1–8 of 8" is still the count. On a phone the page list
 * folds to "2 / 9" between the arrows.
 */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  total,
  pageSize,
  loading = false,
  pageSizeOptions,
  onPageSizeChange,
  style,
  className,
}: PaginationProps) {
  const pages = Math.max(totalPages, 1);
  const showRange = typeof total === "number" && typeof pageSize === "number" && total > 0;
  const start = showRange ? (page - 1) * pageSize! + 1 : 0;
  const end = showRange ? Math.min(page * pageSize!, total!) : 0;
  const showControls = pages > 1;
  const showSize =
    !!onPageSizeChange &&
    !!pageSizeOptions?.length &&
    (typeof total !== "number" || total > Math.min(...pageSizeOptions));

  if (!showRange && !showControls && !showSize) return null;

  return (
    <nav aria-label="Pagination" className={`cc-pager${className ? ` ${className}` : ""}`} style={style}>
      <div className="cc-pager-range" aria-live="polite">
        {showRange ? `${formatFull(start)}–${formatFull(end)} of ${formatFull(total!)}` : null}
      </div>

      {showControls ? (
        <div className="cc-pager-pages">
          <button
            type="button"
            className="cc-pager-btn"
            aria-label="Previous page"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          {pageItems(page, pages).map((p, i) =>
            p === "gap" ? (
              <span key={`gap${i}`} className="cc-pager-gap" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                className="cc-pager-btn cc-pager-num"
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
                disabled={loading && p !== page}
                onClick={() => p !== page && onPageChange(p)}
              >
                {formatFull(p)}
              </button>
            ),
          )}
          <span className="cc-pager-compact" aria-hidden="true">
            {page} / {pages}
          </span>
          <button
            type="button"
            className="cc-pager-btn"
            aria-label="Next page"
            disabled={page >= pages || loading}
            onClick={() => onPageChange(Math.min(pages, page + 1))}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div />
      )}

      <div className="cc-pager-size">
        {showSize ? (
          <Dropdown
            ariaLabel="Rows per page"
            align="right"
            minWidth={0}
            value={String(pageSize ?? pageSizeOptions![0])}
            onChange={(v) => onPageSizeChange!(Number(v))}
            options={pageSizeOptions!.map((n) => ({ value: String(n), label: `${n} per page` }))}
          />
        ) : null}
      </div>
    </nav>
  );
}
