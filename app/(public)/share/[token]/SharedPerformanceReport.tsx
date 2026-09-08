"use client";
import React, { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { BarChart3 } from "lucide-react";
import { ChartFrame } from "@/components/ds";
import type { SharedReportData } from "@/lib/reports/campaignPerformance";
import { DEFAULT_SHARE_VISIBILITY, type ShareVisibility } from "@/lib/reports/shareVisibility";
import { formatCompact } from "@/lib/format";
import { ACTIVATION_STATUS_LABEL, activationStatusBadgeStyle } from "@/lib/activationQueues";
import { platformColor } from "@/app/(dashboard)/analytics/shared";
import { BRAND, POWERED_BY } from "@/lib/brand";
import { AudioCard } from "@/components/campaigns/AudioCard";
import { shareImgSrc } from "@/lib/postMedia";
import { campaignStatusLabel } from "@/lib/statusColors";
import SharedPostList from "./SharedPostList";

const SERIES = [
  { key: "TIKTOK", color: platformColor("TIKTOK") },
  { key: "INSTAGRAM", color: platformColor("INSTAGRAM") },
  { key: "YOUTUBE", color: platformColor("YOUTUBE") },
] as const;

function formatNumber(num: number): string {
  return formatCompact(num);
}

/* The stat tiles print figures in full with separators, the way CreatorCore's do
   ("Total Views 172,328"). Compact stays for the chart axes, where a full number
   would not fit. */
function formatExact(num: number): string {
  return num.toLocaleString("en-US");
}

function formatCurrency(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

/**
 * Table-width currency. $1,135,602,774.32 is seventeen characters and ran off
 * the right edge of the card, so per-row money is compacted to $1.1B and the
 * exact figure moves to the cell's title. The KPI tiles keep the full number —
 * they have the room, and a headline figure should not be rounded.
 */
function formatCurrencyCompact(n: number, currency = "USD"): string {
  const symbol = currency === "USD" ? "$" : "";
  return symbol
    ? `${symbol}${formatCompact(n)}`
    : `${formatCompact(n)} ${currency}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderRadius: 12,
        padding: "16px 20px",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--cc-text-muted)", fontWeight: 500 }}>{label}</div>
    </div>
  );
}

export default function SharedPerformanceReport({
  token,
  campaignTitle,
  data,
  visibility = DEFAULT_SHARE_VISIBILITY,
  budget = null,
  campaignStatus = null,
}: {
  token: string;
  campaignTitle: string;
  data: SharedReportData;
  visibility?: ShareVisibility;
  /** The campaign's own status, which CreatorCore's report shows as a tile. */
  campaignStatus?: string | null;
  /** Already gated by the server — null both when hidden and when unset. */
  budget?: number | null;
}) {
  const isMobile = useIsMobile();
  /* A creator whose picture would not decode, so the circle shows their initial
     instead of an empty ring. Keyed by creator, because the same avatar can
     appear on more than one row of a re-brief. */
  const [brokenAvatars, setBrokenAvatars] = useState<Set<string>>(new Set());
  // Already redacted server-side — a hidden leaderboard arrives empty rather
  // than arriving whole and being skipped at render time.
  const { kpis, timeSeries, platformSplit, leaderboard, currency } = data;
  const showEmvColumn = leaderboard.some((r) => r.emv !== null);
  /* Engagement exists only for posts we fetched ourselves, so the column is
     dropped when no creator in this campaign has one. */
  const anyEngagementMeasured = leaderboard.some((r) => r.engagementRate !== null);
  /* Statuses come from activations, which imported campaigns have none of, so
     nothing renders when no creator on the report has one. Server-side redaction
     has already nulled these when the link hides them.

     The badge sits under the creator's name rather than in a sixth column: the
     table lives in the narrower half of a two-column layout, and a sixth column
     took its width out of the name column — which collapsed the names to
     nothing and pushed the header past the card's right edge. */
  const anyStatus = leaderboard.some((r) => r.status !== null);
  const rowCols = [
    "minmax(120px, 1fr)",
    "56px",
    "80px",
    anyEngagementMeasured ? "64px" : null,
    showEmvColumn ? "82px" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const isEmpty = kpis.views === 0 && leaderboard.length === 0 && timeSeries.length === 0;

  const kpiColumns = isMobile ? "repeat(2, 1fr)" : "repeat(3, 1fr)";
  const lowerColumns = isMobile ? "1fr" : "1fr 1.4fr";

  const kpiGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: kpiColumns,
    gap: 16,
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--cc-bg)" }}>
      {/* 1280, because the reference report measures 1256px of content at a
          1440 viewport and we were capped at 960. The narrower page was not a
          neutral choice: it is what squeezed the KPI row to five tiles where
          CreatorCore fits seven, and it left the post grid too narrow to reach
          the column count their report uses. */}
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: isMobile ? "24px 16px 64px" : "40px 24px 80px" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 32,
          }}
        >
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cc-text-muted)", marginBottom: 6 }}>
              Campaign Performance Report
            </div>
            <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
              {campaignTitle}
            </h1>
          </div>
          {!isEmpty && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {/* CreatorCore's client report offers the post list as a
                  spreadsheet, so a brand can work the numbers without asking the
                  agency for them. Secondary next to the PDF: the PDF is the
                  thing most recipients want, the CSV is for the one who models. */}
              <a
                href={`/api/share/${token}/export`}
                style={{
                  background: "var(--cc-card)",
                  color: "var(--cc-primary)",
                  border: "1.5px solid var(--cc-primary)",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Export Posts
              </a>
              <a
                href={`/api/share/${token}/pdf`}
                style={{
                  background: "var(--cc-primary)",
                  color: "var(--cc-card)",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Download PDF
              </a>
            </div>
          )}
        </div>

        {isEmpty ? (
          <div
            style={{
              background: "var(--cc-card)",
              border: "1px solid var(--cc-border)",
              borderRadius: 12,
              padding: 48,
              textAlign: "center",
            }}
          >
            <div style={{ marginBottom: 12 }}><BarChart3 size={40} color="var(--cc-text-subtle)" /></div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 6px" }}>
              No performance data yet
            </h2>
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>
              Metrics will appear here once content goes live for this campaign.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <style>{".spr-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; }"}</style>
            <div className="spr-stat-grid">
              {/* CreatorCore's client report leads with the per-counter totals and
                  breaks them out one tile each, rather than showing a single
                  combined engagement figure. A counter no post has measured has
                  no tile at all -- printing "Total Saves 0" to a brand would
                  claim a measurement the public TikTok payload never carries. */}
              <StatTile value={formatExact(kpis.posts)} label="Total Posts" />
              {/* Both of these lead CreatorCore's report. Live Posts is absent
                  rather than zero when nothing has been inspected -- see the
                  livePosts note on the seam. */}
              {kpis.livePosts !== null && (
                <StatTile value={formatExact(kpis.livePosts)} label="Live Posts" />
              )}
              {campaignStatus && (
                <StatTile value={campaignStatusLabel(campaignStatus)} label="Status" />
              )}
              <StatTile value={formatExact(kpis.views)} label="Total Views" />
              {kpis.likes !== null && (
                <StatTile value={formatExact(kpis.likes)} label="Total Likes" />
              )}
              {kpis.comments !== null && (
                <StatTile value={formatExact(kpis.comments)} label="Total Comments" />
              )}
              {kpis.shares !== null && (
                <StatTile value={formatExact(kpis.shares)} label="Total Shares" />
              )}
              {kpis.saves !== null && (
                <StatTile value={formatExact(kpis.saves)} label="Total Saves" />
              )}
              {kpis.downloads !== null && (
                <StatTile value={formatExact(kpis.downloads)} label="Total Downloads" />
              )}
              {kpis.engagements !== null && (
                <StatTile value={formatExact(kpis.engagements)} label="Total Eng." />
              )}
              {kpis.engagementRate !== null && (
                <StatTile value={`${(kpis.engagementRate * 100).toFixed(2)}%`} label="Eng. Rate" />
              )}
              {kpis.emv !== null && (
                <StatTile value={formatCurrency(kpis.emv, currency)} label="EMV" />
              )}
              {budget !== null && (
                <StatTile value={formatCurrency(budget, currency)} label="Total Budget" />
              )}
            </div>

            {/* The audio is not gated on a visibility flag: the reference report
                always shows it, and the card carries no creator, money or status
                field that a link is allowed to withhold. */}
            {data.audio ? <AudioCard audio={data.audio} shareToken={token} /> : null}

            <div
              style={{
                background: "var(--cc-card)",
                border: "1px solid var(--cc-border)",
                borderRadius: 12,
                padding: 24,
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>
                Views Over Time by Platform
              </span>
              {timeSeries.length >= 3 ? (
                <ChartFrame height={320}>
                  <AreaChart data={timeSeries} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <defs>
                      {SERIES.map((s) => (
                        <linearGradient key={s.key} id={`shareGrad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
                    <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
                    <YAxis tickFormatter={(v) => formatNumber(Number(v))} tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
                    <Tooltip
                      labelFormatter={(l) => formatDate(String(l))}
                      formatter={(v: unknown) => formatNumber(Number(v ?? 0))}
                      contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: 13 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {SERIES.map((s) => (
                      <Area
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        stackId="views"
                        stroke={s.color}
                        fill={`url(#shareGrad-${s.key})`}
                        strokeWidth={2}
                      />
                    ))}
                  </AreaChart>
                </ChartFrame>
              ) : (
                <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>
                  Views over time will appear as posts accumulate metrics.
                </p>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: lowerColumns, gap: 24 }}>
              <div
                style={{
                  background: "var(--cc-card)",
                  border: "1px solid var(--cc-border)",
                  borderRadius: 12,
                  padding: 24,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>
                  Views by Platform
                </span>
                {platformSplit.length > 0 ? (
                  <ChartFrame height={260}>
                    <PieChart>
                      <Pie
                        data={platformSplit.filter((p) => p.views > 0)}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        dataKey="views"
                        nameKey="platform"
                        paddingAngle={2}
                        label={false}
                        stroke="var(--cc-card)"
                        strokeWidth={2}
                      >
                        {platformSplit.filter((p) => p.views > 0).map((entry) => (
                          <Cell key={entry.platform} fill={platformColor(entry.platform)} />
                        ))}
                      </Pie>
                      <Legend verticalAlign="bottom" height={24} wrapperStyle={{ fontSize: 12 }} formatter={(value: unknown) => <span style={{ color: "var(--cc-text-muted)" }}>{String(value)}</span>} />
                      <Tooltip
                        formatter={(v: unknown, _n: unknown, item: { payload?: { posts?: number; platform?: string } }) => [
                          `${formatNumber(Number(v ?? 0))} views · ${item?.payload?.posts ?? 0} posts`,
                          item?.payload?.platform ?? "",
                        ]}
                        contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: 13 }}
                      />
                    </PieChart>
                  </ChartFrame>
                ) : (
                  <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0, textAlign: "center" }}>No platform data yet</p>
                  </div>
                )}
              </div>

              {/* Hidden outright rather than shown empty: "No creators yet."
                  under a deliberately withheld roster reads as a claim about
                  the campaign instead of a choice about the link. */}
              {visibility.showCreators && (
              <div
                style={{
                  background: "var(--cc-card)",
                  border: "1px solid var(--cc-border)",
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--cc-border)" }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>Top Creators</span>
                </div>
                {leaderboard.length > 0 ? (
                  <div style={{ overflowX: "auto" }}>
                    <div style={{ minWidth: isMobile ? 420 : 520 }}>
                      <div style={{
                        display: "grid", gridTemplateColumns: rowCols,
                        gap: 12, padding: "10px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
                      }}>
                        {["Creator", "Posts", "Views", ...(anyEngagementMeasured ? ["Eng."] : []), ...(showEmvColumn ? ["EMV"] : [])].map((h) => (
                          <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
                        ))}
                      </div>
                      {leaderboard.map((row, i) => (
                        <div
                          key={row.creatorId}
                          style={{
                            display: "grid", gridTemplateColumns: rowCols, gap: 12,
                            padding: "12px 24px", alignItems: "center",
                            borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <div
                              style={{
                                width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                                background: "var(--cc-primary)", color: "white", overflow: "hidden",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 12, fontWeight: 700,
                              }}
                            >
                              {/* Through the share-scoped proxy, not straight to the
                                  CDN: these avatars are image/heic and every one of
                                  them rendered as a broken box. onError falls back to
                                  the initial rather than leaving an empty circle. */}
                              {shareImgSrc(token, row.avatarUrl, 56) && !brokenAvatars.has(row.creatorId) ? (
                                <img
                                  src={shareImgSrc(token, row.avatarUrl, 56)!}
                                  alt={row.name}
                                  onError={() => setBrokenAvatars((prev) => new Set(prev).add(row.creatorId))}
                                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                />
                              ) : (
                                row.name.charAt(0).toUpperCase()
                              )}
                            </div>
                            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                              <span title={row.name} style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                              {anyStatus && row.status && (
                                <span
                                  style={{
                                    alignSelf: "flex-start",
                                    fontSize: 10, fontWeight: 700, letterSpacing: "0.02em",
                                    padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap",
                                    ...activationStatusBadgeStyle(row.status),
                                  }}
                                >
                                  {ACTIVATION_STATUS_LABEL[row.status] ?? row.status}
                                </span>
                              )}
                            </div>
                          </div>
                          <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{row.posts}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{formatNumber(row.views)}</span>
                          {anyEngagementMeasured && (
                            <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                              {row.engagementRate !== null ? `${(row.engagementRate * 100).toFixed(1)}%` : ""}
                            </span>
                          )}
                          {row.emv !== null && (
                            <span
                              title={formatCurrency(row.emv, currency)}
                              style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-primary)", whiteSpace: "nowrap" }}
                            >
                              {formatCurrencyCompact(row.emv, currency)}
                            </span>
                          )}

                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: 24, fontSize: 14, color: "var(--cc-text-muted)" }}>No creators yet.</div>
                )}
              </div>
              )}
            </div>

            {/* The list the leaderboard above summarises. Shown even on a link
                that hides creators: the numbers are the point of the report,
                and the rows arrive already stripped of who posted them.

                It sits outside the two-column grid above, and has to. As a third
                child of a two-column layout it wrapped onto a second row and
                took the narrow 370px track, so seventeen post cards rendered one
                per line down a third of the page while the 518px cell beside
                them stayed empty. Its own grid asks for repeat(auto-fill,
                minmax(280px, 1fr)) -- given the full 912px that is three columns,
                which is what it was always written to do. */}
            <SharedPostList posts={data.posts} token={token} showCreators={visibility.showCreators} />
          </div>
        )}

        <div style={{ textAlign: "center", padding: "32px 0 0" }}>
          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}>{POWERED_BY}</p>
        </div>
      </div>
    </div>
  );
}
