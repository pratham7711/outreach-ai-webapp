"use client";
import React, { useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { BarChart3, Music2, Radio, CircleDot } from "lucide-react";
import { ChartFrame } from "@/components/ds";
import type { SharedReportData } from "@/lib/reports/campaignPerformance";
import { DEFAULT_SHARE_VISIBILITY, type ShareVisibility } from "@/lib/reports/shareVisibility";
import { formatFull, formatCompact } from "@/lib/format";
import { ACTIVATION_STATUS_LABEL, activationStatusBadgeStyle } from "@/lib/activationQueues";
import { platformColor } from "@/app/(dashboard)/analytics/shared";
import { POWERED_BY } from "@/lib/brand";
import { AudioCard } from "@/components/campaigns/AudioCard";
import { shareImgSrc } from "@/lib/postMedia";
import { campaignStatusLabel } from "@/lib/statusColors";
import SharedPostList from "./SharedPostList";

/**
 * The chart's series come from the campaign, not from a fixed triple.
 *
 * The pie beside this chart splits every post by platform while the chart only
 * ever drew TikTok, Instagram and YouTube, so a campaign carrying a Twitter or
 * Facebook post stacked to a total below the Total Views tile above it.
 * platformColor falls back to a generic series token for a platform with no
 * colour of its own, so nothing has to be added here when one appears.
 */
function seriesFor(platforms: string[]): { key: string; color: string }[] {
  return platforms.map((key, i) => ({ key, color: platformColor(key, i) }));
}

function formatNumber(num: number): string {
  return formatFull(num);
}

/* The stat tiles print figures in full with separators, the way the reference
   client report does ("Total Views 186,242"). Compact stays for the chart axes,
   where a full number would not fit. */
function formatExact(num: number): string {
  return num.toLocaleString("en-US");
}

function formatCurrency(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="spr-tile">
      <span className="spr-tile-label">{label}</span>
      <span className="spr-tile-value" title={value}>{value}</span>
    </div>
  );
}

/**
 * The public client report.
 *
 * Laid out against the reference client report rather than against the
 * dashboard: a brand who followed this link is comparing it to the report the
 * agency used to send them, and every measurement here -- the 1296px column,
 * the 20px cards, the black stat tiles, the 5/2/1 post grid -- was read off
 * that page with getComputedStyle at 1440, 768 and 390. The palette is the
 * report's own, declared on .spr-root in globals.css, so it renders the same
 * whichever theme the recipient's machine happens to be in.
 */
export default function SharedPerformanceReport({
  token,
  campaignTitle,
  orgName = null,
  data,
  visibility = DEFAULT_SHARE_VISIBILITY,
  budget = null,
  campaignStatus = null,
}: {
  token: string;
  campaignTitle: string;
  /** The agency whose client this is — the reference puts their mark top-left. */
  orgName?: string | null;
  data: SharedReportData;
  visibility?: ShareVisibility;
  /** The campaign's own status, which the reference report shows as a fact. */
  campaignStatus?: string | null;
  /** Already gated by the server — null both when hidden and when unset. */
  budget?: number | null;
}) {
  /* A creator whose picture would not decode, so the circle shows their initial
     instead of an empty ring. Keyed by creator, because the same avatar can
     appear on more than one row of a re-brief. */
  const [brokenAvatars, setBrokenAvatars] = useState<Set<string>>(new Set());
  const [coverBroken, setCoverBroken] = useState(false);
  // Already redacted server-side — a hidden leaderboard arrives empty rather
  // than arriving whole and being skipped at render time.
  const { kpis, timeSeries, seriesPlatforms, platformSplit, leaderboard, currency } = data;
  /* Stacked areas draw every series, so a platform with no views still paints
     its stroke along the top of the stack -- a TikTok-only campaign showed a
     green "YouTube" line (measured on the misery - pupsies report). Only
     platforms that actually have views get an area and a legend entry. */
  const activeSeries = seriesFor(seriesPlatforms).filter((s) =>
    timeSeries.some((row) => Number(row[s.key] ?? 0) > 0)
  );
  /* Engagement exists only for posts we fetched ourselves, so the column is
     dropped when no creator in this campaign has one. */
  const anyEngagementMeasured = leaderboard.some((r) => r.engagementRate !== null);
  /* Statuses come from activations, which imported campaigns have none of, so
     nothing renders when no creator on the report has one. Server-side redaction
     has already nulled these when the link hides them. */
  const anyStatus = leaderboard.some((r) => r.status !== null);
  const rowCols = ["minmax(120px, 1fr)", "56px", "104px", anyEngagementMeasured ? "64px" : null]
    .filter(Boolean)
    .join(" ");

  const isEmpty = kpis.views === 0 && leaderboard.length === 0 && timeSeries.length === 0;
  const cover = coverBroken ? null : shareImgSrc(token, data.audio?.coverUrl ?? null, 302);
  const hasSplit = platformSplit.some((p) => p.views > 0);
  const showBoard = visibility.showCreators && leaderboard.length > 0;

  return (
    <div className="spr-root">
      <header className="spr-topbar">
        <div className="spr-wrap spr-topbar-in">
          <span className="spr-brand">{orgName ?? POWERED_BY}</span>
          {!isEmpty && (
            <div className="spr-actions">
              {/* The reference offers the post list as a spreadsheet, so a brand
                  can work the numbers without asking the agency for them. */}
              <a className="spr-btn" href={`/api/share/${token}/export`}>Export Posts</a>
              <a className="spr-btn" href={`/api/share/${token}/pdf`}>Download PDF</a>
            </div>
          )}
        </div>
      </header>

      <main className="spr-wrap spr-main">
        <section className="spr-card spr-head">
          {cover ? (
            <img
              className="spr-cover"
              src={cover}
              alt=""
              onError={() => setCoverBroken(true)}
            />
          ) : (
            <div className="spr-cover spr-cover-fallback" aria-hidden="true">
              <Music2 size={40} />
            </div>
          )}
          <div className="spr-head-body">
            <h1 className="spr-title">{campaignTitle}</h1>
            <div className="spr-facts">
              {/* Live Posts is absent rather than zero when nothing has been
                  inspected -- see the livePosts note on the seam. */}
              {kpis.livePosts !== null && (
                <div className="spr-fact">
                  <span className="spr-section">Live Posts</span>
                  <div className="spr-fact-pill">
                    <Radio size={18} aria-hidden="true" />
                    <span>{formatExact(kpis.livePosts)}</span>
                  </div>
                </div>
              )}
              {campaignStatus && (
                <div className="spr-fact">
                  <span className="spr-section">Status</span>
                  <div className="spr-fact-pill">
                    <CircleDot size={18} aria-hidden="true" />
                    <span>{campaignStatusLabel(campaignStatus)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {isEmpty ? (
          <section className="spr-card spr-empty">
            <div style={{ marginBottom: 12 }}><BarChart3 size={40} color="var(--spr-label)" /></div>
            <h2 className="spr-subhead" style={{ marginBottom: 6 }}>No performance data yet</h2>
            <p className="spr-note">
              Metrics will appear here once content goes live for this campaign.
            </p>
          </section>
        ) : (
          <>
            <div className="spr-row">
              <section className="spr-card spr-stack">
                <h2 className="spr-section">Post Performance</h2>
                {/* The three the reference leads with, in its order. A counter no
                    post has measured has no tile at all -- printing "Total Eng. 0"
                    to a brand would claim a measurement nobody ever took. */}
                <div className="spr-tiles">
                  <StatTile value={formatCompact(kpis.views)} label="Total Views" />
                  {kpis.engagementRate !== null && (
                    <StatTile value={`${(kpis.engagementRate * 100).toFixed(2)}%`} label="Eng. Rate" />
                  )}
                  {kpis.engagements !== null && (
                    <StatTile value={formatCompact(kpis.engagements)} label="Total Eng." />
                  )}
                </div>
                <h3 className="spr-subhead">Views Over Time</h3>
                {timeSeries.length >= 3 ? (
                  <ChartFrame height={280}>
                    <AreaChart data={timeSeries} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                      <defs>
                        {activeSeries.map((s) => (
                          <linearGradient key={s.key} id={`shareGrad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--spr-grid)" />
                      <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 12, fill: "var(--spr-label)" }} />
                      <YAxis tickFormatter={(v) => formatCompact(Number(v))} tick={{ fontSize: 12, fill: "var(--spr-label)" }} width={64} />
                      <Tooltip
                        labelFormatter={(l) => formatDate(String(l))}
                        formatter={(v: unknown) => formatNumber(Number(v ?? 0))}
                        contentStyle={{ background: "var(--spr-card)", border: "1px solid var(--spr-hairline)", borderRadius: 12, fontSize: 13, color: "var(--spr-ink)" }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, color: "var(--spr-label)" }} />
                      {activeSeries.map((s) => (
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
                  <p className="spr-note">Views over time will appear as posts accumulate metrics.</p>
                )}
              </section>

              {/* The audio is not gated on a visibility flag: the reference report
                  always shows it, and the card carries no creator, money or status
                  field that a link is allowed to withhold. */}
              {/* No wrapper: the report variant renders its own .spr-card, so
                  it sits in the row grid directly the way every other card does. */}
              {data.audio ? (
                <AudioCard audio={data.audio} shareToken={token} variant="report" />
              ) : null}
            </div>

            {(hasSplit || showBoard) && (
              <div className="spr-row">
                {hasSplit && (
                  <section className="spr-card spr-stack">
                    <h2 className="spr-section">Views by Platform</h2>
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
                          stroke="var(--spr-card)"
                          strokeWidth={2}
                        >
                          {platformSplit.filter((p) => p.views > 0).map((entry) => (
                            <Cell key={entry.platform} fill={platformColor(entry.platform)} />
                          ))}
                        </Pie>
                        <Legend verticalAlign="bottom" height={24} wrapperStyle={{ fontSize: 12 }} formatter={(value: unknown) => <span style={{ color: "var(--spr-label)" }}>{String(value)}</span>} />
                        <Tooltip
                          formatter={(v: unknown, _n: unknown, item: { payload?: { posts?: number; platform?: string } }) => [
                            `${formatNumber(Number(v ?? 0))} views · ${item?.payload?.posts ?? 0} posts`,
                            item?.payload?.platform ?? "",
                          ]}
                          contentStyle={{ background: "var(--spr-card)", border: "1px solid var(--spr-hairline)", borderRadius: 12, fontSize: 13, color: "var(--spr-ink)" }}
                        />
                      </PieChart>
                    </ChartFrame>
                  </section>
                )}

                {/* Hidden outright rather than shown empty: "No creators yet."
                    under a deliberately withheld roster reads as a claim about
                    the campaign instead of a choice about the link. */}
                {showBoard && (
                  <section className="spr-card spr-stack">
                    <h2 className="spr-section">Top Creators</h2>
                    <div style={{ overflowX: "auto" }}>
                      <div style={{ minWidth: 380 }}>
                        <div className="spr-board-head" style={{ gridTemplateColumns: rowCols }}>
                          {["Creator", "Posts", "Views", ...(anyEngagementMeasured ? ["Eng."] : [])].map((h) => (
                            <span key={h}>{h}</span>
                          ))}
                        </div>
                        {leaderboard.map((row) => (
                          <div key={row.creatorId} className="spr-board-row" style={{ gridTemplateColumns: rowCols }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                              <div className="spr-avatar">
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
                                <span className="spr-board-name" title={row.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {row.name}
                                </span>
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
                            <span className="spr-board-cell">{row.posts}</span>
                            <span className="spr-board-cell-strong">{formatNumber(row.views)}</span>
                            {anyEngagementMeasured && (
                              <span className="spr-board-cell">
                                {row.engagementRate !== null ? `${(row.engagementRate * 100).toFixed(1)}%` : ""}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>
                )}
              </div>
            )}

            <section className="spr-card spr-stack">
              <h2 className="spr-section">Posts</h2>
              {/* The reference breaks the totals out one tile each above the post
                  grid, in this order, and omits any counter nothing measured. */}
              <div className="spr-tiles spr-tiles-compact">
                <StatTile value={formatExact(kpis.posts)} label="Total Posts" />
                <StatTile value={formatExact(kpis.views)} label="Total Views" />
                {kpis.likes !== null && <StatTile value={formatExact(kpis.likes)} label="Total Likes" />}
                {kpis.comments !== null && <StatTile value={formatExact(kpis.comments)} label="Total Comments" />}
                {kpis.shares !== null && <StatTile value={formatExact(kpis.shares)} label="Total Shares" />}
                {kpis.saves !== null && <StatTile value={formatExact(kpis.saves)} label="Total Saves" />}
                {kpis.downloads !== null && <StatTile value={formatExact(kpis.downloads)} label="Total Downloads" />}
                {budget !== null && <StatTile value={formatCurrency(budget, currency)} label="Total Budget" />}
              </div>
              {/* The list the leaderboard above summarises. Shown even on a link
                  that hides creators: the numbers are the point of the report,
                  and the rows arrive already stripped of who posted them. */}
              <SharedPostList posts={data.posts} token={token} showCreators={visibility.showCreators} />
            </section>
          </>
        )}
      </main>

      <div className="spr-footer">{POWERED_BY}</div>
    </div>
  );
}
