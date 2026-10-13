"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Card, Badge, EmptyState, Skeleton, Modal } from "@pratham7711/ui";
import { MetricTile, Button } from "@/components/ds";
import { ChartFrame } from "@/components/ds/ChartFrame";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Eye, Heart, Percent, DollarSign, Target, TrendingUp, AlertTriangle, BarChart3, PieChart as PieChartIcon, Trophy, Download } from "lucide-react";
import { formatFull, formatCompact } from "@/lib/format";
import { platformColor } from "@/app/(dashboard)/analytics/shared";
import { AudioCard } from "@/components/campaigns/AudioCard";
import type { CampaignAudio, CampaignPerformance } from "@/lib/reports/campaignPerformance";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import CreatorName from "@/components/creators/CreatorName";
import { viewsCoverageNote } from "@/lib/metricDisplay";
import { asOfCaption } from "@/lib/dataAge";
import { chartDateAxis, sortByDate } from "@/lib/reports/chartDates";
import { platformSeriesColor } from "@/lib/reports/platformSeriesColor";

/* Taken from the report seam rather than restated here. It was restated, and the
   two drifted the moment the seam grew the per-counter totals. */
type Kpis = CampaignPerformance["kpis"];

const LEADERBOARD_COLS = (withEngagement: boolean) =>
  withEngagement ? "1fr 70px 90px 80px" : "1fr 70px 90px";

/** One key per platform the campaign posted on — see lib/reports/campaignPerformance. */
type TimeSeriesPoint = { date: string } & { [platform: string]: number | string };
type PlatformSplit = { platform: string; views: number; posts: number };
type LeaderboardRow = {
  creatorId: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  posts: number;
  views: number | null;
  engagements: number | null;
  engagementRate: number | null;
};

type PerformanceData = {
  currency: string;
  kpis: Kpis;
  timeSeries: TimeSeriesPoint[];
  /** The keys in `timeSeries`, in the order the chart should stack them. */
  seriesPlatforms: string[];
  platformSplit: PlatformSplit[];
  leaderboard: LeaderboardRow[];
  /** Null when the campaign has no song, or a song with no tracked sound. */
  audio: CampaignAudio | null;
};

/**
 * The chart's series come from the campaign, not from a fixed triple.
 *
 * The pie beside this chart splits every post by platform while the chart only
 * ever drew TikTok, Instagram and YouTube, so a campaign carrying a Twitter or
 * Facebook post stacked to a total below the Total Views tile above it.
 * platformColor falls back to a generic series token for a platform with no
 * colour of its own, so nothing has to be added here when one appears.
 */
function seriesFor(platforms: string[]): { key: string; color: string; solid: boolean }[] {
  /* Each platform in its own colour rather than the theme's grey ramp, which
     made three series near-identical in light. See platformSeriesColor. */
  return platforms.map((key, i) => ({ key, ...platformSeriesColor(key, platformColor(key, i)) }));
}

function formatNumber(num: number): string {
  return formatFull(num);
}

function LoadingState() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <style>{`
        .perf-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; align-items: start; }
        @media (min-width: 1024px) { .perf-split { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); } }
      `}</style>
      <div className="rsp-grid-tiles">
        {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} height="88px" borderRadius="12px" />)}
      </div>
      <Skeleton width="100%" height="320px" borderRadius="12px" />
      <div className="perf-split">
        <Skeleton width="100%" height="300px" borderRadius="12px" />
        <Skeleton width="100%" height="300px" borderRadius="12px" />
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card variant="outlined" style={{ padding: 32 }}>
      <EmptyState
        icon={<AlertTriangle size={32} color="var(--cc-text-subtle)" />}
        title="Couldn't load performance"
        description="Something went wrong while fetching campaign performance."
        action={
          <button
            onClick={onRetry}
            style={{
              background: "var(--cc-primary)", color: "var(--cc-card)", border: "none",
              borderRadius: 8, padding: "8px 16px", fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", cursor: "pointer",
            }}
          >
            Retry
          </button>
        }
      />
    </Card>
  );
}

type ExportFormat = "xlsx" | "csv" | "pdf";

const EXPORT_FORMATS: { key: ExportFormat; label: string; hint: string }[] = [
  { key: "xlsx", label: "Excel (.xlsx)", hint: "Summary, posts and creators as separate sheets" },
  { key: "csv", label: "CSV (.csv)", hint: "Same sections in one plain-text file" },
  { key: "pdf", label: "PDF (.pdf)", hint: "Formatted performance report" },
];

function ExportModal({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const [format, setFormat] = useState<ExportFormat>("xlsx");

  const download = () => {
    window.location.assign(`/api/campaigns/${campaignId}/export?format=${format}`);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Export campaign data"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" iconLeft={<Download size={15} />} onClick={download}>Download</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text-muted)", margin: 0, lineHeight: 1.6 }}>
          Download the latest data for this campaign in your preferred format.
        </p>
        {EXPORT_FORMATS.map((f) => {
          const selected = f.key === format;
          return (
            <button
              key={f.key}
              onClick={() => setFormat(f.key)}
              aria-pressed={selected}
              style={{
                textAlign: "left", cursor: "pointer", borderRadius: 8, padding: 12,
                background: selected ? "var(--cc-bg)" : "var(--cc-card)",
                border: selected ? "1.5px solid var(--cc-primary)" : "1px solid var(--cc-border)",
              }}
            >
              <span style={{ display: "block", fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{f.label}</span>
              <span style={{ display: "block", fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", marginTop: 4 }}>{f.hint}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

export default function PerformanceTab({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/performance`);
      if (!res.ok) throw new Error("request failed");
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState onRetry={load} />;

  const { kpis, timeSeries, seriesPlatforms, platformSplit, leaderboard } = data;
  /* Only platforms with views get an area: a stacked chart draws every series,
     so a platform sitting at zero paints its stroke along the top of the stack
     and the legend names a platform the campaign never used. */
  const activeSeries = seriesFor(seriesPlatforms).filter((s) =>
    timeSeries.some((row) => Number(row[s.key] ?? 0) > 0)
  );
  /* Calendar order, a year on the ticks once the series crosses one, and at
     most seven ticks -- see lib/reports/chartDates. */
  const chartSeries = sortByDate(timeSeries);
  const dateAxis = chartDateAxis(chartSeries);

  const headerActions = (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {/* No audio control here. Attaching a sound is a property of the
          campaign, not an act on the report, so it lives in Settings beside the
          rest of what the campaign is -- and is asked for when the campaign is
          created. This tab only renders the card once one exists. */}
      {/* No Share button here: Share Campaign is in the campaign header on
          every section, this one included (components/campaigns/
          CampaignShareButton). A second one on this tab was the same dialog
          twice on one screen. */}
      <Button variant="secondary" iconLeft={<Download size={15} />} onClick={() => setShowExport(true)}>
        Export
      </Button>
    </div>
  );

  if (kpis.views === 0 && leaderboard.length === 0 && timeSeries.length === 0) {
    return (
      <>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>{headerActions}</div>
        <Card variant="outlined" style={{ padding: 32 }}>
          <EmptyState
            icon={<BarChart3 size={32} color="var(--cc-text-subtle)" />}
            title="No posts yet — add posts to see performance"
            description="Once creators publish content for this campaign, performance metrics will appear here."
          />
        </Card>
        {showExport && <ExportModal campaignId={campaignId} onClose={() => setShowExport(false)} />}
      </>
    );
  }

  const pieData = platformSplit.filter((p) => p.views > 0);
  /* Every post here carries a view count; engagement only exists for the ones we
     fetched ourselves, so those tiles appear only when there is something in
     them. See lib/metricDisplay. */
  const anyEngagementMeasured = leaderboard.some((r) => r.engagementRate !== null);
  /* Every tile in the row is sized by its longest figure, so one row reads at
     one size. Absent counters are null and contribute nothing. */
  const tileFit = Math.max(
    ...[kpis.posts, kpis.livePosts, kpis.views, kpis.likes, kpis.comments, kpis.shares, kpis.saves, kpis.downloads, kpis.engagements]
      .map((n) => (n === null ? 0 : formatNumber(n).length)),
    kpis.engagementRate === null ? 0 : `${(kpis.engagementRate * 100).toFixed(2)}%`.length,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <style>{`
        .perf-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; align-items: start; }
        @media (min-width: 1024px) { .perf-split { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); } }
        .perf-tiles .ui-statcard { min-width: 0; }
        .perf-tiles .ui-statcard-value { overflow-wrap: anywhere; font-size: clamp(16px, 1.5vw, 22px); }
      `}</style>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>{headerActions}</div>
      <div className="cc-tiles-balanced perf-tiles">
        {/* The same per-counter breakout CreatorCore's client report shows, so the
            campaign's own tab and the shared link tell one story. A counter no
            post has measured has no tile -- see lib/metricDisplay. */}
        <MetricTile fitTo={tileFit} metric="totalPosts" value={formatNumber(kpis.posts)} />
        {kpis.livePosts !== null && (
          <MetricTile fitTo={tileFit} metric="livePosts" value={formatNumber(kpis.livePosts)} />
        )}
        {/* The total says when it was read and, when some posts' views are
            missing, how many it covers (lib/dataAge asOfCaption -- the same line
            the Overview tile and the Posts strip carry). A sum over no read post
            is a dash, not a measured 0. */}
        <MetricTile
          fitTo={tileFit}
          metric="views"
          value={kpis.viewsKnownPosts === 0 && kpis.posts > 0 ? "\u2014" : formatNumber(kpis.views)}
          footer={
            kpis.asOf !== undefined
              ? asOfCaption(kpis.asOf, { known: kpis.viewsKnownPosts, total: kpis.posts, what: "views" })
              : viewsCoverageNote(kpis.viewsKnownPosts, kpis.posts)
          }
        />
        {kpis.likes !== null && (
          <MetricTile fitTo={tileFit} metric="totalLikes" value={formatNumber(kpis.likes)} />
        )}
        {kpis.comments !== null && (
          <MetricTile fitTo={tileFit} metric="totalComments" value={formatNumber(kpis.comments)} />
        )}
        {kpis.shares !== null && (
          <MetricTile fitTo={tileFit} metric="totalShares" value={formatNumber(kpis.shares)} />
        )}
        {kpis.saves !== null && (
          <MetricTile fitTo={tileFit} metric="totalSaves" value={formatNumber(kpis.saves)} />
        )}
        {kpis.downloads !== null && (
          <MetricTile fitTo={tileFit} metric="totalDownloads" value={formatNumber(kpis.downloads)} />
        )}
        {kpis.engagements !== null && (
          <MetricTile fitTo={tileFit} metric="engagements" value={formatNumber(kpis.engagements)} />
        )}
        {kpis.engagementRate !== null && (
          <MetricTile
            fitTo={tileFit}
            metric="engagementRate"
            label="Eng. rate"
            value={`${(kpis.engagementRate * 100).toFixed(2)}%`}
          />
        )}
      </div>

      {/* A campaign that promotes no release shows nothing here at all. Give it
          one in Settings and the card appears in this slot. */}
      {data.audio ? <AudioCard audio={data.audio} /> : null}

      <Card variant="outlined" style={{ padding: 24 }}>
        <span className="cc-panel-title cc-chart-title" style={{ display: "block", marginBottom: 16 }}>
          Views Over Time by Platform
        </span>
        {timeSeries.length >= 3 ? (
          <ChartFrame height={320}>
            <AreaChart data={chartSeries} margin={{ top: 8, right: 24, left: -8, bottom: 0 }}>
              <defs>
                {activeSeries.map((s) => (
                  <linearGradient key={s.key} id={`perfGrad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
              <XAxis dataKey="date" ticks={dateAxis.ticks} interval="preserveStartEnd" minTickGap={14} tickFormatter={dateAxis.tick} tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
              <YAxis tickFormatter={(v) => formatCompact(Number(v))} tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} width={72} />
              <Tooltip
                labelFormatter={(l) => dateAxis.label(String(l))}
                formatter={(v: any) => formatNumber(Number(v ?? 0))}
                contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: "var(--cc-t-13)"}}
              />
              <Legend wrapperStyle={{ fontSize: "var(--cc-t-12)"}} />
              {activeSeries.map((s) => (
                <Area
                  isAnimationActive={false}
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stackId="views"
                  strokeDasharray={s.solid ? "0" : undefined}
                  stroke={s.color}
                  fill={`url(#perfGrad-${s.key})`}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ChartFrame>
        ) : (
          <EmptyState icon={<TrendingUp size={32} color="var(--cc-text-subtle)" />} title="Not enough data yet" description="Views over time will appear once posts accumulate a few days of metrics." />
        )}
      </Card>

      <div className="perf-split">
        <Card variant="outlined" style={{ padding: 24 }}>
          <span className="cc-panel-title cc-chart-title" style={{ display: "block", marginBottom: 16 }}>
            Views by Platform
          </span>
          {pieData.length > 0 ? (
            <ChartFrame height={260}>
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  dataKey="views"
                  nameKey="platform"
                  paddingAngle={2}
                  label={false}
                  /* The stroke separates slices; on a lone slice it is a seam
                     drawn across a full ring. */
                  stroke="var(--cc-card)"
                  strokeWidth={pieData.length > 1 ? 2 : 0}
                >
                  {pieData.map((entry) => (
                    <Cell
                      key={entry.platform}
                      fill={platformSeriesColor(entry.platform, platformColor(entry.platform)).color}
                    />
                  ))}
                </Pie>
                <Legend verticalAlign="bottom" height={24} wrapperStyle={{ fontSize: "var(--cc-t-12)"}} formatter={(value: any) => <span style={{ color: "var(--cc-text-muted)" }}>{value}</span>} />
                <Tooltip
                  formatter={(v: any, _n: any, item: any) => [`${formatNumber(Number(v ?? 0))} views · ${(item?.payload as PlatformSplit)?.posts ?? 0} posts`, (item?.payload as PlatformSplit)?.platform ?? ""]}
                  contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: "var(--cc-t-13)"}}
                />
              </PieChart>
            </ChartFrame>
          ) : (
            <EmptyState icon={<PieChartIcon size={32} color="var(--cc-text-subtle)" />} title="No platform data" />
          )}
        </Card>

        <Card variant="solid" noPadding style={{ overflowX: "auto" }}>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--cc-border)" }}>
            <span className="cc-panel-title">Top Creators</span>
          </div>
          {leaderboard.length > 0 ? (
            <div style={{ minWidth: 480 }}>
              <div style={{
                display: "grid", gridTemplateColumns: LEADERBOARD_COLS(anyEngagementMeasured),
                gap: 12, padding: "10px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
              }}>
                {["Creator", "Posts", "Views", ...(anyEngagementMeasured ? ["Eng."] : [])].map((h) => (
                  <span key={h} className="cc-microlabel">{h}</span>
                ))}
              </div>
              {leaderboard.map((row, i) => (
                <div
                  key={row.creatorId}
                  style={{
                    display: "grid", gridTemplateColumns: LEADERBOARD_COLS(anyEngagementMeasured), gap: 12,
                    padding: "12px 24px", alignItems: "center",
                    borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <CreatorAvatar id={row.creatorId} name={row.name} size="sm" />
                    <CreatorName name={row.name} handle={row.handle} />
                  </div>
                  <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>{row.posts}</span>
                  <span style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{row.views === null ? "—" : formatNumber(row.views)}</span>
                  {anyEngagementMeasured && (
                    <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
                      {row.engagementRate !== null ? (
                        <Badge variant="neutral" size="sm">{(row.engagementRate * 100).toFixed(2)}%</Badge>
                      ) : (
                        "—"
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: 24 }}>
              <EmptyState icon={<Trophy size={32} color="var(--cc-text-subtle)" />} title="No creators yet" />
            </div>
          )}
        </Card>
      </div>

      {showExport && <ExportModal campaignId={campaignId} onClose={() => setShowExport(false)} />}
    </div>
  );
}
