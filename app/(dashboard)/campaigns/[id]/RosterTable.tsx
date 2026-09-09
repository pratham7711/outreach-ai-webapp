"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Avatar, Badge, Card, EmptyState, Input } from "@pratham7711/ui";
import { Columns3, Search, UserPlus, Users } from "lucide-react";
import { useTableSort, type SortAccessors, type SortState } from "@/components/ds";
import { formatDateAbs, stripAt, formatFull } from "@/lib/format";

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
  views: number;
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
  { key: "rate", label: "Rate", width: "100px" },
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

function currencyOf(n: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n);
}

const ACCESSORS: SortAccessors<RosterRow> = {
  creator: (r) => r.creator.name,
  platform: (r) => r.creator.platform,
  followers: (r) => unwritten(r.creator.followersCount),
  posts: (r) => r.posts,
  views: (r) => r.views,
  avgViews: (r) => (r.posts > 0 ? Math.round(r.views / r.posts) : null),
  rate: (r) => (r.creator.rate && r.creator.rate > 0 ? r.creator.rate : null),
  due: (r) => r.deliverableDueDate,
  status: (r) => r.activationStatus ?? "POSTED",
};

const HEAD: React.CSSProperties = {
  fontSize: 11,
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

const CELL: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--cc-text)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

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
          fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
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
            borderRadius: 10, boxShadow: "0 8px 24px rgba(28, 32, 72, 0.12)", padding: 6,
          }}
        >
          {COLUMNS.filter((c) => !c.locked).map((c) => (
            <label
              key={c.key}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "7px 8px",
                borderRadius: 8, cursor: "pointer", fontSize: 13, color: "var(--cc-text)",
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
}: {
  rows: RosterRow[];
  currency: string;
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
            <Avatar name={r.creator.name} size="sm" src={r.creator.avatarUrl ?? undefined} />
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{r.creator.name}</p>
              <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{stripAt(r.creator.handle)}</p>
            </div>
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
        return <span style={CELL}>{formatFull(r.views)}</span>;
      case "avgViews":
        return <span style={CELL}>{r.posts > 0 ? formatFull(Math.round(r.views / r.posts)) : "—"}</span>;
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

        <button
          onClick={onAddCreator}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "var(--cc-primary)", color: "white", border: "none",
            borderRadius: 8, padding: "9px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}
        >
          <UserPlus size={14} /> Add Creator
        </button>
      </div>

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
