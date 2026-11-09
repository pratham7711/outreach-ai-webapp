"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, LayoutGrid, List as ListIcon, Users, Upload, X, Globe2, ChevronRight } from "lucide-react";
import { Card, EmptyState } from "@pratham7711/ui";
import {
  Banner,
  Button,
  Dropdown,
  FilterButton,
  FilterDrawer,
  ListToolbar,
  NoResults,
  PageHeader,
  Pagination,
  SortableTh,
  StatusTabs,
  ViewToggle,
} from "@/components/ds";
import type { FilterDef, FilterValues } from "@/components/ds";
import AddCreatorModal from "@/components/modals/AddCreatorModal";
import ImportCreatorsModal from "@/components/creators/ImportCreatorsModal";
import Link from "next/link";
import { stripAt, platformLabel, formatFull, formatCompact, formatFullCurrency } from "@/lib/format";
import { pendingListProps, useListQuery } from "@/lib/useListQuery";
import { CREATOR_PLATFORM_TABS, type CreatorPlatformTab } from "@/lib/creators/platformTabs";
import { CREATORS_PAGE_SIZE } from "@/lib/listPageSize";
import type { CreatorSort } from "@/lib/listParams";
import { action } from "@/lib/ui/actions";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import { creatorNameParts } from "@/lib/creators/creatorName";
import PlatformChips, { type PlatformChipLink } from "@/components/creators/PlatformChips";
import RosterActions, { RosterMenu, type RosterSelection } from "@/components/creators/RosterActions";
import { TrackAllButton } from "@/components/creators/TrackCreators";
import { profileUrl, type ImportPlatform } from "@/lib/creators/importParse";
import { handleIssueSummary } from "@/lib/creators/handleCheck";
import { isUnknownMetric, type MetricValue } from "@/lib/creators/metricValue";
import type { FigureTimeDto } from "@/lib/creators/figureTime";
import { AgeLabel } from "@/components/ds/AgeLabel";
import { TIME_NOT_RECORDED, formatAsOf, isStale } from "@/lib/dataAge";
import MetricFigure from "@/components/creators/MetricFigure";

type Creator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  avatarUrl: string | null;
  /** See CreatorAvatar's `version`: stored, fetchable on view, or nothing to ask for. */
  avatarVersion: string | null;
  followerCount: number | null;
  /** The same count, or why there is none -- what the cells render (plan A1). */
  followers: MetricValue;
  /** When followers / avg views were measured and by what (plan A6). */
  followersAt?: FigureTimeDto;
  avgViewsAt?: FigureTimeDto;
  /** Distinct campaigns, counted from posts as well as activations. */
  campaignCount: number;
  avgViews: number | null;
  avgViewsFigure: MetricValue;
  _count: { activations: number; posts: number };
  rate: number | null;
  tags: string[];
  links: (PlatformChipLink & { refreshedAt: string | null })[];
  audienceCountry: string | null;
};

type CountryOption = { name: string; n: number };

/**
 * A roster figure's age on its own line under the figure (plan A6): "3h ago",
 * a Stale chip past twice its cadence, or "time not recorded" (TIME_NOT_RECORDED,
 * the one phrase every screen uses) when no read can be shown to have produced
 * it -- the reason is in the tooltip. Nothing under an
 * unknown figure: its "—" already says why, on hover.
 */
function FigureAge({ value, time, end = false }: { value: MetricValue; time: FigureTimeDto | undefined; end?: boolean }) {
  if (!time || isUnknownMetric(value)) return null;
  return (
    <AgeLabel
      at={time.at}
      field={time.field}
      source={time.at ? time.source : time.missing}
      never={TIME_NOT_RECORDED}
      style={{ display: "flex", justifyContent: end ? "flex-end" : undefined, maxWidth: "100%", overflow: "hidden", marginTop: 2 }}
    />
  );
}

function formatNumber(n: number): string {
  return formatFull(n);
}

const TAB_LABELS: Record<CreatorPlatformTab, string> = {
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
  TWITTER: "Twitter",
};

const PLATFORM_TABS = [{ key: "All", label: "All" }, ...CREATOR_PLATFORM_TABS.map((key) => ({ key, label: TAB_LABELS[key] }))];

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

type OptionalStat = {
  key: string;
  label: string;
  read: (c: Creator) => MetricValue;
  at: (c: Creator) => FigureTimeDto | undefined;
};

type CardStat = {
  key: string;
  label: string;
  empty: (c: Creator) => boolean;
  render: (c: Creator) => React.ReactNode;
  age?: (c: Creator) => React.ReactNode;
};

/* The grid card and the table row are memoised, and everything they are handed
   keeps its identity while someone types in the search box, so a keystroke no
   longer re-renders 24 cards of chips, figures and ages. */
const CreatorCard = memo(function CreatorCard({
  creator,
  on,
  onToggle,
  cardStats,
}: {
  creator: Creator;
  on: boolean;
  onToggle: (id: string) => void;
  cardStats: CardStat[];
}) {
  const { name: title, handle } = creatorNameParts(creator.name, creator.handle);
  return (
    /* The name is the link and stretches over the card, so the
       account chips and the checkbox can be controls of their own --
       an <a> inside the card's <a> is invalid and breaks both. */
    <div className="cc-roster-card" data-selected={on || undefined}>
      <Card variant="solid" className="ui-card-clickable">
        <label className="cc-roster-check">
          <input type="checkbox" checked={on} onChange={() => onToggle(creator.id)} aria-label={`Select ${creator.name}`} />
        </label>
        <div className="cc-roster-card-head">
          <CreatorAvatar id={creator.id} name={creator.name} size="lg" version={creator.avatarVersion} />
          <div className="cc-roster-card-id">
            <Link prefetch={false} href={`/creators/${creator.id}`} className="cc-roster-card-link" title={creator.name}>
              {title}
            </Link>
            {handle && <p className="cc-roster-card-handle">{handle}</p>}
          </div>
        </div>
        <div className="cc-roster-card-meta">
          <PlatformChips links={accountsOf(creator)} max={4} compact counts={accountsOf(creator).length > 1} />
          <TagList tags={creator.tags} />
        </div>
        {cardStats.length > 0 && (
          <dl className="cc-roster-card-stats" style={{ gridTemplateColumns: `repeat(${cardStats.length}, minmax(0, 1fr))` }}>
            {cardStats.map((stat) => {
              return (
                <div key={stat.key}>
                  <dt className="cc-microlabel">{stat.label}</dt>
                  {/* An em dash, not "". The column is only drawn when
                      somebody on the page has this stat, so a card
                      without one still has to say so -- an empty string
                      left "Avg. Views" captioning blank space, which
                      reads as a value that failed to load. */}
                  <dd data-empty={stat.empty(creator) || undefined}>{stat.render(creator)}</dd>
                  {stat.age && <dd className="cc-roster-card-age">{stat.age(creator)}</dd>}
                </div>
              );
            })}
          </dl>
        )}
        <div className="cc-roster-card-foot">
          {creator.audienceCountry ? (
            <span className="cc-roster-card-audience" title={`Audience: ${creator.audienceCountry}`}>
              <Globe2 size={14} aria-hidden />
              <span>{creator.audienceCountry}</span>
            </span>
          ) : (
            <span />
          )}
          <span className="cc-roster-card-open" aria-hidden="true">
            View profile
            <ChevronRight size={14} />
          </span>
        </div>
      </Card>
    </div>
  );
});

/* Where each column sits. The table fills its card at 1440 with 12px cell
   insets (.cc-roster-dt): at the house 16 the nine columns overflowed it.
   Creator has no width of its own and takes what is left. */
const COL = {
  check: 44,
  accounts: 116,
  tags: 150,
  followers: 120,
  avgViews: 112,
  audience: 96,
  price: 92,
  campaigns: 112,
  posts: 84,
} as const;

/** The figure's age for its tooltip: when it was read and by what. */
function ageTitle(time: FigureTimeDto | undefined): string | undefined {
  if (!time) return undefined;
  return time.at ? `Read ${formatAsOf(time.at)} · ${time.source}` : `${TIME_NOT_RECORDED} · ${time.missing}`;
}

/** Elements in a row that act on their own; a click on one is not a click on the row. */
const ROW_STOP = "a, button, input, label, [role='menuitem']";

const CreatorRow = memo(function CreatorRow({
  c,
  on,
  onToggle,
  onOpen,
  optionalStats,
  hasAudience,
  hasPrice,
  now,
}: {
  c: Creator;
  on: boolean;
  onToggle: (id: string) => void;
  onOpen: (e: React.MouseEvent<HTMLTableRowElement>, href: string) => void;
  optionalStats: OptionalStat[];
  hasAudience: boolean;
  hasPrice: boolean;
  now: Date;
}) {
  const href = `/creators/${c.id}`;
  const { name, handle } = creatorNameParts(c.name, c.handle);
  return (
    <tr data-href={href} data-selected={on || undefined} onClick={(e) => onOpen(e, href)}>
      <td className="cc-roster-td-check">
        <label className="cc-roster-check-hit">
          <input type="checkbox" checked={on} onChange={() => onToggle(c.id)} aria-label={`Select ${c.name}`} />
        </label>
      </td>
      <td>
        <div className="cc-roster-dt-id">
          <CreatorAvatar id={c.id} name={c.name} size="sm" version={c.avatarVersion} />
          <span style={{ minWidth: 0 }}>
            <Link prefetch={false} href={href} className="cc-dt-primary cc-dt-truncate" title={c.name}>
              {name}
            </Link>
            {handle && <span className="cc-dt-sub cc-dt-truncate">{handle}</span>}
          </span>
        </div>
      </td>
      <td>
        <PlatformChips links={accountsOf(c)} max={3} compact />
      </td>
      <td>{c.tags.length ? <TagList tags={c.tags} max={2} /> : <span className="cc-roster-dt-none">—</span>}</td>
      {/* The figure's age is in its tooltip; the cell says it only when the
          figure is stale. "time not recorded" under every row was the same
          sentence eighteen times. */}
      {optionalStats.map((stat) => {
        const value = stat.read(c);
        const time = stat.at(c);
        const stale = !isUnknownMetric(value) && !!time?.at && isStale(time.at, time.field, undefined, now);
        return (
          <td key={stat.key} data-align="right" data-unknown={isUnknownMetric(value) || undefined}>
            <span title={isUnknownMetric(value) ? undefined : ageTitle(time)}>
              <MetricFigure value={value} format={formatNumber} />
            </span>
            {stale && <FigureAge value={value} time={time} end />}
          </td>
        );
      })}
      {hasAudience && (
        <td>
          <span className="cc-dt-truncate" title={c.audienceCountry ?? undefined}>
            {c.audienceCountry ?? "—"}
          </span>
        </td>
      )}
      {hasPrice && (
        <td data-align="right" data-unknown={!c.rate || undefined}>
          {c.rate ? formatFullCurrency(c.rate) : "—"}
        </td>
      )}
      <td data-align="right">{formatFull(c.campaignCount)}</td>
      <td data-align="right">{formatFull(c._count.posts)}</td>
    </tr>
  );
});

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
  offerRateFilter,
  query,
  rosterReady,
  handleIssues = { gone: 0, unreadable: 0 },
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
  /** Some creator in the org has a rate, or a rate filter is already applied. */
  offerRateFilter: boolean;
  filterValues: FilterValues;
  filterCount: number;
  sort: CreatorSort;
  query: string;
  rosterReady: boolean;
  /** Creators with an account the platform could not find, across the roster. */
  handleIssues?: { gone: number; unreadable: number };
  audienceCountryOptions: CountryOption[];
  countryOptions: CountryOption[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState(q);
  const [view, setView] = useState<"grid" | "table">("grid");
  /* One clock per render of the page, so every row's "is it stale" is
     measured against the same moment and the memoised rows can skip. */
  const [now] = useState(() => new Date());
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [allMatching, setAllMatching] = useState(false);
  const handleIssueText = handleIssueSummary(handleIssues.gone, handleIssues.unreadable);

  // A selection belongs to one set of filters. Ticks survive paging through
  // them, but change what matches and they would silently point at creators
  // that are no longer on screen.
  useEffect(() => {
    /* Kept when already empty: a fresh Set is a new value, and on mount that
       re-rendered the whole roster once for nothing. */
    setPicked((prev) => (prev.size ? new Set() : prev));
    setAllMatching(false);
  }, [query]);
  // Defaults are passed as undefined so they stay out of the URL entirely —
  // /creators rather than /creators?platform=All&page=1. The drawer's values
  // ride along so changing a tab or page keeps the filters applied.
  const { push, pending, shown } = useListQuery({
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

  /* The platform tabs and the pager draw from `shown` -- the query with the
     click already applied (see useListQuery) -- so a choice shows the moment it
     is made, not when the server answers. A cleared platform is All. */
  const shownPlatform =
    shown.platform === null ? "All" : typeof shown.platform === "string" ? shown.platform : platform;
  const shownPage = shown.page === null ? 1 : Number(shown.page ?? page);
  /* The grid has no column headers to click, so it had no way to sort at all.
     The same orders the table offers, as one menu that serves both views.
     Followers puts the unread creators last in both directions (the server
     reads it in two segments); Avg. views is not offered because it is
     measured after a page is fetched and cannot be ordered across pages. */
  const sortOptions = [
    { value: "added:desc", label: "Newest added" },
    { value: "added:asc", label: "Oldest added" },
    { value: "name:asc", label: "Name, A to Z" },
    { value: "name:desc", label: "Name, Z to A" },
    { value: "followers:desc", label: "Most followers" },
    { value: "followers:asc", label: "Fewest followers" },
    { value: "posts:desc", label: "Most posts" },
    { value: "posts:asc", label: "Fewest posts" },
    { value: "price:desc", label: "Highest price" },
    { value: "price:asc", label: "Lowest price" },
  ];

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
    ...(offerRateFilter
      ? [{ type: "numberRange" as const, label: "Price per video", minKey: "minRate", maxKey: "maxRate", unit: "USD" }]
      : []),
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
    ...(rosterReady
      ? [
          {
            type: "toggleGroup" as const,
            label: "Handle check",
            options: [{ key: "handleIssues", label: "Account not found" }],
          },
        ]
      : []),
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
    if (fv.handleIssues) out.push({ id: "handleIssues", label: "Account not found", clear: { handleIssues: null } });
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
  const toggle = useCallback((id: string) => {
    setAllMatching(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
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
  /* The whole row opens the creator, as its pointer says; the name is the
     real link, for keyboards and a middle click. The checkbox, the account
     chips and the tags keep their own clicks. */
  const openRow = useCallback(
    (e: React.MouseEvent<HTMLTableRowElement>, href: string) => {
      if (e.defaultPrevented || (e.target as Element).closest(ROW_STOP)) return;
      if (window.getSelection()?.toString()) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        window.open(href, "_blank", "noopener");
        return;
      }
      router.push(href);
    },
    [router],
  );
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
  const hasFollowers = filtered.some((c) => !isUnknownMetric(c.followers));
  const hasAvgViews = filtered.some((c) => !isUnknownMetric(c.avgViewsFigure));
  /* A creator without the figure in a drawn column gets "—" with the reason
     the server gave (plan A1) -- never blank, never 0. */
  /* Built from three booleans, so they keep their identity while someone types
     and the memoised rows below can skip. */
  const { optionalStats, cardStats } = useMemo(() => {
    const optionalStats = [
      hasFollowers && { key: "followers", label: "Followers", read: (c: Creator) => c.followers, at: (c: Creator) => c.followersAt },
      hasAvgViews && { key: "avgViews", label: "Avg. Views", read: (c: Creator) => c.avgViewsFigure, at: (c: Creator) => c.avgViewsAt },
    ].filter(Boolean) as OptionalStat[];
    /* The card's strip adds price, which the table keeps in a column of its own.
       A missing price is "not set" rather than an unmeasured figure, so it keeps
       its plain dash. */
    const cardStats: CardStat[] = [
      ...optionalStats.map((stat) => ({
        key: stat.key,
        label: stat.label,
        empty: (c: Creator) => isUnknownMetric(stat.read(c)),
        render: (c: Creator) => (
          <span title={isUnknownMetric(stat.read(c)) ? undefined : ageTitle(stat.at(c))}>
            <MetricFigure value={stat.read(c)} format={formatNumber} breakable />
          </span>
        ),
        age: (c: Creator) => {
          const time = stat.at(c);
          return time?.at && !isUnknownMetric(stat.read(c)) && isStale(time.at, time.field) ? <FigureAge value={stat.read(c)} time={time} /> : null;
        },
      })),
      ...(hasPrice
        ? [{ key: "price", label: "Price", empty: (c: Creator) => !c.rate, render: (c: Creator) => (c.rate ? formatFullCurrency(c.rate) : "—") }]
        : []),
    ];
    return { optionalStats, cardStats };
  }, [hasFollowers, hasAvgViews, hasPrice]);

  /* The table's floor: the fixed columns plus 200px for the name, below
     which the card scrolls the table rather than squeezing it. */
  const tableMin =
    COL.check + 200 + COL.accounts + COL.tags +
    optionalStats.reduce((sum, stat) => sum + (stat.key === "followers" ? COL.followers : COL.avgViews), 0) +
    (hasAudience ? COL.audience : 0) + (hasPrice ? COL.price : 0) + COL.campaigns + COL.posts;
  const columnCount = 6 + optionalStats.length + (hasAudience ? 1 : 0) + (hasPrice ? 1 : 0);
  const pager =
    total > 0 ? (
      <Pagination
        page={shownPage}
        totalPages={totalPages}
        total={total}
        pageSize={CREATORS_PAGE_SIZE}
        loading={pending}
        onPageChange={(p) => push({ page: p === 1 ? null : p })}
      />
    ) : null;

  return (
    <div className="rsp-page">
      <PageHeader
        title="Creator Roster"
        /* The platform tabs close the header band, above the toolbar; each
           tab's count says how many creators it holds. */
        tabs={
          <StatusTabs
            ariaLabel="Filter creators by platform"
            tabs={PLATFORM_TABS.map((t) => ({
              ...t,
              count: platformCounts[t.key] ?? 0,
            }))}
            active={shownPlatform}
            onChange={(key) => push({ platform: key === "All" ? null : key, page: null })}
          />
        }
        actions={
          <>
            {/* The whole roster whatever the filters say -- "all" is the
                agency's creators, and the bulk bar below acts on a filter. */}
            <TrackAllButton />
            <Button variant="secondary" iconLeft={<Upload size={15} />} size="sm" onClick={() => setShowImport(true)} {...action("import-creators")}>
              Import
            </Button>
            <Button variant="primary" iconLeft={<Plus size={15} />} size="sm" onClick={() => setShowModal(true)} {...action("new-creator")}>
              New Creator
            </Button>
          </>
        }
      />

      {handleIssueText && !filterValues.handleIssues && (
        <Banner
          tone="warning"
          action={
            <Button variant="secondary" size="sm" onClick={() => push({ handleIssues: "1", page: null })}>
              Review {handleIssues.gone + handleIssues.unreadable === 1 ? "it" : "them"}
            </Button>
          }
        >
          {handleIssueText}
        </Banner>
      )}

      <ListToolbar
        search={{ value: search, onChange: setSearch, placeholder: "Search creators", ariaLabel: "Search creators by name or handle" }}
        end={
          <>
            <Dropdown
              ariaLabel="Sort creators"
              size="md"
              align="right"
              /* From `shown`, like the tabs and the pager, so the picked order
                 shows at once rather than when the server's page lands. */
              value={`${typeof shown.sort === "string" ? shown.sort : sort.key}:${typeof shown.dir === "string" ? shown.dir : sort.dir}`}
              onChange={(v) => {
                const [key, dir] = v.split(":");
                push({ sort: key, dir, page: null });
              }}
              options={sortOptions}
              minWidth={170}
            />
            <FilterButton count={filterCount} onClick={() => setShowFilters(true)} />
            <ViewToggle
              value={view}
              onChange={setView}
              options={[
                { value: "grid", label: "Grid view", icon: LayoutGrid },
                { value: "table", label: "Table view", icon: ListIcon },
              ]}
            />
            <RosterMenu total={total} query={query} suggestedName={suggestedName} tagOptions={tagOptions} />
          </>
        }
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

      <div {...pendingListProps(pending)}>
      {filtered.length === 0 && !anyFilter ? (
        <EmptyState
          icon={<Users size={32} color="var(--cc-text-subtle)" />}
          title="No creators yet"
          description="Add creators to your roster to get started."
          action={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <Button variant="primary" iconLeft={<Upload size={16} />} onClick={() => setShowImport(true)}>
                Import your creator sign-ups
              </Button>
              <Button variant="secondary" iconLeft={<Plus size={16} />} onClick={() => setShowModal(true)}>
                Add a creator
              </Button>
            </div>
          }
        />
      ) : view === "grid" ? (
        <>
          {filtered.length === 0 ? (
            <div className="cc-dt-card">
              <NoResults onClear={clearEverything} />
            </div>
          ) : (
            <div className="cc-stagger cc-roster-grid">
              {filtered.map((creator) => (
                <CreatorCard
                  key={creator.id}
                  creator={creator}
                  on={allMatching || picked.has(creator.id)}
                  onToggle={toggle}
                  cardStats={cardStats}
                />
              ))}
            </div>
          )}
          {pager ? <div className="cc-roster-grid-pager">{pager}</div> : null}
        </>
      ) : (
        <div className="cc-dt-card">
          <div className="cc-dt-scroll">
            <table className="cc-dt cc-roster-dt" style={{ minWidth: tableMin }}>
              <caption className="sr-only">Creators</caption>
              <colgroup>
                <col style={{ width: COL.check }} />
                <col />
                <col style={{ width: COL.accounts }} />
                <col style={{ width: COL.tags }} />
                {optionalStats.map((stat) => (
                  <col key={stat.key} style={{ width: stat.key === "followers" ? COL.followers : COL.avgViews }} />
                ))}
                {hasAudience && <col style={{ width: COL.audience }} />}
                {hasPrice && <col style={{ width: COL.price }} />}
                <col style={{ width: COL.campaigns }} />
                <col style={{ width: COL.posts }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="cc-th cc-roster-th-check">
                    <label className="cc-roster-check-hit">
                      <input
                        type="checkbox"
                        checked={allMatching || allOnPage}
                        disabled={pageIds.length === 0}
                        ref={(el) => {
                          if (el) el.indeterminate = !allMatching && pickedOnPage > 0 && !allOnPage;
                        }}
                        onChange={togglePage}
                        aria-label="Select every creator on this page"
                      />
                    </label>
                  </th>
                  <SortableTh label="Creator" sortKey="name" sort={sort} onToggle={toggleSort} />
                  <SortableTh label="Accounts" />
                  <SortableTh label="Tags" />
                  {/* Followers sorts with the unknown zeros pinned last either way
                      (lib/creators/rosterSort). Avg. Views still cannot be ordered
                      truthfully: it is measured from posts after this page was
                      fetched. See CREATOR_SORT_KEYS. */}
                  {optionalStats.map((stat) => (
                    <SortableTh
                      key={stat.key}
                      label={stat.label}
                      align="right"
                      sortKey={stat.key === "followers" ? "followers" : undefined}
                      sort={sort}
                      onToggle={toggleSort}
                    />
                  ))}
                  {hasAudience && <SortableTh label="Audience" />}
                  {hasPrice && <SortableTh label="Price" align="right" sortKey="price" sort={sort} onToggle={toggleSort} />}
                  <SortableTh label="Campaigns" align="right" />
                  <SortableTh label="Posts" align="right" sortKey="posts" sort={sort} onToggle={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr className="cc-dt-empty">
                    <td colSpan={columnCount}>
                      <NoResults onClear={clearEverything} />
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => (
                    <CreatorRow
                      key={c.id}
                      c={c}
                      on={allMatching || picked.has(c.id)}
                      onToggle={toggle}
                      onOpen={openRow}
                      optionalStats={optionalStats}
                      hasAudience={hasAudience}
                      hasPrice={hasPrice}
                      now={now}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          {pager ? <div className="cc-dt-foot">{pager}</div> : null}
        </div>
      )}
      </div>

      <RosterActions
        total={total}
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
