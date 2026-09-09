"use client";

import { useEffect, useState } from "react";
import { Plus, LayoutGrid, List as ListIcon, Users } from "lucide-react";
import { Badge, Card, Input, Avatar, EmptyState } from "@pratham7711/ui";
import { imgSrc } from "@/lib/postMedia";
import { PageHeader, StatusTabs, Pagination, FilterDrawer, FilterButton, SortableTh, Button } from "@/components/ds";
import type { FilterDef, FilterValues } from "@/components/ds";
import { Search } from "lucide-react";
import AddCreatorModal from "@/components/modals/AddCreatorModal";
import Link from "next/link";
import { stripAt, platformLabel, formatFull } from "@/lib/format";
import { useListQuery } from "@/lib/useListQuery";
import { CREATORS_PAGE_SIZE } from "@/lib/listPageSize";
import type { CreatorSort } from "@/lib/listParams";

type Creator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  avatarUrl: string | null;
  followerCount: number | null;
  /** Distinct campaigns, counted from posts as well as activations. */
  campaignCount: number;
  avgViews: number | null;
  _count: { activations: number; posts: number };
};

function formatNumber(n: number): string {
  return formatFull(n);
}

const PLATFORM_TABS = [
  { key: "All", label: "All" },
  { key: "INSTAGRAM", label: "Instagram" },
  { key: "YOUTUBE", label: "YouTube" },
  { key: "TIKTOK", label: "TikTok" },
  { key: "TWITTER", label: "Twitter" },
];

const PLATFORM_BADGE_VARIANT: Record<string, "accent" | "danger" | "neutral" | "warning" | "success"> = {
  Instagram: "accent",
  YouTube: "danger",
  TikTok: "neutral",
  Twitter: "neutral",
};

export default function CreatorsClient({
  creators,
  platformCounts,
  total,
  page,
  q,
  platform,
  filterValues,
  filterCount,
  sort,
  tagOptions,
}: {
  creators: Creator[];
  platformCounts: Record<string, number>;
  total: number;
  page: number;
  q: string;
  platform: string;
  tagOptions: string[];
  filterValues: FilterValues;
  filterCount: number;
  sort: CreatorSort;
}) {
  const [search, setSearch] = useState(q);
  const [view, setView] = useState<"grid" | "table">("grid");
  const [showModal, setShowModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // Defaults are passed as undefined so they stay out of the URL entirely —
  // /creators rather than /creators?platform=All&page=1. The drawer's values
  // ride along so changing a tab or page keeps the filters applied.
  const { push, pending } = useListQuery({
    q,
    platform: platform === "All" ? undefined : platform,
    page: page === 1 ? undefined : page,
    // The default order stays out of the URL entirely, so /creators keeps
    // looking like /creators until someone actually sorts.
    sort: sort.key === "added" && sort.dir === "desc" ? undefined : sort.key,
    dir: sort.key === "added" && sort.dir === "desc" ? undefined : sort.dir,
    ...filterValues,
  });

  /* Sorting happens in the database, so a click goes to the URL rather than to
     a local array — otherwise it would reorder only the rows on this page and
     leave the largest value sitting on page 2. Re-sorting returns to page 1,
     since page 5 of a different order is not a place anyone asked to be. */
  const toggleSort = (key: string) => {
    const dir = sort.key === key && sort.dir === "desc" ? "asc" : "desc";
    push({ sort: key, dir, page: null });
  };

  const FILTERS: FilterDef[] = [
    // Offered only once the org has defined a tag, the way the campaigns drawer
    // treats its own -- a dropdown that can only ever be empty is not a filter.
    ...(tagOptions.length
      ? ([
          {
            type: "multiSelect" as const,
            key: "tags",
            label: "Tags to include",
            options: tagOptions.map((t) => ({ value: t, label: t })),
          },
          {
            type: "multiSelect" as const,
            key: "excludeTags",
            label: "Tags to exclude",
            options: tagOptions.map((t) => ({ value: t, label: t })),
          },
        ] satisfies FilterDef[])
      : []),
    { type: "numberRange", label: "Followers", minKey: "minFollowers", maxKey: "maxFollowers" },
    { type: "dateRange", label: "Added", fromKey: "addedFrom", toKey: "addedTo" },
    {
      type: "toggleGroup",
      label: "Activity",
      options: [{ key: "hasPosts", label: "Has tracked posts" }],
    },
  ];

  const anyFilter = Boolean(q) || platform !== "All" || filterCount > 0;
  const clearEverything = () => {
    setSearch("");
    const cleared: Record<string, null> = { q: null, platform: null, page: null, sort: null, dir: null };
    for (const key of Object.keys(filterValues)) cleared[key] = null;
    push(cleared);
  };

  // Filtering happens in the database now, so the box debounces into the URL
  // instead of slicing a local array.
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => push({ q: search || null, page: null }), 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = creators;
  const totalPages = Math.max(1, Math.ceil(total / CREATORS_PAGE_SIZE));

  /* A stat nobody on this page has is not shown at all. Follower counts came
     across empty for 1,823 of 1,834 creators, and a column of em dashes is a
     column pretending to hold a measurement. */
  const hasFollowers = filtered.some((c) => c.followerCount);
  const hasAvgViews = filtered.some((c) => c.avgViews);
  const optionalStats = [
    hasFollowers && { key: "followers", label: "Followers", read: (c: Creator) => c.followerCount },
    hasAvgViews && { key: "avgViews", label: "Avg. Views", read: (c: Creator) => c.avgViews },
  ].filter(Boolean) as { key: string; label: string; read: (c: Creator) => number | null }[];

  return (
    <div className="rsp-page">
      <PageHeader
        title="Creators"
        subtitle="Discover and manage your creator roster"
        actions={
          <Button variant="primary" iconLeft={<Plus size={15} />} size="sm" onClick={() => setShowModal(true)}>
            New Creator
          </Button>
        }
      />

      {/* Filters */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Creators"
            iconLeft={<Search size={16} />}
          />
        </div>
        <FilterButton count={filterCount} onClick={() => setShowFilters(true)} />
        <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 10, padding: 4 }}>
          <Button variant={view === "grid" ? "primary" : "ghost"} size="sm" onClick={() => setView("grid")} aria-label="Grid view">
            <LayoutGrid size={16} />
          </Button>
          <Button variant={view === "table" ? "primary" : "ghost"} size="sm" onClick={() => setView("table")} aria-label="Table view">
            <ListIcon size={16} />
          </Button>
        </div>
      </div>

      <StatusTabs
        ariaLabel="Filter creators by platform"
        style={{ marginBottom: 24 }}
        tabs={PLATFORM_TABS.map((t) => ({
          ...t,
          count: platformCounts[t.key] ?? 0,
        }))}
        active={platform}
        onChange={(key) => push({ platform: key === "All" ? null : key, page: null })}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Users size={32} color="var(--cc-text-subtle)" />}
          title={anyFilter ? "No creators match those filters" : "No creators yet"}
          description={
            anyFilter
              ? "Try a different search term, platform or filter."
              : "Add creators to your roster to get started."
          }
          action={
            anyFilter ? (
              <Button variant="secondary" onClick={clearEverything}>
                Clear filters
              </Button>
            ) : (
              <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowModal(true)}>
                New Creator
              </Button>
            )
          }
        />
      ) : view === "grid" ? (
        <div className="cc-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 20 }}>
          {filtered.map((creator) => (
            <Link prefetch={false} key={creator.id} href={`/creators/${creator.id}`} style={{ textDecoration: "none" }}>
              <Card variant="solid" className="ui-card-clickable" style={{ padding: 24 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
                  <Avatar name={creator.name} size="lg" src={imgSrc(creator.avatarUrl, 128) ?? undefined} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* A long handle used to wrap under the badge and collide with it. */}
                    <p style={{ fontWeight: 700, fontSize: 16, color: "var(--cc-text)", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={creator.name}>{creator.name}</p>
                    <p style={{ fontSize: 13, color: "var(--cc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{stripAt(creator.handle)}</p>
                  </div>
                  <span style={{ flexShrink: 0 }}>
                    <Badge variant={PLATFORM_BADGE_VARIANT[creator.platform] ?? "neutral"}>
                      {platformLabel(creator.platform)}
                    </Badge>
                  </span>
                </div>
                {optionalStats.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${optionalStats.length}, 1fr)`, gap: 12, marginBottom: 20 }}>
                    {optionalStats.map((stat) => {
                      const value = stat.read(creator);
                      return (
                        <div key={stat.key}>
                          <p style={{ fontSize: 11, color: "var(--cc-text-subtle)", marginBottom: 3, fontWeight: 600, letterSpacing: "0.3px", textTransform: "uppercase" }}>{stat.label}</p>
                          <p style={{ fontWeight: 700, fontSize: 16, color: "var(--cc-text)" }}>{value ? formatNumber(value) : ""}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="ui-btn ui-btn-ghost ui-btn-sm" style={{ width: "100%", justifyContent: "center", pointerEvents: "none" }} aria-hidden="true">View Profile</div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card variant="solid" noPadding>
          <div className="rsp-table-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--cc-hover-bg)" }}>
                <SortableTh label="Creator" sortKey="name" sort={sort} onToggle={toggleSort} />
                <SortableTh label="Platform" />
                {/* Neither of these can be ordered truthfully: Avg. Views is
                    measured from posts after this page was fetched, and an
                    unfetched follower count is a 0 that means unknown. See
                    CREATOR_SORT_KEYS. */}
                {optionalStats.map((stat) => (
                  <SortableTh key={stat.key} label={stat.label} />
                ))}
                <SortableTh label="Campaigns" />
                <SortableTh label="Posts" sortKey="posts" sort={sort} onToggle={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="cc-table-row" style={{ borderTop: "1px solid var(--cc-border)" }}>
                  <td style={{ padding: "14px 24px" }}>
                    <Link prefetch={false} href={`/creators/${c.id}`} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 12 }}>
                      <Avatar name={c.name} size="sm" src={imgSrc(c.avatarUrl, 64) ?? undefined} />
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{c.name}</p>
                        <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{stripAt(c.handle)}</p>
                      </div>
                    </Link>
                  </td>
                  <td style={{ padding: "14px 24px" }}>
                    <Badge variant={PLATFORM_BADGE_VARIANT[c.platform] ?? "neutral"}>{platformLabel(c.platform)}</Badge>
                  </td>
                  {optionalStats.map((stat) => {
                    const value = stat.read(c);
                    return (
                      <td key={stat.key} style={{ padding: "14px 24px", fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>
                        {value ? formatNumber(value) : ""}
                      </td>
                    );
                  })}
                  <td style={{ padding: "14px 24px", fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{c.campaignCount}</td>
                  <td style={{ padding: "14px 24px", fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{c._count.posts}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      {total > CREATORS_PAGE_SIZE && (
        <Pagination
          style={{ marginTop: 24 }}
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={CREATORS_PAGE_SIZE}
          loading={pending}
          onPageChange={(p) => push({ page: p === 1 ? null : p })}
        />
      )}

      <FilterDrawer
        open={showFilters}
        onClose={() => setShowFilters(false)}
        filters={FILTERS}
        values={filterValues}
        onApply={(next) => push({ ...next, page: null })}
      />

      {showModal && <AddCreatorModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
