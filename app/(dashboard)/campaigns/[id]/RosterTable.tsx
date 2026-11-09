"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Columns3, UserPlus, Users } from "lucide-react";
import {
  Button,
  DataTable,
  ListToolbar,
  NoResults,
  PlatformTag,
  StatusBadge,
  statusTone,
  useTableSort,
  type DataTableColumn,
  type SortAccessors,
  type SortState,
  type StatusTone,
} from "@/components/ds";
import { formatDateAbs, stripAt, formatFull } from "@/lib/format";
import { enumLabel } from "@/lib/ui/enumLabel";
import { formatMoney } from "@/lib/money";
import { CampaignHeaderActions } from "@/components/campaigns/CampaignHeaderActions";
import { action } from "@/lib/ui/actions";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import CreatorName from "@/components/creators/CreatorName";
import { TrackCampaignCreatorsButton } from "@/components/creators/TrackCreators";
import { AgeLabel } from "@/components/ds/AgeLabel";
import type { FigureTimeDto } from "@/lib/creators/figureTime";

/**
 * The campaign roster, with the toolbar the reference puts above it.
 *
 * The reference offers Search, Filtering, Sorting, Grouping and Add Columns over
 * this table. Search, sorting and column choice are here; Grouping and its saved
 * "New View" are not, and are not faked -- see the note on columns below for how
 * far the URL gets us.
 *
 * Two of the offered columns are ones the table could not previously show at
 * all: the deliverable due date, which buildRoster used to discard, and average
 * views per post. So the Columns control reveals data rather than only hiding it.
 */

export type RosterRow = {
  creator: {
    id: string;
    name: string;
    handle: string;
    platform: string;
    followersCount: number;
    avatarUrl: string | null;
    rate: number | null;
  };
  activationStatus: string | null;
  deliverableDueDate: string | null;
  posts: number;
  /** Null when none of the creator's posts has a view count we read. */
  views: number | null;
  /** How many of `posts` the views sum covers. */
  viewsKnown: number;
  /** When the follower count was measured, and by what (plan A6). Absent when
   *  the route could not date it; the cell then shows no age. */
  followersAt?: FigureTimeDto;
};

type Col = {
  key: string;
  label: string;
  /** Fixed width in px. The creator column has none and takes what is left. */
  width?: number;
  /** Floor for the creator column, used to decide when the table scrolls. */
  minWidth?: number;
  /** Numbers: right-aligned and tabular. */
  align?: "right";
  /** Creator is the row's identity, so it is never hidden. */
  locked?: boolean;
  /** Off until someone asks for it. */
  optional?: boolean;
};

const COLUMNS: Col[] = [
  { key: "creator", label: "Creator", minWidth: 240, locked: true },
  { key: "platform", label: "Platform", width: 128 },
  { key: "followers", label: "Followers", width: 128, align: "right" },
  { key: "posts", label: "Posts", width: 96, align: "right" },
  { key: "views", label: "Views", width: 128, align: "right" },
  { key: "avgViews", label: "Avg. views", width: 128, align: "right", optional: true },
  { key: "rate", label: "Rate", width: 120, align: "right", optional: true },
  { key: "due", label: "Due", width: 120, optional: true },
  { key: "status", label: "Status", width: 168 },
];

const DEFAULT_KEYS = COLUMNS.filter((c) => !c.optional).map((c) => c.key);

/* The tones this table already used. A status not listed takes the shared tone. */
const ACTIVATION_TONE: Record<string, StatusTone> = {
  AWAITING_DRAFT: "warning",
  DRAFT_SUBMITTED: "info",
  REVISION_REQUESTED: "danger",
  APPROVED: "success",
  POSTED: "success",
  COMPLETE: "success",
  CANCELLED: "neutral",
};

/* followersCount is Float @default(0), so a creator nobody has fetched holds 0
   rather than null -- and a column of zeroes reads as a roster with no audience.
   Kept identical to the behaviour this table already had. */
function unwritten(v: number | null | undefined): number | null {
  return v === null || v === undefined || v === 0 ? null : v;
}

/* Average over the posts whose views were read, not over every post: dividing a
   partial sum by all of them would understate the creator. Null when none. */
function avgViewsOf(r: RosterRow): number | null {
  return r.views === null || r.viewsKnown <= 0 ? null : Math.round(r.views / r.viewsKnown);
}

/* Why a views cell is a dash, or what a partial sum covers. The Creators tab
   showed "0" for a creator whose posts were never read -- the same creator that
   Performance › Top Creators already showed as unknown. */
function viewsReason(r: RosterRow): string | undefined {
  if (r.posts === 0) return "No posts on this campaign yet, so there are no views to count";
  if (r.views === null) {
    return r.posts === 1
      ? "Their post has no view count read yet, so its views are not known"
      : `None of their ${r.posts} posts has a view count read yet, so their views are not known`;
  }
  if (r.viewsKnown < r.posts) return `Views known for ${r.viewsKnown} of ${r.posts} posts`;
  return undefined;
}

const ACCESSORS: SortAccessors<RosterRow> = {
  creator: (r) => r.creator.name,
  platform: (r) => r.creator.platform,
  followers: (r) => unwritten(r.creator.followersCount),
  posts: (r) => r.posts,
  views: (r) => r.views,
  avgViews: (r) => avgViewsOf(r),
  rate: (r) => (r.creator.rate && r.creator.rate > 0 ? r.creator.rate : null),
  due: (r) => r.deliverableDueDate,
  status: (r) => r.activationStatus ?? "POSTED",
};

function renderCell(key: string, r: RosterRow, currency: string): React.ReactNode {
  switch (key) {
    case "creator":
      return (
        <>
          <CreatorAvatar id={r.creator.id} name={r.creator.name} size="sm" />
          <CreatorName name={r.creator.name} handle={r.creator.handle} />
        </>
      );
    case "platform":
      return <PlatformTag platform={r.creator.platform} />;
    case "followers": {
      const f = unwritten(r.creator.followersCount);
      if (f === null) return "—";
      /* The figure's age on its own line, as on the Creators list: a Stale
         chip past twice its cadence, or "time not recorded" when no read can
         be shown to have produced it. */
      return (
        <>
          {formatFull(f)}
          {r.followersAt ? (
            <span className="cc-dt-sub">
              <AgeLabel
                at={r.followersAt.at}
                field={r.followersAt.field}
                source={r.followersAt.at ? r.followersAt.source : r.followersAt.missing}
                never={null}
                style={{ maxWidth: "100%", overflow: "hidden" }}
              />
            </span>
          ) : null}
        </>
      );
    }
    case "posts":
      return r.posts;
    case "views":
      return <span title={viewsReason(r)}>{r.views === null ? "—" : formatFull(r.views)}</span>;
    case "avgViews": {
      const avg = avgViewsOf(r);
      return <span title={viewsReason(r)}>{avg === null ? "—" : formatFull(avg)}</span>;
    }
    case "rate":
      // Null means no rate agreed, which is not a rate of nothing.
      return r.creator.rate === null || r.creator.rate <= 0 ? "—" : formatMoney(r.creator.rate, currency);
    case "due":
      return r.deliverableDueDate ? formatDateAbs(r.deliverableDueDate) : "—";
    case "status":
      return r.activationStatus ? (
        <StatusBadge tone={ACTIVATION_TONE[r.activationStatus] ?? statusTone(r.activationStatus)}>
          {enumLabel(r.activationStatus)}
        </StatusBadge>
      ) : (
        <StatusBadge tone="success">Posted</StatusBadge>
      );
    default:
      return null;
  }
}

/**
 * Which columns are on: a checkbox list under a toolbar button, drawn with the
 * filter drawer's checkbox rows. Not a MenuButton, whose items cannot carry a
 * checked state, so a screen reader would not hear which columns are shown.
 */
function ColumnPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      box.current?.querySelector("button")?.focus();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const toggle = (key: string) =>
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);

  return (
    <div ref={box} className="cc-column-picker cc-phone-hide">
      <Button
        variant="secondary"
        size="sm"
        iconLeft={<Columns3 size={16} aria-hidden="true" />}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        Columns
      </Button>
      {open && (
        <div id={panelId} role="group" aria-label="Columns to show" className="cc-column-picker-panel">
          {COLUMNS.filter((c) => !c.locked).map((c) => {
            const on = selected.includes(c.key);
            return (
              <label key={c.key} className="cc-filter-option" data-on={on}>
                <input type="checkbox" checked={on} onChange={() => toggle(c.key)} className="sr-only" />
                <span aria-hidden className="cc-checkbox" data-on={on}>
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="cc-filter-option-label">{c.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function RosterTable({
  rows,
  currency,
  columnKeys,
  onColumnKeysChange,
  onAddCreator,
  campaignId,
}: {
  rows: RosterRow[];
  currency: string;
  /** Offers "Track this campaign's creators" when given. */
  campaignId?: string;
  /** The visible columns, held by the page so they can live in the URL. */
  columnKeys: string[];
  onColumnKeysChange: (keys: string[]) => void;
  onAddCreator: () => void;
}) {
  const [query, setQuery] = useState("");

  const columns = useMemo<DataTableColumn<RosterRow>[]>(
    () =>
      COLUMNS.filter((c) => c.locked || columnKeys.includes(c.key)).map((c) => ({
        key: c.key,
        header: c.label,
        width: c.width,
        minWidth: c.minWidth,
        align: c.align,
        sortKey: c.key,
        primary: c.locked,
        phone: c.key === "views",
        render: (r: RosterRow) => renderCell(c.key, r, currency),
      })),
    [columnKeys, currency],
  );

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.creator.name.toLowerCase().includes(q) || stripAt(r.creator.handle).toLowerCase().includes(q),
    );
  }, [rows, query]);

  // Default order is the one buildRoster already produced (views, then posts),
  // so an unsorted table looks exactly as it did.
  const { sorted, sort, toggle } = useTableSort<RosterRow>(searched, ACCESSORS, null as SortState | null);

  const empty =
    rows.length === 0 ? (
      <NoResults
        icon={<Users size={32} strokeWidth={1.75} />}
        title="No creators yet"
        description="Creators you add to this campaign will be listed here."
      />
    ) : (
      <NoResults
        title="No creators match"
        description={`Nothing on this campaign matches "${query.trim()}".`}
        onClear={() => setQuery("")}
        clearLabel="Clear search"
      />
    );

  return (
    <div>
      <ListToolbar
        search={{ value: query, onChange: setQuery, placeholder: "Search this roster" }}
        end={
          <>
            <ColumnPicker selected={columnKeys} onChange={onColumnKeysChange} />
            {campaignId && <TrackCampaignCreatorsButton campaignId={campaignId} count={rows.length} />}
          </>
        }
      />

      {/* In the campaign header, where theirs is (MEASURED at desktop-1600).
          A ds/Button rather than the hand-rolled one it replaces: the inline
          background/padding/radius out-specified every theme rule, and the
          parity harness finds the primary action through the
          `data-cc-slot="primary"` that only ds/Button emits. */}
      <CampaignHeaderActions>
        <Button variant="primary" iconLeft={<UserPlus size={14} />} onClick={onAddCreator} {...action("add-campaign-creator")}>
          Add creator
        </Button>
      </CampaignHeaderActions>

      <DataTable
        className="cc-campaign-roster"
        caption="Campaign creators"
        columns={columns}
        rows={sorted}
        rowKey={(r) => r.creator.id}
        rowHref={(r) => `/creators/${r.creator.id}`}
        sort={sort}
        onSort={toggle}
        empty={empty}
      />
    </div>
  );
}

export { COLUMNS as ROSTER_COLUMNS, DEFAULT_KEYS as ROSTER_DEFAULT_COLUMNS };
