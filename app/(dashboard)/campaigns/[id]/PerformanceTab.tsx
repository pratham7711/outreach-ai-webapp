"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Card, EmptyState } from "@pratham7711/ui";
import { Modal, ModalOption, ModalOptionList, ModalSection } from "@/components/ds/Modal";
import { MetricTile, Button, SectionCard, DataTable, Skeleton, type DataTableColumn } from "@/components/ds";
import { TileGridSkeleton } from "@/components/ui/PageSkeleton";
import { ChartFrame } from "@/components/ds/ChartFrame";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, BarChart, Bar, ReferenceLine,
} from "recharts";
import { TrendingUp, AlertTriangle, BarChart3, PieChart as PieChartIcon, Trophy, Download, FileSpreadsheet, FileText, FileType } from "lucide-react";
import { CampaignHeaderActions } from "@/components/campaigns/CampaignHeaderActions";
import { PlatformSplit, type PlatformSplitRow } from "@/components/charts/PlatformSplit";
import { chartAxisTick, chartLegendProps, chartTooltipProps } from "@/components/charts/chartTheme";
import { formatFull, formatCompact } from "@/lib/format";
import { platformColor } from "@/app/(dashboard)/analytics/shared";
import { AudioCard } from "@/components/campaigns/AudioCard";
import { SpotifyStreamsCard } from "@/components/campaigns/SpotifyStreamsCard";
import type { CampaignAudio, CampaignPerformance } from "@/lib/reports/campaignPerformance";
import type { CampaignStreams } from "@/lib/songs/streams";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import CreatorName from "@/components/creators/CreatorName";
import { viewsCoverageNote } from "@/lib/metricDisplay";
import { asOfCaption } from "@/lib/dataAge";
import { chartDateAxis, sortByDate } from "@/lib/reports/chartDates";
import { platformSeriesColor } from "@/lib/reports/platformSeriesColor";
import { SeriesModeToggle } from "@/components/charts/SeriesModeToggle";
import { nextPeriodBy, toChanges, withinRange, type ChartRange, type SeriesMode } from "@/lib/charts/seriesMode";
import { ChartTabsCard, type ChartTab } from "@/components/charts/ChartTabsCard";
import { launchLabel, type CampaignLaunch } from "@/lib/campaigns/launch";
import { formatTick, niceAxis, stackExtent } from "@/lib/charts/axisTicks";
import { platformLabel } from "@/lib/platforms/registry";

/* Taken from the report seam rather than restated here. It was restated, and the
   two drifted the moment the seam grew the per-counter totals. */
type Kpis = CampaignPerformance["kpis"];

/** One key per platform the campaign posted on — see lib/reports/campaignPerformance. */
type TimeSeriesPoint = { date: string } & { [platform: string]: number | string };
type PlatformShare = { platform: string; views: number; posts: number };
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
  platformSplit: PlatformShare[];
  leaderboard: LeaderboardRow[];
  /** Null when the campaign has no song, or a song with no tracked TikTok sound. */
  audio: CampaignAudio | null;
  /** The song's Instagram audio; absent from a report cached before it existed. */
  instagramAudio?: CampaignAudio | null;
  /** Null when the campaign has no song; see lib/songs/streams. */
  streams: CampaignStreams | null;
  /** Absent from a report cached before it existed. */
  launch?: CampaignLaunch | null;
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

function audioTab(key: string, label: string, audio: CampaignAudio, launch: CampaignLaunch | null): ChartTab {
  return {
    key,
    label,
    figure: audio.uses === null ? null : `${audio.usesRounded ? "≈" : ""}${formatCompact(audio.uses)} videos`,
    render: (range) => <AudioCard audio={audio} range={range} launch={launch} embedded />,
  };
}

function formatNumber(num: number): string {
  return formatFull(num);
}

function LoadingState() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* The same shapes as the page's own loader for this section
          (campaigns/[id]/page.tsx), so nothing jumps between the two. */}
      <TileGridSkeleton count={9} />
      <Skeleton width="100%" height={320} radius="var(--cc-r-card)" />
      <div className="perf-split">
        <Skeleton width="100%" height={240} radius="var(--cc-r-card)" />
        <Skeleton width="100%" height={240} radius="var(--cc-r-card)" />
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card variant="outlined">
      <EmptyState
        icon={<AlertTriangle size={32} color="var(--cc-text-subtle)" />}
        title="Couldn't load performance"
        description="Something went wrong while fetching campaign performance."
        action={
          <Button variant="primary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        }
      />
    </Card>
  );
}

type ExportFormat = "xlsx" | "csv" | "pdf";

const EXPORT_FORMATS: { key: ExportFormat; label: string; hint: string; icon: React.ElementType }[] = [
  { key: "xlsx", label: "Excel (.xlsx)", hint: "Summary, posts and creators as separate sheets", icon: FileSpreadsheet },
  { key: "csv", label: "CSV (.csv)", hint: "Same sections in one plain-text file", icon: FileText },
  { key: "pdf", label: "PDF (.pdf)", hint: "Formatted performance report", icon: FileType },
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
      icon={Download}
      tone="brand"
      title="Export campaign data"
      description="Download the latest data for this campaign in your preferred format."
      size="sm"
      footer={
        <div className="cc-modal-footer">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" iconLeft={<Download size={16} aria-hidden="true" />} onClick={download}>Download</Button>
        </div>
      }
    >
      <ModalSection title="Format">
        <ModalOptionList>
          {EXPORT_FORMATS.map((f) => (
            <ModalOption
              key={f.key}
              icon={f.icon}
              title={f.label}
              description={f.hint}
              control={
                <input
                  type="radio"
                  name="export-format"
                  value={f.key}
                  checked={f.key === format}
                  onChange={() => setFormat(f.key)}
                  style={{ width: 18, height: 18, accentColor: "var(--cc-primary)", cursor: "pointer" }}
                />
              }
            />
          ))}
        </ModalOptionList>
      </ModalSection>
    </Modal>
  );
}

/* Top creators: numbers right-aligned and tabular (DataTable), the rate as
   plain text. Rows do not link -- they never did here. */
function leaderboardColumns(withEngagement: boolean): DataTableColumn<LeaderboardRow>[] {
  const cols: DataTableColumn<LeaderboardRow>[] = [
    {
      key: "creator",
      header: "Creator",
      primary: true,
      minWidth: 200,
      render: (row) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <CreatorAvatar id={row.creatorId} name={row.name} size="sm" />
          <CreatorName name={row.name} handle={row.handle} />
        </span>
      ),
    },
    { key: "posts", header: "Posts", width: 80, align: "right", render: (row) => formatNumber(row.posts) },
    { key: "views", header: "Views", width: 110, align: "right", render: (row) => (row.views === null ? "—" : formatNumber(row.views)) },
  ];
  if (withEngagement) {
    cols.push({
      key: "eng",
      header: "Eng.",
      width: 90,
      align: "right",
      render: (row) => (row.engagementRate === null ? "—" : `${(row.engagementRate * 100).toFixed(2)}%`),
    });
  }
  return cols;
}

/**
 * Views over time by platform: the running total, or what each day added.
 * Per-day changes are worked out over every reading before the range cuts the
 * rows, so the window's first day keeps its figure.
 */
function ViewsChart({
  timeSeries,
  activeSeries,
  range,
  launch,
  mode,
  onModeChange,
}: {
  timeSeries: TimeSeriesPoint[];
  activeSeries: { key: string; color: string; solid: boolean }[];
  range: ChartRange;
  launch: CampaignLaunch | null;
  /** The chart card's Daily/Cumulative, so it holds across its tabs. */
  mode?: SeriesMode;
  onModeChange?: (m: SeriesMode) => void;
}) {
  const [ownMode, setOwnMode] = useState<SeriesMode>("cumulative");
  const viewsMode = mode ?? ownMode;
  const topBandFirst = (item: { dataKey?: unknown }) => -activeSeries.findIndex((s) => s.key === item.dataKey);
  const seriesKeys = activeSeries.map((s) => s.key);
  const setViewsMode = onModeChange ?? setOwnMode;
  /* Calendar order, a year on the ticks once the series crosses one, and at
     most seven ticks -- see lib/reports/chartDates. */
  const chartSeries = sortByDate(timeSeries);
  /* Each platform's value is the running view total of its posts on that day
     (every day present), so a day's figure is the change from the day before. */
  const dailySeries = toChanges(
    chartSeries,
    activeSeries.map((s) => s.key),
    nextPeriodBy((r) => String(r.date)),
  );
  const shown = withinRange(chartSeries, (r) => String(r.date), range);
  const shownDaily = withinRange(dailySeries, (r) => String(r.date), range);
  const dateAxis = chartDateAxis(shown);
  const enough = timeSeries.length >= 3;
  const lastDay = chartSeries.length ? String(chartSeries[chartSeries.length - 1].date) : null;
  /* The views line starts at the first post, so a first-post marker would sit
     on the left edge; it is drawn only when it falls inside the chart. */
  const marker =
    launch && shown.length > 1 && String(shown[0].date) < launch.day && shown.some((r) => String(r.date) === launch.day) ? (
      <ReferenceLine
        x={launch.day}
        stroke="var(--cc-text-muted)"
        strokeDasharray="4 3"
        label={{ value: launchLabel(launch), position: "insideTopLeft", fontSize: 11, fill: "var(--cc-text-muted)" }}
      />
    ) : null;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <p className="cc-chart-caption">
          {viewsMode === "daily" ? "Views gained per day by platform" : "Cumulative views by platform"}
        </p>
        {enough ? <SeriesModeToggle label="Views over time" value={viewsMode} onChange={setViewsMode} /> : null}
      </div>
      {enough && shown.length === 0 ? (
        <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0 }}>
          No view readings in this range{lastDay ? `; the last was on ${dateAxis.label(lastDay)}` : ""}.
        </p>
      ) : enough && viewsMode === "daily" ? (
        <ChartFrame height={320}>
          <BarChart data={shownDaily} stackOffset="sign" margin={{ top: 8, right: 24, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" vertical={false} />
            <XAxis dataKey="date" ticks={dateAxis.ticks} interval="preserveStartEnd" minTickGap={14} tickFormatter={dateAxis.tick} tick={chartAxisTick} />
            <YAxis tickFormatter={(v) => formatTick(Number(v))} tick={chartAxisTick} width={72} {...niceAxis(stackExtent(shownDaily, seriesKeys))} />
            <ReferenceLine y={0} stroke="var(--cc-border)" />
            {marker}
            <Tooltip
              {...chartTooltipProps}
              itemSorter={topBandFirst}
              labelFormatter={(l) => dateAxis.label(String(l))}
              formatter={(v: unknown) => (v === null || v === undefined ? "—" : formatNumber(Number(v)))}
            />
            <Legend {...chartLegendProps} itemSorter={null} />
            {activeSeries.map((s) => (
              <Bar isAnimationActive={false} key={s.key} dataKey={s.key} name={platformLabel(s.key)} stackId="views" fill={s.color} maxBarSize={28} />
            ))}
          </BarChart>
        </ChartFrame>
      ) : enough ? (
        <ChartFrame height={320}>
          <AreaChart data={shown} margin={{ top: 8, right: 24, left: -8, bottom: 0 }}>
            <defs>
              {activeSeries.map((s) => (
                <linearGradient key={s.key} id={`perfGrad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
            <XAxis dataKey="date" ticks={dateAxis.ticks} interval="preserveStartEnd" minTickGap={14} tickFormatter={dateAxis.tick} tick={chartAxisTick} />
            <YAxis tickFormatter={(v) => formatTick(Number(v))} tick={chartAxisTick} width={72} {...niceAxis(stackExtent(shown, seriesKeys))} />
            {marker}
            <Tooltip
              {...chartTooltipProps}
              itemSorter={topBandFirst}
              labelFormatter={(l) => dateAxis.label(String(l))}
              formatter={(v: unknown) => formatNumber(Number(v ?? 0))}
            />
            <Legend {...chartLegendProps} itemSorter={null} />
            {activeSeries.map((s) => (
              <Area
                isAnimationActive={false}
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={platformLabel(s.key)}
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
    </>
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
  const launch = data.launch ?? null;

  /* Export sits in the campaign header beside Share Campaign, like every other
     section's own action, rather than alone on a row above the tiles. */
  const headerActions = (
    <CampaignHeaderActions>
      {/* No audio control here. Attaching a sound is a property of the
          campaign, not an act on the report, so it lives in Settings beside the
          rest of what the campaign is -- and is asked for when the campaign is
          created. This tab only renders the card once one exists. */}
      {/* No Share button here: Share Campaign is in the campaign header on
          every section, this one included (components/campaigns/
          CampaignShareButton). A second one on this tab was the same dialog
          twice on one screen. */}
      <Button variant="secondary" size="sm" iconLeft={<Download size={16} aria-hidden="true" />} onClick={() => setShowExport(true)}>
        Export
      </Button>
    </CampaignHeaderActions>
  );

  if (kpis.views === 0 && leaderboard.length === 0 && timeSeries.length === 0) {
    return (
      <>
        {headerActions}
        <Card variant="outlined">
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

  /* Every platform the campaign posted on. A platform whose posts have no view
     count read yet sums to 0 and reads "—", not a measured 0 -- the same rows
     the Analytics section draws. */
  const splitRows: PlatformSplitRow[] = platformSplit
    .filter((p) => p.posts > 0 || p.views > 0)
    .map((p) => ({ platform: p.platform, views: p.views > 0 ? p.views : null, posts: p.posts }));
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
      {headerActions}
      <div className="cc-tiles-balanced">
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

      {/* The views chart and the release's charts in one card, one at a time
          (components/charts/ChartTabsCard). A campaign that promotes no release
          has only the Views tab; give it one in Settings and its tabs appear. */}
      <ChartTabsCard
        tabs={[
          {
            key: "views",
            label: "Views",
            figure: kpis.viewsKnownPosts === 0 && kpis.posts > 0 ? null : formatCompact(kpis.views),
            hasData: timeSeries.length >= 3,
            render: (range, series) => (
              <ViewsChart timeSeries={timeSeries} activeSeries={activeSeries} range={range} launch={launch} mode={series.mode} onModeChange={series.setMode} />
            ),
          },
          ...(data.audio
            ? [audioTab("tiktok", "TikTok audio", data.audio, launch)]
            : []),
          ...(data.instagramAudio
            ? [audioTab("instagram", "Instagram audio", data.instagramAudio, launch)]
            : []),
          ...(data.streams
            ? [{
                key: "spotify",
                label: "Spotify",
                figure: data.streams.totalPlays === null ? null : `${formatCompact(data.streams.totalPlays)} plays`,
                render: (range: ChartRange, series: { mode: SeriesMode; setMode: (m: SeriesMode) => void }) => (
                  <SpotifyStreamsCard streams={data.streams!} range={range} launch={launch} embedded mode={series.mode} onModeChange={series.setMode} />
                ),
              }]
            : []),
        ]}
      />

      <div className="perf-split">
        <SectionCard title="Views by platform">
          {splitRows.some((r) => r.views !== null) ? (
            <PlatformSplit rows={splitRows} ariaLabel="Views by platform" />
          ) : (
            <EmptyState icon={<PieChartIcon size={32} color="var(--cc-text-subtle)" />} title="No platform data" />
          )}
        </SectionCard>

        <SectionCard title="Top creators" padded={false}>
          <DataTable
            bare
            caption="Top creators"
            columns={leaderboardColumns(anyEngagementMeasured)}
            rows={leaderboard}
            rowKey={(row) => row.creatorId}
            empty={<EmptyState icon={<Trophy size={32} color="var(--cc-text-subtle)" />} title="No creators yet" />}
          />
        </SectionCard>
      </div>

      {showExport && <ExportModal campaignId={campaignId} onClose={() => setShowExport(false)} />}
    </div>
  );
}
