"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, LayoutGrid, List as ListIcon, Users, Upload, X } from "lucide-react";
import { Badge, Card, Input, EmptyState } from "@pratham7711/ui";
import { PageHeader, StatusTabs, Pagination, FilterDrawer, FilterButton, SortableTh, Button } from "@/components/ds";
import type { FilterDef, FilterValues } from "@/components/ds";
import { Search } from "lucide-react";
import AddCreatorModal from "@/components/modals/AddCreatorModal";
import ImportCreatorsModal from "@/components/creators/ImportCreatorsModal";
import Link from "next/link";
import { stripAt, platformLabel, formatFull, formatCompact, formatFullCurrency } from "@/lib/format";
import { useListQuery } from "@/lib/useListQuery";
import { CREATORS_PAGE_SIZE } from "@/lib/listPageSize";
import type { CreatorSort } from "@/lib/listParams";
import { action } from "@/lib/ui/actions";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import PlatformChips, { type PlatformChipLink } from "@/components/creators/PlatformChips";
import RosterActions, { type RosterSelection } from "@/components/creators/RosterActions";
import { profileUrl, type ImportPlatform } from "@/lib/creators/importParse";

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
  rate: number | null;
  tags: string[];
  links: (PlatformChipLink & { refreshedAt: string | null })[];
  audienceCountry: string | null;
};

type CountryOption = { name: string; n: number };

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

const LINKABLE = new Set<string>(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"]);

/** A creator from before the roster tables has one account: its own row. */
function accountsOf(c: Creator): PlatformChipLink[] {
  if (c.links.length) return c.links;
  const handle = stripAt(c.handle);
  return [
    {
      platform: c.platform,
      handle,
      url: LINKABLE.has(c.platform) ? profileUrl(c.platform as ImportPlatform, handle) : null,
      followersCount: c.followerCount,
    },
  ];
}

/** The countries people actually have, most common first, keeping any already picked. */
function countryFilterOptions(options: CountryOption[], selected: string | undefined, cap = 40) {
  const picked = new Set((selected ?? "").split(",").filter(Boolean));
  return options
    .filter((o, i) => i < cap || picked.has(o.name))
    .map((o) => ({ value: o.name, label: o.name, count: o.n }));
}

const csv = (v: string | undefined) => (v ?? "").split(",").filter(Boolean);

function rangeLabel(min: string | undefined, max: string | undefined, fmt: (n: number) => string) {
  if (min && max) return `${fmt(Number(min))}–${fmt(Number(max))}`;
  if (min) return `≥ ${fmt(Number(min))}`;
  return `≤ ${fmt(Number(max))}`;
}

type ActiveFilter = { id: string; label: string; clear: Record<string, string | null> };

function TagList({ tags, max = 3 }: { tags: string[]; max?: number }) {
  if (!tags.length) return null;
  const shown = tags.slice(0, max);
  return (
    <span className="cc-roster-tags">
      {shown.map((t) => (
        <span key={t} className="cc-roster-tag">
          {t}
        </span>
      ))}
      {tags.length > shown.length && (
        <span className="cc-roster-tag" title={tags.slice(max).join(", ")}>
          +{tags.length - shown.length}
        </span>
      )}
    </span>
  );
}

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
  query,
  rosterReady,
  audienceCountryOptions,
  countryOptions,
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
  query: string;
  rosterReady: boolean;
  audienceCountryOptions: CountryOption[];
  countryOptions: CountryOption[];
}) {
  const [search, setSearch] = useState(q);
  const [view, setView] = useState<"grid" | "table">("grid");
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [allMatching, setAllMatching] = useState(false);

  // A selection belongs to one set of filters. Ticks survive paging through
  // them, but change what matches and they would silently point at creators
  // that are no longer on screen.
  useEffect(() => {
    setPicked(new Set());
    setAllMatching(false);
  }, [query]);
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
    { type: "numberRange", label: "Avg. views", minKey: "minAvgViews", maxKey: "maxAvgViews" },
    { type: "numberRange", label: "Price per video", minKey: "minRate", maxKey: "maxRate", unit: "USD" },
    {
      type: "multiSelect",
      key: "accounts",
      label: "Has an account on",
      options: PLATFORM_TABS.filter((t) => t.key !== "All").map((t) => ({ value: t.key, label: t.label })),
    },
    // Both live on the roster's detail rows, so they are offered only where those
    // exist and someone has actually answered them.
    ...(rosterReady && audienceCountryOptions.length
      ? [
          {
            type: "multiSelect" as const,
            key: "audienceCountry",
            label: "Audience country",
            options: countryFilterOptions(audienceCountryOptions, filterValues.audienceCountry),
          },
        ]
      : []),
    ...(rosterReady && countryOptions.length
      ? [
          {
            type: "multiSelect" as const,
            key: "country",
            label: "Creator's country",
            options: countryFilterOptions(countryOptions, filterValues.country),
          },
        ]
      : []),
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

  /* Every filter in force, each removable on its own. The drawer is where they
     are set; this row is where someone sees what they are looking at, and is
     what a saved list is named after. */
  const active = useMemo<ActiveFilter[]>(() => {
    const out: ActiveFilter[] = [];
    const fv = filterValues;
    if (q) out.push({ id: "q", label: `“${q}”`, clear: { q: null } });
    if (platform !== "All") out.push({ id: "platform", label: platformLabel(platform), clear: { platform: null } });
    const each = (key: string, prefix: string, label = (v: string) => v) => {
      const values = csv(fv[key]);
      for (const v of values) {
        const rest = values.filter((x) => x !== v).join(",");
        out.push({ id: `${key}:${v}`, label: `${prefix}${label(v)}`, clear: { [key]: rest || null } });
      }
    };
    each("tags", "");
    each("excludeTags", "Not ");
    const range = (id: string, label: string, minKey: string, maxKey: string, fmt: (n: number) => string) => {
      if (fv[minKey] || fv[maxKey]) {
        out.push({ id, label: `${label} ${rangeLabel(fv[minKey], fv[maxKey], fmt)}`, clear: { [minKey]: null, [maxKey]: null } });
      }
    };
    range("followers", "Followers", "minFollowers", "maxFollowers", formatCompact);
    range("avgViews", "Avg. views", "minAvgViews", "maxAvgViews", formatCompact);
    range("rate", "Price", "minRate", "maxRate", (n) => formatFullCurrency(n));
    each("accounts", "On ", platformLabel);
    each("audienceCountry", "Audience: ");
    each("country", "From ");
    if (fv.addedFrom || fv.addedTo) {
      const label = fv.addedFrom && fv.addedTo ? `${fv.addedFrom} to ${fv.addedTo}` : fv.addedFrom ? `since ${fv.addedFrom}` : `before ${fv.addedTo}`;
      out.push({ id: "added", label: `Added ${label}`, clear: { addedFrom: null, addedTo: null } });
    }
    if (fv.hasPosts) out.push({ id: "hasPosts", label: "Has tracked posts", clear: { hasPosts: null } });
    return out;
  }, [q, platform, filterValues]);

  const suggestedName = useMemo(() => {
    const fv = filterValues;
    const parts = [
      ...csv(fv.tags),
      platform !== "All" ? platformLabel(platform) : null,
      ...csv(fv.accounts).map(platformLabel),
      fv.minFollowers ? `${formatCompact(Number(fv.minFollowers))}+` : null,
      ...csv(fv.audienceCountry),
      q ? `“${q}”` : null,
    ].filter(Boolean);
    return parts.join(" · ").slice(0, 200) || "Roster picks";
  }, [q, platform, filterValues]);

  const pageIds = filtered.map((c) => c.id);
  const pickedOnPage = pageIds.filter((id) => picked.has(id)).length;
  const allOnPage = pageIds.length > 0 && pickedOnPage === pageIds.length;
  const toggle = (id: string) => {
    setAllMatching(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const togglePage = () => {
    setAllMatching(false);
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (allOnPage) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };
  const clearSelection = () => {
    setPicked(new Set());
    setAllMatching(false);
  };
  const selection: RosterSelection = allMatching
    ? { mode: "all" }
    : picked.size
      ? { mode: "ids", ids: [...picked] }
      : { mode: "filter" };
  const hasPrice = filtered.some((c) => c.rate);
  const hasAudience = filtered.some((c) => c.audienceCountry);

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
        title="Creator Roster"
        subtitle="Every creator your agency works with, in one place"
        /* `total` is the database count for the CURRENT filters, not the rows
           on screen. It used to be `filtered.length`, which is one page -- so a
           1,832-creator roster captioned itself "24 Creators", 24 being the page
           size, and said "24 Creators" again on every page after it. */
        caption={`${total} Creator${total !== 1 ? "s" : ""}`}
        actions={
          <>
            <Button variant="secondary" iconLeft={<Upload size={15} />} size="sm" onClick={() => setShowImport(true)} {...action("import-creators")}>
              Import
            </Button>
            <Button variant="primary" iconLeft={<Plus size={15} />} size="sm" onClick={() => setShowModal(true)} {...action("new-creator")}>
              New Creator
            </Button>
          </>
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

      {active.length > 0 && (
        <div className="cc-roster-active" aria-label="Filters in use">
          {active.map((f) => (
            <button
              key={f.id}
              type="button"
              className="cc-roster-active-chip"
              onClick={() => {
                if ("q" in f.clear) setSearch("");
                push({ ...f.clear, page: null });
              }}
              aria-label={`Remove filter ${f.label}`}
            >
              {f.label}
              <X size={13} aria-hidden />
            </button>
          ))}
          <button type="button" className="cc-roster-active-clear" onClick={clearEverything}>
            Clear all
          </button>
        </div>
      )}

      {filtered.length > 0 && total > filtered.length && (allOnPage || allMatching) && (
        <div className="cc-roster-selectall" role="status">
          {allMatching ? (
            <>
              All {formatFull(total)} matching creators are selected.
              <button type="button" onClick={clearSelection}>
                Clear selection
              </button>
            </>
          ) : (
            <>
              All {formatFull(pageIds.length)} on this page are selected.
              <button type="button" onClick={() => setAllMatching(true)}>
                Select all {formatFull(total)} matching
              </button>
            </>
          )}
        </div>
      )}

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
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                <Button variant="primary" iconLeft={<Upload size={15} />} onClick={() => setShowImport(true)}>
                  Import your creator sign-ups
                </Button>
                <Button variant="secondary" iconLeft={<Plus size={15} />} onClick={() => setShowModal(true)}>
                  Add a creator
                </Button>
              </div>
            )
          }
        />
      ) : view === "grid" ? (
        <div className="cc-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 20 }}>
          {filtered.map((creator) => {
            const on = allMatching || picked.has(creator.id);
            return (
              /* The name is the link and stretches over the card, so the
                 account chips and the checkbox can be controls of their own --
                 an <a> inside the card's <a> is invalid and breaks both. */
              <div key={creator.id} className="cc-roster-card" data-selected={on || undefined}>
                <Card variant="solid" className="ui-card-clickable" style={{ padding: 24, height: "100%" }}>
                  <label className="cc-roster-check">
                    <input type="checkbox" checked={on} onChange={() => toggle(creator.id)} aria-label={`Select ${creator.name}`} />
                  </label>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14, paddingRight: 28 }}>
                    <CreatorAvatar id={creator.id} name={creator.name} size="lg" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* A long handle used to wrap under the badge and collide with it. */}
                      <Link
                        prefetch={false}
                        href={`/creators/${creator.id}`}
                        className="cc-roster-card-link"
                        style={{ display: "block", fontWeight: 700, fontSize: "var(--cc-t-16)", color: "var(--cc-text)", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none" }}
                        title={creator.name}
                      >
                        {creator.name}
                      </Link>
                      <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{stripAt(creator.handle)}</p>
                    </div>
                  </div>
                  <div className="cc-roster-card-meta">
                    <PlatformChips links={accountsOf(creator)} max={4} />
                    <TagList tags={creator.tags} />
                    {(creator.audienceCountry || creator.rate) && (
                      <p className="cc-roster-card-line">
                        {creator.rate ? <span>{formatFullCurrency(creator.rate)} per video</span> : null}
                        {creator.audienceCountry ? <span title={creator.audienceCountry}>Audience: {creator.audienceCountry}</span> : null}
                      </p>
                    )}
                  </div>
                  {optionalStats.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: `repeat(${optionalStats.length}, 1fr)`, gap: 12, margin: "16px 0 20px" }}>
                      {optionalStats.map((stat) => {
                        const value = stat.read(creator);
                        return (
                          <div key={stat.key}>
                            <p className="cc-microlabel" style={{ marginBottom: 3 }}>{stat.label}</p>
                            {/* An em dash, not "". The column is only drawn when
                                somebody on the page has this stat, so a card
                                without one still has to say so -- an empty string
                                left "Avg. Views" captioning blank space, which
                                reads as a value that failed to load. */}
                            <p style={{ fontWeight: 700, fontSize: "var(--cc-t-16)", color: value ? "var(--cc-text)" : "var(--cc-text-muted)" }}>{value ? formatNumber(value) : "—"}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="ui-btn ui-btn-ghost ui-btn-sm" style={{ width: "100%", justifyContent: "center", pointerEvents: "none", marginTop: optionalStats.length ? 0 : 16 }} aria-hidden="true">View Profile</div>
                </Card>
              </div>
            );
          })}
        </div>
      ) : (
        <Card variant="solid" noPadding>
          <div className="rsp-table-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--cc-hover-bg)" }}>
                <th className="cc-roster-th-check">
                  <input
                    type="checkbox"
                    checked={allMatching || allOnPage}
                    ref={(el) => {
                      if (el) el.indeterminate = !allMatching && pickedOnPage > 0 && !allOnPage;
                    }}
                    onChange={togglePage}
                    aria-label="Select every creator on this page"
                  />
                </th>
                <SortableTh label="Creator" sortKey="name" sort={sort} onToggle={toggleSort} />
                <SortableTh label="Accounts" />
                <SortableTh label="Tags" />
                {/* Neither of these can be ordered truthfully: Avg. Views is
                    measured from posts after this page was fetched, and an
                    unfetched follower count is a 0 that means unknown. See
                    CREATOR_SORT_KEYS. */}
                {optionalStats.map((stat) => (
                  <SortableTh key={stat.key} label={stat.label} />
                ))}
                {hasAudience && <SortableTh label="Audience" />}
                {hasPrice && <SortableTh label="Price" sortKey="price" sort={sort} onToggle={toggleSort} />}
                <SortableTh label="Campaigns" />
                <SortableTh label="Posts" sortKey="posts" sort={sort} onToggle={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const on = allMatching || picked.has(c.id);
                return (
                <tr key={c.id} className="cc-table-row" data-selected={on || undefined} style={{ borderTop: "1px solid var(--cc-border)" }}>
                  <td className="cc-roster-td-check">
                    <input type="checkbox" checked={on} onChange={() => toggle(c.id)} aria-label={`Select ${c.name}`} />
                  </td>
                  <td style={{ padding: "14px 24px" }}>
                    <Link prefetch={false} href={`/creators/${c.id}`} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 12 }}>
                      <CreatorAvatar id={c.id} name={c.name} size="sm" />
                      <div>
                        <p style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{c.name}</p>
                        <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>@{stripAt(c.handle)}</p>
                      </div>
                    </Link>
                  </td>
                  <td style={{ padding: "14px 24px" }}>
                    <PlatformChips links={accountsOf(c)} max={3} />
                  </td>
                  <td style={{ padding: "14px 24px" }}>
                    {c.tags.length ? <TagList tags={c.tags} max={2} /> : <span style={{ color: "var(--cc-text-muted)" }}>—</span>}
                  </td>
                  {optionalStats.map((stat) => {
                    const value = stat.read(c);
                    return (
                      <td key={stat.key} style={{ padding: "14px 24px", fontSize: "var(--cc-t-14)", fontWeight: 500, color: value ? "var(--cc-text)" : "var(--cc-text-muted)" }}>
                        {value ? formatNumber(value) : "—"}
                      </td>
                    );
                  })}
                  {hasAudience && (
                    <td className="cc-roster-td-text" title={c.audienceCountry ?? undefined}>
                      {c.audienceCountry ?? "—"}
                    </td>
                  )}
                  {hasPrice && (
                    <td style={{ padding: "14px 24px", fontSize: "var(--cc-t-14)", fontWeight: 500, color: c.rate ? "var(--cc-text)" : "var(--cc-text-muted)" }}>
                      {c.rate ? formatFullCurrency(c.rate) : "—"}
                    </td>
                  )}
                  <td style={{ padding: "14px 24px", fontSize: "var(--cc-t-14)", fontWeight: 500, color: "var(--cc-text)" }}>{c.campaignCount}</td>
                  <td style={{ padding: "14px 24px", fontSize: "var(--cc-t-14)", fontWeight: 500, color: "var(--cc-text)" }}>{c._count.posts}</td>
                </tr>
                );
              })}
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

      <RosterActions
        total={total}
        filtered={anyFilter}
        selection={selection}
        query={query}
        suggestedName={suggestedName}
        tagOptions={tagOptions}
        onClear={clearSelection}
      />

      <FilterDrawer
        open={showFilters}
        onClose={() => setShowFilters(false)}
        filters={FILTERS}
        values={filterValues}
        onApply={(next) => push({ ...next, page: null })}
      />

      {showModal && <AddCreatorModal onClose={() => setShowModal(false)} />}
      {showImport && <ImportCreatorsModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
