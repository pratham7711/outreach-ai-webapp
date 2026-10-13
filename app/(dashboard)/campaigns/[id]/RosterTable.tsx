"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Card, EmptyState, Input } from "@pratham7711/ui";
import { Columns3, Search, UserPlus, Users } from "lucide-react";
import { Button, useTableSort, type SortAccessors, type SortState } from "@/components/ds";
import { formatDateAbs, stripAt, formatFull } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { CampaignHeaderActions } from "@/components/campaigns/CampaignHeaderActions";
import { action } from "@/lib/ui/actions";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import CreatorName from "@/components/creators/CreatorName";
import { TrackCampaignCreatorsButton } from "@/components/creators/TrackCreators";

/**
 * The campaign roster, with the toolbar the reference puts above it.
 *
 * The reference offers Search, Filtering, Sorting, Grouping and Add Columns over
 * this table. Search, sorting and Add Columns are here; Grouping and its saved
 * "New View" are not, and are not faked -- see the note on columns below for how
 * far the URL gets us.
 *
 * Two of the offered columns are ones the table could not previously show at
 * all: the deliverable due date, which buildRoster used to discard, and average
 * views per post. So Add Columns reveals data rather than only hiding it.
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
};

type Col = {
  key: string;
  label: string;
  width: string;
  /** Creator is the row's identity, so it is never hidden. */
  locked?: boolean;
  /** Off until someone asks for it. */
  optional?: boolean;
};

const COLUMNS: Col[] = [
  { key: "creator", label: "Creator", width: "1fr", locked: true },
  { key: "platform", label: "Platform", width: "120px" },
  { key: "followers", label: "Followers", width: "100px" },
  { key: "posts", label: "Posts", width: "80px" },
  { key: "views", label: "Views", width: "100px" },
  { key: "avgViews", label: "Avg. Views", width: "110px", optional: true },
  { key: "rate", label: "Rate", width: "100px", optional: true },
  { key: "due", label: "Due", width: "110px", optional: true },
  { key: "status", label: "Status", width: "130px" },
];

const DEFAULT_KEYS = COLUMNS.filter((c) => !c.optional).map((c) => c.key);

const ACTIVATION_STATUS: Record<string, "success" | "warning" | "danger" | "neutral" | "accent"> = {
  AWAITING_DRAFT: "warning",
  DRAFT_SUBMITTED: "accent",
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

function currencyOf(n: number, currency: string): string {
  return formatMoney(n, currency);
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

const HEAD: React.CSSProperties = {
  fontSize: "var(--cc-t-11)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--cc-text-subtle)",
  background: "none",
  border: "none",
  padding: 0,
  textAlign: "left",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const CELL: React.CSSProperties = { fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

/**
 * Which columns are on. Local rather than a shared control: Dropdown and
 * EntityPicker are both single-select, and widening the one every campaign row
 * uses for its status is a larger change than one table warrants.
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

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
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
    <div ref={box} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        style={{
          display: "flex", alignItems: "center", gap: 8, height: 38, padding: "0 14px",
          background: "var(--cc-card)", color: "var(--cc-text)",
          border: "1px solid var(--cc-border)", borderRadius: 8,
          fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        <Columns3 size={15} /> Add Columns
      </button>
      {open && (
        <div
          role="group"
          aria-label="Add Columns"
          style={{
            position: "absolute", top: 42, right: 0, zIndex: 40, minWidth: 190,
            background: "var(--cc-card)", border: "1px solid var(--cc-border)",
            borderRadius: 10, boxShadow: "var(--cc-popover-shadow)", padding: 6,
          }}
        >
          {COLUMNS.filter((c) => !c.locked).map((c) => (
            <label
              key={c.key}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "7px 8px",
                borderRadius: 8, cursor: "pointer", fontSize: "var(--cc-t-13)", color: "var(--cc-text)",
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(c.key)}
                onChange={() => toggle(c.key)}
                style={{ accentColor: "var(--cc-primary)" }}
              />
              {c.label}
            </label>
          ))}
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

  const visible = useMemo(
    () => COLUMNS.filter((c) => c.locked || columnKeys.includes(c.key)),
    [columnKeys],
  );
  const grid = visible.map((c) => c.width).join(" ");
  // The widths are fixed, so the minimum is their sum -- otherwise the columns
  // squeeze instead of the card scrolling.
  const minWidth = visible.reduce((n, c) => n + (c.width.endsWith("px") ? parseInt(c.width, 10) : 300), 0) + 60;

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

  const cell = (key: string, r: RosterRow) => {
    switch (key) {
      case "creator":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <CreatorAvatar id={r.creator.id} name={r.creator.name} size="sm" />
            <CreatorName name={r.creator.name} handle={r.creator.handle} />
          </div>
        );
      case "platform":
        return <Badge variant="neutral">{r.creator.platform}</Badge>;
      case "followers": {
        const f = unwritten(r.creator.followersCount);
        return <span style={CELL}>{f === null ? "—" : formatFull(f)}</span>;
      }
      case "posts":
        return <span style={CELL}>{r.posts}</span>;
      case "views":
        return (
          <span style={CELL} title={viewsReason(r)}>
            {r.views === null ? "—" : formatFull(r.views)}
          </span>
        );
      case "avgViews": {
        const avg = avgViewsOf(r);
        return <span style={CELL} title={viewsReason(r)}>{avg === null ? "—" : formatFull(avg)}</span>;
      }
      case "rate":
        // Null means no rate agreed, which is not a rate of nothing.
        return (
          <span style={CELL}>
            {r.creator.rate === null || r.creator.rate <= 0 ? "—" : currencyOf(r.creator.rate, currency)}
          </span>
        );
      case "due":
        return <span style={CELL}>{r.deliverableDueDate ? formatDateAbs(r.deliverableDueDate) : "—"}</span>;
      case "status":
        return r.activationStatus ? (
          <Badge variant={ACTIVATION_STATUS[r.activationStatus] ?? "neutral"} dot>
            {r.activationStatus.replace(/_/g, " ")}
          </Badge>
        ) : (
          <Badge variant="success" dot>POSTED</Badge>
        );
      default:
        return null;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", minWidth: 200 }}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search roster"
            iconLeft={<Search size={16} />}
          />
        </div>

        <ColumnPicker selected={columnKeys} onChange={onColumnKeysChange} />

        {campaignId && <TrackCampaignCreatorsButton campaignId={campaignId} count={rows.length} />}
      </div>

      {/* In the campaign header, where theirs is (MEASURED at desktop-1600).
          A ds/Button rather than the hand-rolled one it replaces: the inline
          background/padding/radius out-specified every theme rule, and the
          parity harness finds the primary action through the
          `data-cc-slot="primary"` that only ds/Button emits. */}
      <CampaignHeaderActions>
        <Button variant="primary" iconLeft={<UserPlus size={14} />} onClick={onAddCreator} {...action("add-campaign-creator")}>
          Add Creator
        </Button>
      </CampaignHeaderActions>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Users size={32} color="var(--cc-text-subtle)" />}
          title="No creators yet"
          description="Add creators to this campaign to get started."
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<Search size={32} color="var(--cc-text-subtle)" />}
          title="No creators match that search"
          description={`Nothing on this campaign matches "${query}".`}
        />
      ) : (
        <Card variant="solid" noPadding style={{ overflowX: "auto" }}>
          <div
            style={{
              display: "grid", gridTemplateColumns: grid, minWidth,
              gap: 12, padding: "12px 24px",
              borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
            }}
          >
            {visible.map((c) => (
              <button
                key={c.key}
                style={HEAD}
                onClick={() => toggle(c.key)}
                aria-label={`Sort by ${c.label}`}
              >
                {c.label}
                {sort?.key === c.key && <span aria-hidden>{sort.dir === "asc" ? "↑" : "↓"}</span>}
              </button>
            ))}
          </div>
          <div className="cc-stagger">
            {sorted.map((r, i) => (
              <Link
                key={r.creator.id}
                href={`/creators/${r.creator.id}`}
                className="cc-table-row"
                style={{
                  textDecoration: "none", display: "grid", gridTemplateColumns: grid, minWidth,
                  gap: 12, padding: "14px 24px", alignItems: "center",
                  borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                }}
              >
                {visible.map((c) => (
                  <React.Fragment key={c.key}>{cell(c.key, r)}</React.Fragment>
                ))}
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

export { COLUMNS as ROSTER_COLUMNS, DEFAULT_KEYS as ROSTER_DEFAULT_COLUMNS };
