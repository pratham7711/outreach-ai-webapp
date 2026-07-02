"use client";

import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type PaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  total?: number;
  pageSize?: number;
  loading?: boolean;
  style?: React.CSSProperties;
};

const navButtonStyle = (disabled: boolean): React.CSSProperties => ({
  height: 36,
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid var(--cc-border)",
  background: "transparent",
  color: "var(--cc-text)",
  fontSize: 13,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.5 : 1,
  display: "flex",
  alignItems: "center",
  gap: 6,
});

export function Pagination({ page, totalPages, onPageChange, total, pageSize, loading = false, style }: PaginationProps) {
  const prevDisabled = page <= 1 || loading;
  const nextDisabled = page >= totalPages || loading;
  const showRange = typeof total === "number" && typeof pageSize === "number" && total > 0;
  const rangeStart = showRange ? (page - 1) * (pageSize as number) + 1 : 0;
  const rangeEnd = showRange ? Math.min(page * (pageSize as number), total as number) : 0;

  return (
    <nav
      aria-label="Pagination"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: showRange ? "space-between" : "flex-end",
        gap: 12,
        flexWrap: "wrap",
        ...style,
      }}
    >
      {showRange && (
        <div style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
          Showing {rangeStart}-{rangeEnd} of {total}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          disabled={prevDisabled}
          aria-label="Previous page"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          style={navButtonStyle(prevDisabled)}
        >
          <ChevronLeft size={14} />
          Prev
        </button>
        <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
          Page {page} of {Math.max(totalPages, 1)}
        </span>
        <button
          type="button"
          disabled={nextDisabled}
          aria-label="Next page"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          style={navButtonStyle(nextDisabled)}
        >
          Next
          <ChevronRight size={14} />
        </button>
      </div>
    </nav>
  );
}
