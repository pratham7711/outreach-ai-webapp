"use client";

import type React from "react";
import { Skeleton } from "@/components/ds/Skeleton";
import { SectionCard } from "@/components/ds/SectionCard";
import { ChevronLeft } from "lucide-react";

export type HeaderTabSkeleton = string | { label: string; icon?: boolean; count?: boolean };
/* Inline, so the line keeps the height of the text it stands in for. */
const INLINE: React.CSSProperties = { display: "inline-block", verticalAlign: "middle" };

export type HeaderSkeletonProps = Parameters<typeof PageHeaderSkeleton>[0];

/**
 * The page header while the page loads, drawn with PageHeader's own classes
 * (.rsp-header.cc-page-band and its parts), so the band, its hairline, the
 * tab strip and the gap to the content are the loaded header's. A title or a
 * tab label that never changes is written out; anything that comes from data
 * is a block. `actions` is the width of each header button, left to right.
 */
export function PageHeaderSkeleton({
  hasAction = true,
  actions,
  title,
  subtitle = true,
  tabs,
  back = false,
  leading = false,
  badges = 0,
  meta = false,
}: {
  hasAction?: boolean;
  actions?: number[];
  title?: string;
  subtitle?: boolean | string;
  tabs?: HeaderTabSkeleton[];
  back?: boolean;
  /** Beside the title: a creator's avatar (true), a song's artwork ("thumb") or a post's video frame ("wide"). */
  leading?: boolean | "thumb" | "wide";
  badges?: number;
  meta?: boolean;
}) {
  const buttons = actions ?? (hasAction ? [132] : []);
  return (
    <header
      className="rsp-header cc-page-band"
      aria-hidden="true"
      data-has-tabs={tabs?.length ? "" : undefined}
      data-has-back={back ? "" : undefined}
    >
      <div className="cc-page-lead">
        {back ? (
          <span className="cc-page-back">
            <ChevronLeft size={16} />
          </span>
        ) : null}
        {leading ? (
          <div className="cc-page-leading">
            {leading === true ? (
              <Skeleton width={40} height={40} radius="50%" />
            ) : (
              <Skeleton width={leading === "wide" ? 60 : 40} height={40} radius="var(--cc-r-control)" />
            )}
          </div>
        ) : null}
        <div className="cc-page-heading">
          <div className="cc-page-titleline">
            <div className="cc-page-title">{title ?? <Skeleton width={220} height={22} style={INLINE} />}</div>
            {badges > 0 ? (
              <div className="cc-page-titlemeta">
                {Array.from({ length: badges }).map((_, i) => (
                  <Skeleton key={i} width={72} height={20} radius="var(--cc-r-pill)" />
                ))}
              </div>
            ) : null}
          </div>
          {subtitle ? (
            <p className="cc-page-subtitle">
              {typeof subtitle === "string" ? subtitle : <Skeleton width={260} height={14} style={INLINE} />}
            </p>
          ) : null}
          {meta ? (
            <div className="cc-page-meta">
              <span><Skeleton width={96} height={12} /></span>
              <span><Skeleton width={64} height={12} /></span>
              <span><Skeleton width={72} height={12} /></span>
            </div>
          ) : null}
        </div>
      </div>
      {buttons.length > 0 ? (
        <div className="cc-page-actions">
          {buttons.map((w, i) => (
            <Skeleton key={i} width={w} height="var(--cc-control-h)" radius="var(--cc-r-control)" />
          ))}
        </div>
      ) : null}
      {tabs?.length ? (
        <div className="cc-page-tabs">
          <div className="cc-tabs" data-variant="underline" role="tablist">
            {tabs.map((t, i) => {
              const tab = typeof t === "string" ? { label: t } : t;
              return (
                <span key={tab.label} className="cc-tab" role="tab" aria-selected={i === 0}>
                  {tab.icon ? <Skeleton width={16} height={16} /> : null}
                  {tab.label}
                  {tab.count ? <Skeleton width={22} height={18} radius="var(--cc-r-pill)" /> : null}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </header>
  );
}

/**
 * A SectionCard while its body loads: the real card head with the title it
 * will have, and `lines` placeholder rows under it.
 */
export function SectionCardSkeleton({ title, lines = 3, height }: { title: string; lines?: number; height?: number }) {
  return (
    <SectionCard title={title}>
      {height ? (
        <Skeleton width="100%" height={height} radius="var(--cc-r-control)" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--cc-sp-4)" }}>
          {Array.from({ length: lines }).map((_, i) => (
            <Skeleton key={i} width={["88%", "64%", "76%", "52%"][i % 4]} height={14} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/**
 * KPI tiles while they load: the same grid (.cc-tiles-balanced) and tile shell
 * (.cc-metric-tile) as the loaded row, so the count, the 12px radius and the
 * height match and nothing shifts when the figures arrive. Pass the count the
 * page will render -- the dashboard drew 2 placeholders and then 4 tiles.
 */
export function TileGridSkeleton({ count = 4, style, footer = false }: { count?: number; style?: React.CSSProperties; footer?: boolean }) {
  return (
    <div className="cc-tiles-balanced" style={style} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="cc-metric-tile">
          <Skeleton width={96} height={14} style={{ margin: "3px 0" }} />
          <Skeleton width={120} height={26} style={{ margin: "3px 0" }} />
          {footer ? (
            <div className="cc-metric-footer">
              <Skeleton width={140} height={12} style={INLINE} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
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

/**
 * A grid of placeholder cards. `className`/`style` are the page's own grid
 * (so the columns and gap are the loaded page's), `height` the loaded card's
 * measured height, and `lead` the leading mark: a round avatar, a square
 * cover, or none.
 */
export function CardGridSkeleton({
  count = 6,
  className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  style = { gap: 20 },
  height = 180,
  lead = "avatar",
  stats = 2,
}: {
  count?: number;
  className?: string;
  style?: React.CSSProperties;
  height?: number;
  lead?: "avatar" | "cover" | "none";
  stats?: number;
}) {
  return (
    <div className={className} style={style} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            height,
            overflow: "hidden",
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: "var(--cc-r-card)",
            padding: "var(--cc-card-inset)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
            {lead === "none" ? null : (
              <Skeleton width={lead === "cover" ? 52 : 44} height={lead === "cover" ? 52 : 44} radius={lead === "cover" ? 10 : "50%"} />
            )}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <Skeleton width="60%" height={16} />
              <Skeleton width="40%" height={13} />
            </div>
          </div>
          {stats > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${stats}, 1fr)`, gap: 10 }}>
              {Array.from({ length: stats }).map((_, j) => (
                <div key={j} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <Skeleton width={56} height={11} />
                  <Skeleton width={44} height={18} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * /dashboard while it loads: its header (range, granularity, Export; the
 * Overview / Performance / Activity strip), the four KPI tiles with their
 * caption line, then the Views over time card at the chart's 400px.
 */
export function DashboardSkeleton() {
  return (
    <div className="rsp-page">
      <PageHeaderSkeleton
        title="Dashboard"
        subtitle={false}
        actions={[222, 120, 132]}
        tabs={[{ label: "Overview", icon: true }, { label: "Performance", icon: true }, { label: "Activity", icon: true }]}
      />
      <div className="flex flex-col gap-6" aria-hidden="true">
        <TileGridSkeleton count={4} footer />
        <SectionCardSkeleton title="Views over time" height={400} />
      </div>
    </div>
  );
}

/**
 * The fallback for a route with no loading screen of its own: the header band
 * and one content block, so nothing in it claims a shape the page will not
 * have.
 */
export function GenericPageSkeleton() {
  return (
    <div className="rsp-page">
      <PageHeaderSkeleton hasAction={false} subtitle={false} />
      <Skeleton width="100%" height={360} radius="var(--cc-r-card)" />
    </div>
  );
}

/** The Creator Roster: platform tabs, the toolbar, then the card grid. */
export function CreatorsListSkeleton() {
  return (
    <div className="rsp-page">
      <PageHeaderSkeleton
        title="Creator Roster"
        subtitle={false}
        actions={[100, 139]}
        tabs={["All", "Instagram", "YouTube", "TikTok", "Twitter"].map((label) => ({ label, count: true }))}
      />
      <ListToolbarSkeleton filters={3} />
      <CardGridSkeleton count={6} className="cc-roster-grid" style={undefined} height={249} />
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
  header,
  tileFooter = false,
}: {
  tiles?: number;
  tileFooter?: boolean;
  filters?: number;
  columns?: number | SkeletonColumn[];
  rows?: number;
  hasAction?: boolean;
  header?: HeaderSkeletonProps;
}) {
  return (
    <div className="rsp-page">
      <PageHeaderSkeleton hasAction={hasAction} {...header} />
      {tiles > 0 ? <TileGridSkeleton count={tiles} footer={tileFooter} style={{ marginBottom: 24 }} /> : null}
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
  header,
  children,
}: {
  count?: number;
  toolbar?: boolean;
  filters?: number;
  hasAction?: boolean;
  header?: HeaderSkeletonProps;
  /** The page's own card grid, when CardGridSkeleton is not its shape. */
  children?: React.ReactNode;
}) {
  return (
    <div className="rsp-page">
      <PageHeaderSkeleton hasAction={hasAction} {...header} />
      {toolbar ? <ListToolbarSkeleton filters={filters} /> : null}
      {children ?? <CardGridSkeleton count={count} />}
    </div>
  );
}
