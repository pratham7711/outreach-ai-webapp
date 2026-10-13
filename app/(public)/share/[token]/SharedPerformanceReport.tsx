"use client";
import React, { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { BarChart3, Music2, Radio, CircleDot } from "lucide-react";
import { ChartFrame } from "@/components/ds/ChartFrame";
import type { SharedReportData } from "@/lib/reports/campaignPerformance";
import { DEFAULT_SHARE_VISIBILITY, type ShareVisibility } from "@/lib/reports/shareVisibility";
import { formatFull, formatCompact, platformLabel } from "@/lib/format";
import { creatorNameParts, creatorNameText } from "@/lib/creators/creatorName";
import { ACTIVATION_STATUS_LABEL, activationStatusBadgeStyle } from "@/lib/activationQueues";
import { platformColorsFor } from "@/lib/reports/shareChartPalette";
import { POWERED_BY } from "@/lib/brand";
import { AudioCard } from "@/components/campaigns/AudioCard";
import { SpotifyStreamsCard } from "@/components/campaigns/SpotifyStreamsCard";
import { shareImgSrc } from "@/lib/postMedia";
import { campaignStatusLabel } from "@/lib/statusColors";
import SharedPostList from "./SharedPostList";
import { viewsCoverageNote } from "@/lib/metricDisplay";
import { asOfCaption } from "@/lib/dataAge";

/**
 * The chart's series come from the campaign, not from a fixed triple.
 *
 * The pie beside this chart splits every post by platform while the chart only
 * ever drew TikTok, Instagram and YouTube, so a campaign carrying a Twitter or
 * Facebook post stacked to a total below the Total Views tile above it.
 *
 * Each series takes its platform's colour from the same map as the pie below
 * it (lib/reports/shareChartPalette), so TikTok is one colour in both charts.
 */
function seriesFor(platforms: string[], colorOf: (platform: string) => string): { key: string; color: string }[] {
  return platforms.map((key) => ({ key, color: colorOf(key) }));
}

/* Recharts inks each legend label and tooltip row in its series colour, which
   for a brand colour on white is under 4.5:1; the swatch carries the colour. */
const legendLabel = (value: unknown) => <span style={{ color: "var(--spr-ink-muted)" }}>{String(value)}</span>;
const TOOLTIP_STYLE = { background: "var(--spr-card)", border: "1px solid var(--spr-hairline)", borderRadius: 12, fontSize: 13, color: "var(--spr-ink)" };
const TOOLTIP_ITEM_STYLE = { color: "var(--spr-ink)" };

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

/* "Oct 6" while the series sits inside one year. One that crosses a year
   carries it, or the same axis printed "Jan 1" twice a year apart. */
function dateFormatsFor(series: { date: string }[]) {
  const multiYear = new Set(series.map((row) => row.date.slice(0, 4))).size > 1;
  const at = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  return {
    tick: (iso: string) =>
      multiYear ? `${at(iso, { month: "short", day: "numeric" })} '${iso.slice(2, 4)}` : at(iso, { month: "short", day: "numeric" }),
    label: (iso: string) => at(iso, multiYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" }),
  };
}

function StatTile({ value, label, note }: { value: string; label: string; note?: string | null }) {
  return (
    <div className="spr-tile">
      <span className="spr-tile-label">{label}</span>
      <span className="spr-tile-value" title={value}>{value}</span>
      {note && <span className="spr-tile-label" style={{ fontSize: 12 }}>{note}</span>}
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
  artworkUrl = null,
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
  /** The campaign's stored picture, for a header with no audio cover or one that will not load. */
  artworkUrl?: string | null;
}) {
  /* A creator whose picture would not decode, so the circle shows their initial
     instead of an empty ring. Keyed by creator, because the same avatar can
     appear on more than one row of a re-brief. */
  /* How many avatar sources each creator has already failed on. The stored
     picture comes first; the creator's own CDN link is the fallback for one
     the store has not reached yet; then the initial. */
  const [avatarMisses, setAvatarMisses] = useState<Record<string, number>>({});
  /* Sources are offered only after hydration: in server-rendered HTML a 404
     lands before onError is attached, and the row keeps a broken image. */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const avatarSources = (row: { creatorId: string; avatarUrl?: string | null }) =>
    !hydrated ? [] : [
      `/api/share/${encodeURIComponent(token)}/avatar/${encodeURIComponent(row.creatorId)}?w=64`,
      shareImgSrc(token, row.avatarUrl ?? null, 56),
    ].filter((u): u is string => Boolean(u));
  /* How many header pictures have failed so far: the audio's cover, then the
     campaign's own artwork, then the music-note tile. Offered after hydration
     for the same reason as the avatars. */
  const [coverMisses, setCoverMisses] = useState(0);
  // Already redacted server-side — a hidden leaderboard arrives empty rather
  // than arriving whole and being skipped at render time.
  const { kpis, timeSeries, seriesPlatforms, platformSplit, leaderboard, currency } = data;
  /* One colour per platform for both charts, handed out biggest first, so the
     platform with the most views keeps its brand colour if two would clash. */
  const colorOrder = [...platformSplit.map((p) => p.platform), ...seriesPlatforms.filter((k) => !platformSplit.some((p) => p.platform === k))];
  const colorList = platformColorsFor(colorOrder);
  const colorOf = (platform: string) => colorList[colorOrder.indexOf(platform)] ?? colorList[0];
  /* Stacked areas draw every series, so a platform with no views still paints
     its stroke along the top of the stack -- a TikTok-only campaign showed a
     green "YouTube" line (measured on the misery - pupsies report). Only
     platforms that actually have views get an area and a legend entry. */
  const activeSeries = seriesFor(seriesPlatforms, colorOf).filter((s) =>
    timeSeries.some((row) => Number(row[s.key] ?? 0) > 0)
  );
  /* Engagement exists only for posts we fetched ourselves, so the column is
     dropped when no creator in this campaign has one. */
  const anyEngagementMeasured = leaderboard.some((r) => r.engagementRate !== null);
  /* Statuses come from activations, which imported campaigns have none of, so
     nothing renders when no creator on the report has one. Server-side redaction
     has already nulled these when the link hides them. */
  const anyStatus = leaderboard.some((r) => r.status !== null);
  /* The head and every row are separate grids, so the Views track has to be
     fixed rather than sized to content -- but a fixed 68px let a creator with
     1,822,665,537 views run into the Eng. column on a phone. It grows to the
     longest figure on the board at 8px a character, which the cells' 13px
     digits fit. Not ch: the head is 11px, so ch would size its grid narrower
     than the rows' and the headings would drift off their columns. */
  const viewsPx = 8 * Math.max(0, ...leaderboard.map((r) => (r.views === null ? 1 : formatNumber(r.views).length)));
  const rowCols = ["minmax(120px, 1fr)", "56px", `${Math.max(104, viewsPx)}px`, anyEngagementMeasured ? "64px" : null]
    .filter(Boolean)
    .join(" ");
  // A phone's card is ~284px wide, so the desktop tracks forced a sideways
  // scroll inside the card. These fit it, and the name takes whatever is left.
  const rowColsPhone = ["minmax(0, 1fr)", "44px", `${Math.max(68, viewsPx)}px`, anyEngagementMeasured ? "44px" : null]
    .filter(Boolean)
    .join(" ");
  const boardCols = { "--spr-board-cols": rowCols, "--spr-board-cols-phone": rowColsPhone } as React.CSSProperties;

  const isEmpty = kpis.views === 0 && leaderboard.length === 0 && timeSeries.length === 0;
  /* When the total was read, and how many posts it covers -- the line the
     agency's Performance tab carries under the same tile. A report cached
     before kpis.asOf existed keeps the coverage note alone. */
  const viewsNote =
    kpis.asOf !== undefined
      ? asOfCaption(kpis.asOf, { known: kpis.viewsKnownPosts, total: kpis.posts, what: "views" })
      : viewsCoverageNote(kpis.viewsKnownPosts, kpis.posts);
  /* A sum over no read post is unknown, not 0 -- e.g. a campaign of Instagram
     photos, which publish no view count. */
  const viewsUnknown = kpis.viewsKnownPosts === 0 && kpis.posts > 0;
  const coverSources = !hydrated
    ? []
    : [...new Set([data.audio?.coverUrl, artworkUrl].map((u) => shareImgSrc(token, u ?? null, 302)))].filter(
        (u): u is string => Boolean(u)
      );
  const cover = coverSources[coverMisses] ?? null;
  const hasSplit = platformSplit.some((p) => p.views > 0);
  const slices = platformSplit.filter((p) => p.views > 0);
  const dates = dateFormatsFor(timeSeries);
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
              key={cover}
              onError={() => setCoverMisses((n) => n + 1)}
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
                {/* Four tiles in a column this width auto-fit three to a row
                    and stranded the fourth under them; two by two keeps the
                    grid square and gives the views note room to finish. */}
                <div
                  className="spr-tiles"
                  style={kpis.engagementRate !== null && kpis.engagements !== null ? { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } : undefined}
                >
                  {/* The count was only in the Posts section at the foot of the
                      page, three screens down on a phone, so a client reading
                      the summary saw views with no idea how many posts made them. */}
                  <StatTile value={formatExact(kpis.posts)} label="Total Posts" />
                  <StatTile value={viewsUnknown ? "\u2014" : formatCompact(kpis.views)} label="Total Views" note={viewsNote} />
                  {kpis.engagementRate !== null && (
                    <StatTile value={`${(kpis.engagementRate * 100).toFixed(2)}%`} label="Eng. Rate" />
                  )}
                  {kpis.engagements !== null && (
                    <StatTile value={formatCompact(kpis.engagements)} label="Total Eng." />
                  )}
                </div>
                <h3 className="spr-subhead">Views Over Time</h3>
                {timeSeries.length >= 3 ? (
                  /* 250, the reference canvas's own height. No <defs>: the
                     reference's bands are flat fills, and no CartesianGrid --
                     a pixel scan down three columns of its chart crosses no
                     grid line at any y. */
                  <ChartFrame height={250}>
                    <AreaChart data={timeSeries} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                      <XAxis dataKey="date" tickFormatter={dates.tick} minTickGap={14} tick={{ fontSize: 12, fill: "var(--spr-chart-axis)" }} />
                      <YAxis tickFormatter={(v) => formatCompact(Number(v))} tick={{ fontSize: 12, fill: "var(--spr-chart-axis)" }} width={64} />
                      <Tooltip
                        labelFormatter={(l) => dates.label(String(l))}
                        formatter={(v: unknown) => formatNumber(Number(v ?? 0))}
                        contentStyle={TOOLTIP_STYLE}
                        itemStyle={TOOLTIP_ITEM_STYLE}
                      />
                      <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} formatter={legendLabel} />
                      {activeSeries.map((s) => (
                        <Area
                          isAnimationActive={false}
                          key={s.key}
                          type="monotone"
                          dataKey={s.key}
                          name={platformLabel(s.key)}
                          /* Solid. The app's light and dark themes dash series 2-5
                             so their greys can be told apart, and that rule reached
                             this chart as a dotted line along the top of the stack;
                             it stands down for any series that sets its own dash. */
                          strokeDasharray="0"
                          stackId="views"
                          /* Stroked in its own colour, so a platform too small to
                             show a band at this scale still draws a line. */
                          stroke={s.color}
                          fill={s.color}
                          fillOpacity={1}
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

            {/* A row of its own: the row above pairs two cards from 1440 up,
                and a third would sit half-width under the views chart. */}
            {data.streams ? (
              <div className="spr-row">
                <SpotifyStreamsCard streams={data.streams} variant="report" />
              </div>
            ) : null}

            {(hasSplit || showBoard) && (
              <div className="spr-row">
                {hasSplit && (
                  <section className="spr-card spr-stack">
                    <h2 className="spr-section">Views by Platform</h2>
                    <ChartFrame height={220}>
                      <PieChart>
                        <Pie
                          isAnimationActive={false}
                          data={slices}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={85}
                          dataKey="views"
                          nameKey="platform"
                          paddingAngle={2}
                          label={false}
                          stroke="var(--spr-card)"
                          strokeWidth={slices.length > 1 ? 2 : 0}
                        >
                          {slices.map((entry) => (
                            <Cell key={entry.platform} fill={colorOf(entry.platform)} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v: unknown, _n: unknown, item: { payload?: { posts?: number; platform?: string } }) => {
                            const posts = item?.payload?.posts ?? 0;
                            return [
                              `${formatNumber(Number(v ?? 0))} views · ${posts} post${posts === 1 ? "" : "s"}`,
                              platformLabel(item?.payload?.platform),
                            ];
                          }}
                          contentStyle={TOOLTIP_STYLE}
                          itemStyle={TOOLTIP_ITEM_STYLE}
                        />
                      </PieChart>
                    </ChartFrame>
                    {/* The figures in plain text rather than only in a hover
                        tooltip, which a phone never shows until the slice is
                        tapped. Every platform with a post is listed, including
                        one whose views are not known yet and so has no slice. */}
                    <ul className="spr-split">
                      {platformSplit.map((p) => {
                        return (
                          <li key={p.platform} className="spr-split-row">
                            <span className="spr-split-swatch" style={{ background: p.views > 0 ? colorOf(p.platform) : "var(--spr-hairline)" }} aria-hidden="true" />
                            <span className="spr-split-name">{platformLabel(p.platform)}</span>
                            <span className="spr-split-figure">{p.views > 0 ? `${formatNumber(p.views)} views` : "Views not known yet"}</span>
                            <span className="spr-split-figure">{p.posts} post{p.posts === 1 ? "" : "s"}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {/* Hidden outright rather than shown empty: "No creators yet."
                    under a deliberately withheld roster reads as a claim about
                    the campaign instead of a choice about the link. */}
                {showBoard && (
                  <section className="spr-card spr-stack">
                    <h2 className="spr-section">Top Creators</h2>
                    <div style={{ overflowX: "auto" }}>
                      <div className="spr-board" style={boardCols}>
                        <div className="spr-board-head">
                          {["Creator", "Posts", "Views", ...(anyEngagementMeasured ? ["Eng."] : [])].map((h) => (
                            <span key={h}>{h}</span>
                          ))}
                        </div>
                        {leaderboard.map((row) => (
                          <div key={row.creatorId} className="spr-board-row">
                            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                              <div className="spr-avatar">
                                {/* Through the share-scoped proxy, not straight to the
                                    CDN: these avatars are image/heic and every one of
                                    them rendered as a broken box. onError falls back to
                                    the initial rather than leaving an empty circle. */}
                                {avatarSources(row)[avatarMisses[row.creatorId] ?? 0] ? (
                                  <img
                                    key={avatarMisses[row.creatorId] ?? 0}
                                    src={avatarSources(row)[avatarMisses[row.creatorId] ?? 0]}
                                    alt={row.name}
                                    onError={() =>
                                      setAvatarMisses((prev) => ({ ...prev, [row.creatorId]: (prev[row.creatorId] ?? 0) + 1 }))
                                    }
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                  />
                                ) : (
                                  row.name.charAt(0).toUpperCase()
                                )}
                              </div>
                              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                                <span className="spr-board-name" title={creatorNameText(row.name, row.handle)}>
                                  {creatorNameParts(row.name, row.handle).name}
                                </span>
                                {creatorNameParts(row.name, row.handle).handle && (
                                  <span className="spr-board-handle">{creatorNameParts(row.name, row.handle).handle}</span>
                                )}
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
                            <span className="spr-board-cell-strong">{row.views === null ? "—" : formatNumber(row.views)}</span>
                            {anyEngagementMeasured && (
                              <span className="spr-board-cell">
                                {row.engagementRate !== null ? `${(row.engagementRate * 100).toFixed(2)}%` : "—"}
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
                <StatTile value={viewsUnknown ? "\u2014" : formatExact(kpis.views)} label="Total Views" note={viewsNote} />
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
