"use client";
import React, { useState, useEffect, useCallback, useId, useRef } from "react";
import dynamic from "next/dynamic";
import { Card, EmptyState, Skeleton } from "@pratham7711/ui";
import { ArrowUpRight, ArrowDownRight, Folder, TrendingUp, AlertTriangle, TrendingDown, Search, X } from "lucide-react";
import { campaignStatusLabel } from "@/lib/statusColors";
import { formatNumber, formatPercent, rangeToFrom, SERIES_COLORS } from "./shared";
import { loadCharts } from "@/components/charts/lazyCharts";

const CampaignComparisonLine = dynamic(() => loadCharts().then((m) => m.CampaignComparisonLine), {
  ssr: false,
  loading: () => <Skeleton width="100%" height="100%" borderRadius="8px" />,
});

type CampaignOption = { id: string; title: string; status: string };

const MAX_COMPARED = 5;
/* Enough to pick from without the list becoming the wall it replaced; typing
   narrows it. */
const MAX_OPTIONS = 50;

/**
 * Pick up to five campaigns by searching for them.
 *
 * This was every campaign in the org as a wall of buttons -- hundreds of chips
 * on an agency's account, which pushed the chart itself a few screens down and
 * had no way to find a campaign but reading. Now the chosen ones sit as chips
 * (each in its series colour, so the chip is also the legend) and the rest are
 * one search away: an ARIA combobox, arrow keys to move, Enter to add, Escape
 * to close. The campaigns are already on the page, so the filter is local.
 */
function CampaignPicker({
  campaigns, selected, colorById, onAdd, onRemove,
}: {
  campaigns: CampaignOption[];
  selected: string[];
  colorById: Record<string, string>;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const full = selected.length >= MAX_COMPARED;

  const byId = React.useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns]);
  const q = query.trim().toLowerCase();
  const matches = campaigns.filter((c) => !selected.includes(c.id) && (!q || c.title.toLowerCase().includes(q)));
  const options = matches.slice(0, MAX_OPTIONS);
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const add = (id: string) => {
    onAdd(id);
    setQuery("");
    setActive(0);
    if (selected.length + 1 >= MAX_COMPARED) setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && options[activeIndex]) {
        e.preventDefault();
        add(options[activeIndex].id);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === "Backspace" && !query && selected.length > 0) {
      onRemove(selected[selected.length - 1]);
    }
  };

  return (
    <div ref={boxRef} style={{ position: "relative", marginBottom: 20 }}>
      {selected.length > 0 && (
        <ul aria-label="Campaigns being compared" style={{ display: "flex", flexWrap: "wrap", gap: 8, listStyle: "none", margin: "0 0 10px", padding: 0 }}>
          {selected.map((id) => {
            const c = byId.get(id);
            const title = c?.title ?? id;
            return (
              <li
                key={id}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%",
                  padding: "4px 4px 4px 10px", borderRadius: 8,
                  border: "1px solid var(--cc-border)", background: "var(--cc-card)",
                  fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)",
                }}
              >
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, flexShrink: 0, background: colorById[id] ?? SERIES_COLORS[0] }} />
                <span title={title} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
                <button
                  type="button"
                  onClick={() => onRemove(id)}
                  aria-label={`Remove ${title} from the comparison`}
                  style={{
                    display: "inline-grid", placeItems: "center", width: 24, height: 24, flexShrink: 0,
                    border: "none", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--cc-text-muted)",
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <label htmlFor={inputId} className="sr-only">Add a campaign to the comparison</label>
      <div
        className="cc-picker-field"
        style={{
          display: "flex", alignItems: "center", gap: 8, height: 38, padding: "0 12px",
          border: "1px solid var(--cc-border)", borderRadius: 8, background: "var(--cc-card)",
          maxWidth: 420,
        }}
      >
        <Search size={15} color="var(--cc-text-muted)" aria-hidden="true" />
        <input
          id={inputId}
          value={query}
          disabled={full}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          /* A click in a field that already has focus fires no focus event, so
             after Escape closed the list a click has to reopen it itself. */
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={full ? `${MAX_COMPARED} selected. Remove one to add another.` : `Search ${campaigns.length} campaigns`}
          role="combobox"
          aria-expanded={open && !full}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[activeIndex] ? `${listId}-${options[activeIndex].id}` : undefined}
          autoComplete="off"
          style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", fontSize: "var(--cc-t-14)", color: "var(--cc-text)" }}
        />
      </div>

      {open && !full && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Campaigns"
          style={{
            position: "absolute", zIndex: 10, left: 0, right: 0, maxWidth: 420, marginTop: 4,
            maxHeight: 260, overflowY: "auto", padding: 4, listStyle: "none",
            background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 8,
            boxShadow: "var(--cc-popover-shadow)",
          }}
        >
          {options.length === 0 ? (
            <li style={{ padding: "10px 12px", fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
              {q ? "No campaign matches that" : "Every campaign is already selected"}
            </li>
          ) : (
            <>
              {options.map((c, i) => (
                <li
                  key={c.id}
                  id={`${listId}-${c.id}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  /* mousedown, not click: a click lands after the input's
                     blur, and this keeps focus in the field for the next one. */
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(c.id);
                  }}
                  onMouseEnter={() => setActive(i)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, minHeight: 32, padding: "6px 10px",
                    borderRadius: 6, cursor: "pointer", fontSize: "var(--cc-t-13)", color: "var(--cc-text)",
                    background: i === activeIndex ? "var(--cc-hover-bg)" : "transparent",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{c.title}</span>
                  <span style={{ flexShrink: 0, fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>{campaignStatusLabel(c.status)}</span>
                </li>
              ))}
              {matches.length > options.length && (
                <li aria-hidden="true" style={{ padding: "8px 10px", fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>
                  {matches.length - options.length} more. Type to narrow the list.
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}

type OrgDelta = { orgAvg: number | null; delta: number | null; pct: number | null };

type ComparisonRow = {
  id: string;
  title: string;
  views: number;
  engagements: number;
  engagementRate: number;
  viewsVsOrg: OrgDelta;
  engRateVsOrg: OrgDelta;
};

type ComparisonResponse = {
  campaigns: { id: string; title: string }[];
  comparison: ComparisonRow[];
  series: Record<string, number | string>[];
};

export function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null || !Number.isFinite(pct)) {
    return <span style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-subtle)" }}>—</span>;
  }
  const positive = pct >= 0;
  /* `color + "16"` appended hex alpha to whatever `color` held. That works for
     a hex literal and produces "var(--cc-success)16" for the other
     branch -- not a colour at all, so a positive delta drew its text on no
     background while a negative one got a tint. Both are tokens now, and the
     tint comes from color-mix, which takes a variable. */
  const color = positive ? "var(--cc-success)" : "var(--cc-danger)";
  const tint = `color-mix(in srgb, ${color} 12%, transparent)`;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: "var(--cc-t-11)", fontWeight: "var(--cc-fw-strong)", color, background: tint, borderRadius: 6, padding: "2px 6px" }}>
      <Icon size={11} />
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

export default function CampaignComparison({
  campaigns, range, platform,
}: {
  campaigns: CampaignOption[];
  range: string;
  platform: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [resp, setResp] = useState<ComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const add = (id: string) =>
    setSelected((prev) => (prev.includes(id) || prev.length >= MAX_COMPARED ? prev : [...prev, id]));
  const remove = (id: string) => setSelected((prev) => prev.filter((x) => x !== id));

  const load = useCallback(() => {
    if (selected.length < 2) {
      setResp(null);
      return;
    }
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    params.set("ids", selected.join(","));
    const from = rangeToFrom(range);
    if (from) params.set("from", from);
    if (platform !== "ALL") params.set("platform", platform);
    fetch(`/api/analytics/campaigns?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setResp(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [selected, range, platform]);

  useEffect(() => { load(); }, [load]);

  const titleById = Object.fromEntries((resp?.campaigns ?? []).map((c) => [c.id, c.title]));

  const colorById = React.useMemo(
    () =>
      Object.fromEntries(
        campaigns.map((c, i) => [c.id, SERIES_COLORS[i % SERIES_COLORS.length]])
      ) as Record<string, string>,
    [campaigns]
  );

  return (
    <Card variant="outlined" style={{ padding: 24, marginBottom: 24 }}>
      <style>{`.cmp-chart{height:220px;margin-bottom:24px}@media(min-width:768px){.cmp-chart{height:300px}}`}</style>
      <div style={{ marginBottom: 16 }}>
        <span className="cc-panel-title" style={{ display: "block" }}>Campaign Comparison</span>
        <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>Select 2–5 campaigns to overlay views over time.</span>
      </div>

      {campaigns.length === 0 ? (
        <EmptyState icon={<Folder size={32} color="var(--cc-text-subtle)" />} title="No campaigns" description="Create campaigns to compare their performance." />
      ) : (
        <>
          <CampaignPicker campaigns={campaigns} selected={selected} colorById={colorById} onAdd={add} onRemove={remove} />

          {selected.length < 2 ? (
            <EmptyState icon={<TrendingUp size={32} color="var(--cc-text-subtle)" />} title="Pick at least 2 campaigns" description="Search for campaigns above to see the comparison." />
          ) : loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Skeleton height="260px" borderRadius="12px" />
              <Skeleton height="120px" borderRadius="12px" />
            </div>
          ) : error || !resp ? (
            <EmptyState icon={<AlertTriangle size={32} color="var(--cc-text-subtle)" />} title="Failed to load comparison" description="Try changing your selection or filters." />
          ) : resp.series.length === 0 ? (
            <EmptyState icon={<TrendingDown size={32} color="var(--cc-text-subtle)" />} title="No time-series data" description="These campaigns have no posts in the selected range." />
          ) : (
            <>
              <div className="cmp-chart">
                <CampaignComparisonLine
                  series={resp.series}
                  selected={selected}
                  titleById={titleById}
                  colorById={colorById}
                />
              </div>

              <div className="rsp-table-wrap">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--cc-t-13)"}}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--cc-border)" }}>
                      {["Campaign", "Views", "Engagements", "Eng. Rate"].map((h, i) => (
                        <th
                          key={h}
                          className="cc-microlabel" style={{ padding: "8px 12px", textAlign: i === 0 ? "left" : "right" }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resp.comparison.map((row, i) => (
                      <tr key={row.id} style={{ borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined }}>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 3, background: colorById[row.id] ?? SERIES_COLORS[0], flexShrink: 0 }} />
                            <span style={{ fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{row.title}</span>
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <div style={{ fontWeight: 700, color: "var(--cc-text)" }}>{formatNumber(row.views)}</div>
                          <DeltaBadge pct={row.viewsVsOrg.pct} />
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--cc-text)" }}>{formatNumber(row.engagements)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <div style={{ fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{formatPercent(row.engagementRate)}</div>
                          <DeltaBadge pct={row.engRateVsOrg.pct} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-subtle)", marginTop: 12 }}>
                Delta badges compare each campaign against the org-wide average for the current filters.
              </p>
            </>
          )}
        </>
      )}
    </Card>
  );
}
