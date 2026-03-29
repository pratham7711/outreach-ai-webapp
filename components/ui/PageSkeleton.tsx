"use client";

import { Skeleton } from "@pratham7711/ui";

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
          <Skeleton width={140} height={36} borderRadius={8} />
        </div>
      )}
    </div>
  );
}

/** Skeleton for stat card grids */
export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
      style={{ gap: 20, marginBottom: 32 }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: 12,
            padding: 24,
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <Skeleton width={100} height={12} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <Skeleton width={80} height={28} />
          </div>
          <Skeleton width={120} height={14} />
        </div>
      ))}
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
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* Table header */}
      <div
        style={{
          display: "flex",
          gap: 16,
          padding: "14px 24px",
          background: "var(--cc-hover-bg, rgba(0,0,0,0.02))",
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
            borderRadius: 12,
            padding: 24,
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
        borderRadius: 12,
        padding: 28,
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
              borderRadius: 12,
              padding: 20,
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
