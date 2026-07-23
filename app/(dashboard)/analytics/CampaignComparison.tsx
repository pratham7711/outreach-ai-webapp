"use client";
import React, { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Card, EmptyState, Skeleton } from "@pratham7711/ui";
import { ArrowUpRight, ArrowDownRight, Folder, TrendingUp, AlertTriangle, TrendingDown } from "lucide-react";
import { formatNumber, formatCurrency, formatPercent, rangeToFrom, SERIES_COLORS } from "./shared";

const CampaignComparisonLine = dynamic(() => import("./AnalyticsCharts").then((m) => m.CampaignComparisonLine), {
  ssr: false,
  loading: () => <Skeleton width="100%" height="100%" borderRadius="8px" />,
});

type CampaignOption = { id: string; title: string; status: string };

type OrgDelta = { orgAvg: number | null; delta: number | null; pct: number | null };

type ComparisonRow = {
  id: string;
  title: string;
  views: number;
  engagements: number;
  engagementRate: number;
  emv: number;
  viewsVsOrg: OrgDelta;
  engRateVsOrg: OrgDelta;
  emvVsOrg: OrgDelta;
};

type ComparisonResponse = {
  campaigns: { id: string; title: string }[];
  comparison: ComparisonRow[];
  series: Record<string, number | string>[];
};

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null || !Number.isFinite(pct)) {
    return <span style={{ fontSize: 11, color: "var(--cc-text-subtle)" }}>—</span>;
  }
  const positive = pct >= 0;
  const color = positive ? "#10B981" : "#DC2626";
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 600, color, background: color + "16", borderRadius: 6, padding: "2px 6px" }}>
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

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  };

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

  return (
    <Card variant="outlined" style={{ padding: 24, marginBottom: 24 }}>
      <style>{`.cmp-chart{height:220px;margin-bottom:24px}@media(min-width:768px){.cmp-chart{height:300px}}`}</style>
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block" }}>Campaign Comparison</span>
        <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>Select 2–5 campaigns to overlay views over time.</span>
      </div>

      {campaigns.length === 0 ? (
        <EmptyState icon={<Folder size={32} color="var(--cc-text-subtle)" />} title="No campaigns" description="Create campaigns to compare their performance." />
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {campaigns.map((c) => {
              const isSel = selected.includes(c.id);
              const atLimit = !isSel && selected.length >= 5;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={atLimit}
                  onClick={() => toggle(c.id)}
                  style={{
                    border: isSel ? "1.5px solid var(--cc-primary)" : "1px solid var(--cc-border)",
                    background: isSel ? "var(--cc-primary)" : "var(--cc-card)",
                    color: isSel ? "#fff" : atLimit ? "var(--cc-text-subtle)" : "var(--cc-text)",
                    borderRadius: 8,
                    padding: "6px 12px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: atLimit ? "not-allowed" : "pointer",
                    maxWidth: 220,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.title}
                </button>
              );
            })}
          </div>

          {selected.length < 2 ? (
            <EmptyState icon={<TrendingUp size={32} color="var(--cc-text-subtle)" />} title="Pick at least 2 campaigns" description="Choose campaigns above to see the comparison." />
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
                <CampaignComparisonLine series={resp.series} selected={selected} titleById={titleById} />
              </div>

              <div className="rsp-table-wrap">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--cc-border)" }}>
                      {["Campaign", "Views", "Engagements", "Eng. Rate", "EMV"].map((h, i) => (
                        <th
                          key={h}
                          style={{
                            padding: "8px 12px",
                            textAlign: i === 0 ? "left" : "right",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--cc-text-subtle)",
                            textTransform: "uppercase",
                            letterSpacing: 0.4,
                          }}
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
                            <span style={{ width: 10, height: 10, borderRadius: 3, background: SERIES_COLORS[i % SERIES_COLORS.length], flexShrink: 0 }} />
                            <span style={{ fontWeight: 600, color: "var(--cc-text)" }}>{row.title}</span>
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <div style={{ fontWeight: 700, color: "var(--cc-text)" }}>{formatNumber(row.views)}</div>
                          <DeltaBadge pct={row.viewsVsOrg.pct} />
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--cc-text)" }}>{formatNumber(row.engagements)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <div style={{ fontWeight: 600, color: "var(--cc-text)" }}>{formatPercent(row.engagementRate)}</div>
                          <DeltaBadge pct={row.engRateVsOrg.pct} />
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <div style={{ fontWeight: 600, color: "var(--cc-text)" }}>{formatCurrency(row.emv)}</div>
                          <DeltaBadge pct={row.emvVsOrg.pct} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 11, color: "var(--cc-text-subtle)", marginTop: 12 }}>
                Delta badges compare each campaign against the org-wide average for the current filters.
              </p>
            </>
          )}
        </>
      )}
    </Card>
  );
}
