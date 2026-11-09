"use client";

import type React from "react";
import { Skeleton } from "@/components/ds/Skeleton";

/** Reusable skeleton for page headers (title + subtitle + action button) */
export function PageHeaderSkeleton({ hasAction = true }: { hasAction?: boolean }) {
  return (
    <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <div style={{ marginBottom: 8 }}>
          <Skeleton width={200} height={28} />
        </div>
        <Skeleton width={260} height={16} />
      </div>
      {hasAction && (
        <div style={{ borderRadius: 8 }}>
          <Skeleton width={140} height="var(--cc-control-h)" radius="var(--cc-r-control)" />
        </div>
      )}
    </div>
  );
}

/**
 * KPI tiles while they load: the same grid (.cc-tiles-balanced) and tile shell
 * (.cc-metric-tile) as the loaded row, so the count, the 12px radius and the
 * height match and nothing shifts when the figures arrive. Pass the count the
 * page will render -- the dashboard drew 2 placeholders and then 4 tiles.
 */
export function TileGridSkeleton({ count = 4, style }: { count?: number; style?: React.CSSProperties }) {
  return (
    <div className="cc-tiles-balanced" style={style} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="cc-metric-tile">
          <Skeleton width={96} height={14} style={{ margin: "3px 0" }} />
          <Skeleton width={120} height={26} style={{ margin: "3px 0" }} />
        </div>
      ))}
    </div>
  );
}

/** Kept for existing callers; the tile row above is what it now draws. */
export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return <TileGridSkeleton count={count} style={{ marginBottom: 32 }} />;
}

/** The ListToolbar row: a search box and `filters` controls at the right. */
export function ListToolbarSkeleton({ filters = 2 }: { filters?: number }) {
  return (
    <div className="cc-toolbar" aria-hidden="true">
      <div className="cc-toolbar-search">
        <Skeleton width="100%" height="var(--cc-control-h)" radius="var(--cc-r-control)" />
      </div>
      {filters > 0 ? (
        <div className="cc-toolbar-end">
          {Array.from({ length: filters }).map((_, i) => (
            <Skeleton key={i} width={120} height="var(--cc-control-h)" radius="var(--cc-r-control)" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type SkeletonColumn = { width?: number | string; align?: "left" | "right" };

/**
 * A DataTable while its first page loads: the same card, 40px head and cell
 * padding, in the columns the table will have. (A mounted DataTable with
 * `loading` and no rows draws these rows itself, under its real headers.)
 */
export function DataTableSkeleton({ columns = 5, rows = 8 }: { columns?: number | SkeletonColumn[]; rows?: number }) {
  const cols: SkeletonColumn[] = typeof columns === "number" ? Array.from({ length: columns }, () => ({})) : columns;
  const widths = ["72%", "56%", "64%", "48%"];
  return (
    <div className="cc-dt-card" aria-hidden="true">
      <div className="cc-dt-scroll">
        <table className="cc-dt">
          <colgroup>
            {cols.map((c, i) => (
              <col key={i} style={c.width === undefined ? undefined : { width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={i} className="cc-th" data-align={c.align}>
                  <Skeleton width={56} height={10} style={c.align === "right" ? { marginLeft: "auto" } : undefined} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r} className="cc-dt-skeleton-row">
                {cols.map((c, i) => (
                  <td key={i} data-align={c.align}>
                    <Skeleton
                      width={c.align === "right" ? 56 : widths[(r + i) % widths.length]}
                      height={12}
                      style={c.align === "right" ? { marginLeft: "auto" } : undefined}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Skeleton for table rows */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderRadius: "var(--cc-r-card)",
        overflow: "hidden",
      }}
    >
      {/* Table header */}
      <div
        style={{
          display: "flex",
          gap: 16,
          padding: "14px 24px",
          background: "var(--cc-hover-bg)",
          borderBottom: "1px solid var(--cc-border)",
        }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} style={{ flex: i === 0 ? 2 : 1 }}>
            <Skeleton width={80} height={12} />
          </div>
        ))}
      </div>
      {/* Table rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "14px 24px",
            borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
          }}
        >
          <div style={{ flexShrink: 0 }}>
            <Skeleton width={36} height={36} borderRadius="50%" />
          </div>
          <div style={{ flex: 2 }}>
            <div style={{ marginBottom: 6 }}>
              <Skeleton width="70%" height={14} />
            </div>
            <Skeleton width="40%" height={12} />
          </div>
          {Array.from({ length: columns - 1 }).map((_, j) => (
            <div key={j} style={{ flex: 1 }}>
              <Skeleton width={60} height={14} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Skeleton for card grid (creators, etc.) */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
      style={{ gap: 20 }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: "var(--cc-r-card)",
            padding: "var(--cc-card-inset)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
            <div style={{ flexShrink: 0 }}>
              <Skeleton width={48} height={48} borderRadius="50%" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: 6 }}>
                <Skeleton width="60%" height={16} />
              </div>
              <Skeleton width="40%" height={13} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div>
              <div style={{ marginBottom: 6 }}>
                <Skeleton width={60} height={11} />
              </div>
              <Skeleton width={50} height={18} />
            </div>
            <div>
              <div style={{ marginBottom: 6 }}>
                <Skeleton width={70} height={11} />
              </div>
              <Skeleton width={40} height={18} />
            </div>
          </div>
          <Skeleton width="100%" height={32} borderRadius={6} />
        </div>
      ))}
    </div>
  );
}

/** Skeleton for chart area */
export function ChartSkeleton() {
  return (
    <div
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderRadius: "var(--cc-r-card)",
        padding: "var(--cc-card-inset)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <Skeleton width={32} height={32} borderRadius={8} />
        <Skeleton width={180} height={16} />
      </div>
      <Skeleton width="100%" height={240} borderRadius={8} />
    </div>
  );
}

/** Full dashboard page skeleton */
export function DashboardSkeleton() {
  return (
    <div className="cc-page-content">
      <PageHeaderSkeleton hasAction={false} />
      <StatGridSkeleton count={4} />
      <div className="grid grid-cols-1 lg:grid-cols-5" style={{ gap: 24, marginBottom: 32 }}>
        <div className="lg:col-span-3">
          <TableSkeleton rows={5} columns={4} />
        </div>
        <div className="lg:col-span-2">
          <div
            style={{
              background: "var(--cc-card)",
              border: "1px solid var(--cc-border)",
              borderRadius: "var(--cc-r-card)",
              padding: "var(--cc-card-inset)",
            }}
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ display: "flex", gap: 14, padding: "14px 0", borderBottom: i < 4 ? "1px solid var(--cc-border)" : "none" }}>
                <div style={{ flexShrink: 0 }}>
                  <Skeleton width={34} height={34} borderRadius={8} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ marginBottom: 6 }}>
                    <Skeleton width="80%" height={13} />
                  </div>
                  <Skeleton width="50%" height={12} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <ChartSkeleton />
    </div>
  );
}

/** Campaigns list skeleton */
export function CampaignsListSkeleton() {
  return (
    <div className="cc-page-content">
      <PageHeaderSkeleton />
      <div style={{ marginBottom: 20 }}>
        <Skeleton width="100%" height={40} borderRadius={10} />
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i}>
            <Skeleton width={100} height={34} borderRadius={8} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i}>
            <Skeleton width={80} height={36} />
          </div>
        ))}
      </div>
      <TableSkeleton rows={6} columns={5} />
    </div>
  );
}

/** Creators list skeleton */
export function CreatorsListSkeleton() {
  return (
    <div className="cc-page-content">
      <PageHeaderSkeleton />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div style={{ flex: 1 }}>
          <Skeleton width="100%" height={40} borderRadius={10} />
        </div>
        <Skeleton width={80} height={36} borderRadius={10} />
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i}>
            <Skeleton width={80} height={28} borderRadius={999} />
          </div>
        ))}
      </div>
      <CardGridSkeleton count={6} />
    </div>
  );
}

/** Clients list skeleton */
export function ClientsListSkeleton() {
  return (
    <div className="cc-page-content">
      <PageHeaderSkeleton />
      <StatGridSkeleton count={2} />
      <div style={{ marginBottom: 24 }}>
        <Skeleton width="100%" height={40} borderRadius={10} />
      </div>
      <TableSkeleton rows={5} columns={3} />
    </div>
  );
}

/**
 * A listing page: header, optional KPI tiles, the toolbar, then the table.
 * The audit log uses it with its five columns.
 */
export function ListPageSkeleton({
  tiles = 0,
  filters = 2,
  columns = 5,
  rows = 8,
  hasAction = true,
}: {
  tiles?: number;
  filters?: number;
  columns?: number | SkeletonColumn[];
  rows?: number;
  hasAction?: boolean;
}) {
  return (
    <div className="rsp-page">
      <PageHeaderSkeleton hasAction={hasAction} />
      {tiles > 0 ? <TileGridSkeleton count={tiles} style={{ marginBottom: 24 }} /> : null}
      <ListToolbarSkeleton filters={filters} />
      <DataTableSkeleton columns={columns} rows={rows} />
    </div>
  );
}

/** A page of cards (lists, songs, plans): header, toolbar, card grid. */
export function CardGridPageSkeleton({
  count = 6,
  toolbar = true,
  filters = 0,
  hasAction = true,
}: {
  count?: number;
  toolbar?: boolean;
  filters?: number;
  hasAction?: boolean;
}) {
  return (
    <div className="rsp-page">
      <PageHeaderSkeleton hasAction={hasAction} />
      {toolbar ? <ListToolbarSkeleton filters={filters} /> : null}
      <CardGridSkeleton count={count} />
    </div>
  );
}
