"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Card, Badge, EmptyState, Skeleton, Avatar, Modal } from "@pratham7711/ui";
import { ChartFrame, MetricTile, Button } from "@/components/ds";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Eye, Heart, Percent, DollarSign, Target, TrendingUp, Share2, AlertTriangle, BarChart3, PieChart as PieChartIcon, Trophy, Download } from "lucide-react";
import { formatFull, formatCompact } from "@/lib/format";
import { platformColor } from "@/app/(dashboard)/analytics/shared";
import { ShareModal } from "@/app/(dashboard)/campaigns/ShareModal";
import { AudioCard } from "@/components/campaigns/AudioCard";
import type { CampaignAudio, CampaignPerformance } from "@/lib/reports/campaignPerformance";

/* Taken from the report seam rather than restated here. It was restated, and the
   two drifted the moment the seam grew the per-counter totals. */
type Kpis = CampaignPerformance["kpis"];

const LEADERBOARD_COLS = (withEngagement: boolean) =>
  withEngagement ? "1fr 70px 90px 80px 90px" : "1fr 70px 90px 90px";

/** One key per platform the campaign posted on — see lib/reports/campaignPerformance. */
type TimeSeriesPoint = { date: string } & { [platform: string]: number | string };
type PlatformSplit = { platform: string; views: number; posts: number };
type LeaderboardRow = {
  creatorId: string;
  name: string;
  avatarUrl: string | null;
  posts: number;
  views: number;
  engagements: number | null;
  engagementRate: number | null;
  emv: number;
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
function seriesFor(platforms: string[]): { key: string; color: string }[] {
  return platforms.map((key, i) => ({ key, color: platformColor(key, i) }));
}

function formatNumber(num: number): string {
  return formatFull(num);
}

function formatCurrency(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

/* Kept under its old name so call sites read unchanged; it no longer
   abbreviates. It already printed the full amount below $10k -- the compact
   branch above that was the only place two different EMVs could render as the
   same "$12K". */
function formatCurrencyCompact(n: number, currency = "USD"): string {
  return formatCurrency(n, currency);
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function LoadingState() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <style>{`
        .perf-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
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
              borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
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
  { key: "xlsx", label: "Excel (.xlsx)", hint: "Summary, posts, creators and payouts as separate sheets" },
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
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0, lineHeight: 1.6 }}>
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
              <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{f.label}</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-muted)", marginTop: 4 }}>{f.hint}</span>
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
  const [showShare, setShowShare] = useState(false);
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

  const { kpis, timeSeries, seriesPlatforms, platformSplit, leaderboard, currency } = data;
  /* Only platforms with views get an area: a stacked chart draws every series,
     so a platform sitting at zero paints its stroke along the top of the stack
     and the legend names a platform the campaign never used. */
  const activeSeries = seriesFor(seriesPlatforms).filter((s) =>
    timeSeries.some((row) => Number(row[s.key] ?? 0) > 0)
  );

  const headerActions = (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Button variant="secondary" iconLeft={<Download size={15} />} onClick={() => setShowExport(true)}>
        Export
      </Button>
      <button
        onClick={() => setShowShare(true)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "var(--cc-card)", color: "var(--cc-primary)", border: "1.5px solid var(--cc-primary)",
          borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
        }}
      >
        <Share2 size={15} /> Share report
      </button>
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
        {showShare && <ShareModal campaignId={campaignId} onClose={() => setShowShare(false)} />}
        {showExport && <ExportModal campaignId={campaignId} onClose={() => setShowExport(false)} />}
      </>
    );
  }

  const pieData = platformSplit.filter((p) => p.views > 0);
  /* Every post here carries a view count; engagement only exists for the ones we
     fetched ourselves, so those tiles appear only when there is something in
     them. See lib/metricDisplay. */
  const anyEngagementMeasured = leaderboard.some((r) => r.engagementRate !== null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <style>{`
        .perf-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
        @media (min-width: 1024px) { .perf-split { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); } }
        .perf-tiles .ui-statcard { min-width: 0; }
        .perf-tiles .ui-statcard-value { overflow-wrap: anywhere; font-size: clamp(16px, 1.5vw, 22px); }
      `}</style>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>{headerActions}</div>
      <div className="rsp-grid-tiles perf-tiles">
        {/* The same per-counter breakout CreatorCore's client report shows, so the
            campaign's own tab and the shared link tell one story. A counter no
            post has measured has no tile -- see lib/metricDisplay. */}
        <MetricTile metric="totalPosts" value={formatNumber(kpis.posts)} />
        {kpis.livePosts !== null && (
          <MetricTile metric="livePosts" value={formatNumber(kpis.livePosts)} />
        )}
        <MetricTile metric="views" value={formatNumber(kpis.views)} />
        {kpis.likes !== null && (
          <MetricTile metric="totalLikes" value={formatNumber(kpis.likes)} />
        )}
        {kpis.comments !== null && (
          <MetricTile metric="totalComments" value={formatNumber(kpis.comments)} />
        )}
        {kpis.shares !== null && (
          <MetricTile metric="totalShares" value={formatNumber(kpis.shares)} />
        )}
        {kpis.saves !== null && (
          <MetricTile metric="totalSaves" value={formatNumber(kpis.saves)} />
        )}
        {kpis.downloads !== null && (
          <MetricTile metric="totalDownloads" value={formatNumber(kpis.downloads)} />
        )}
        {kpis.engagements !== null && (
          <MetricTile metric="engagements" value={formatNumber(kpis.engagements)} />
        )}
        {kpis.engagementRate !== null && (
          <MetricTile
            metric="engagementRate"
            label="Eng. rate"
            value={`${(kpis.engagementRate * 100).toFixed(2)}%`}
          />
        )}
        <MetricTile metric="emv" value={formatCurrencyCompact(kpis.emv, currency)} />
      </div>

      {/* Absent unless the campaign's song has a tracked sound, so campaigns
          that promote no release look exactly as they did. */}
      {data.audio ? <AudioCard audio={data.audio} /> : null}

      <Card variant="outlined" style={{ padding: 24 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>
          Views Over Time by Platform
        </span>
        {timeSeries.length >= 3 ? (
          <ChartFrame height={320}>
            <AreaChart data={timeSeries} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <defs>
                {activeSeries.map((s) => (
                  <linearGradient key={s.key} id={`perfGrad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
              <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
              <YAxis tickFormatter={(v) => formatCompact(Number(v))} tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} width={72} />
              <Tooltip
                labelFormatter={(l) => formatDate(String(l))}
                formatter={(v: any) => formatNumber(Number(v ?? 0))}
                contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: 13 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {activeSeries.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stackId="views"
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
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>
            Views by Platform
          </span>
          {pieData.length > 0 ? (
            <ChartFrame height={260}>
              <PieChart>
                <Pie
                  data={pieData}
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
                  {pieData.map((entry) => (
                    <Cell key={entry.platform} fill={platformColor(entry.platform)} />
                  ))}
                </Pie>
                <Legend verticalAlign="bottom" height={24} wrapperStyle={{ fontSize: 12 }} formatter={(value: any) => <span style={{ color: "var(--cc-text-muted)" }}>{value}</span>} />
                <Tooltip
                  formatter={(v: any, _n: any, item: any) => [`${formatNumber(Number(v ?? 0))} views · ${(item?.payload as PlatformSplit)?.posts ?? 0} posts`, (item?.payload as PlatformSplit)?.platform ?? ""]}
                  contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: 13 }}
                />
              </PieChart>
            </ChartFrame>
          ) : (
            <EmptyState icon={<PieChartIcon size={32} color="var(--cc-text-subtle)" />} title="No platform data" />
          )}
        </Card>

        <Card variant="solid" noPadding style={{ overflowX: "auto" }}>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--cc-border)" }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>Top Creators</span>
          </div>
          {leaderboard.length > 0 ? (
            <div style={{ minWidth: 480 }}>
              <div style={{
                display: "grid", gridTemplateColumns: LEADERBOARD_COLS(anyEngagementMeasured),
                gap: 12, padding: "10px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
              }}>
                {["Creator", "Posts", "Views", ...(anyEngagementMeasured ? ["Eng."] : []), "EMV"].map((h) => (
                  <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
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
                    <Avatar name={row.name} src={row.avatarUrl ?? undefined} size="sm" />
                    <span title={row.name} style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                  </div>
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{row.posts}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{formatNumber(row.views)}</span>
                  {anyEngagementMeasured && (
                    <span>
                      {row.engagementRate !== null && (
                        <Badge variant="neutral" size="sm">{(row.engagementRate * 100).toFixed(1)}%</Badge>
                      )}
                    </span>
                  )}
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-primary)" }}>{formatCurrency(row.emv, currency)}</span>
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

      {showShare && <ShareModal campaignId={campaignId} onClose={() => setShowShare(false)} />}
      {showExport && <ExportModal campaignId={campaignId} onClose={() => setShowExport(false)} />}
    </div>
  );
}
