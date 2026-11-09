"use client";
import React, { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { EmptyState } from "@pratham7711/ui";
import { Activity, BarChart3, Calendar, Clock, Smartphone, Users } from "lucide-react";
import CampaignComparison from "./CampaignComparison";
import { PostingTimeHeatmap } from "./PostingTimeHeatmap";
import { resolveTimeZone } from "@/lib/analytics/postingTime";
import CreatorLeaderboard, { LeaderboardCreator } from "./CreatorLeaderboard";
import { LoadError, PageHeader, MetricTile, SectionCard, Skeleton, StatusTabs } from "@/components/ds";
import { TileGridSkeleton } from "@/components/ui/PageSkeleton";
import { PlatformSplit } from "@/components/charts/PlatformSplit";
import {
  formatNumber,
  formatCurrency,
  RANGE_PRESETS,
  PLATFORM_FILTERS,
  rangeToFrom,
} from "./shared";
import { loadCharts } from "@/components/charts/lazyCharts";
import { asOfCaption } from "@/lib/dataAge";
import { formatDateAbs } from "@/lib/format";
import { growthDelta, type PeriodGrowth } from "@/lib/analytics/periodGrowth";
import { SeriesModeToggle } from "@/components/charts/SeriesModeToggle";
import type { SeriesMode } from "@/lib/charts/seriesMode";

const MonthlyTrendArea = dynamic(() => loadCharts().then((m) => m.MonthlyTrendArea), {
  ssr: false,
  loading: () => <Skeleton width="100%" height="100%" />,
});

type KPIs = {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  avgEngagementRate: number;
  totalPosts: number;
  /** How many posts the engagement rate could be measured from. */
  engagementSample: number;
  /** Posts with a view count; absent from a response cached before it existed. */
  viewsKnownPosts?: number | null;
  /** The newest reading behind the views total, ISO. */
  asOf?: string | null;
};

type CampaignOption = { id: string; title: string; status: string };

type AnalyticsData = {
  kpis: KPIs;
  monthlyTrend: { month: string; campaigns: number; active: number }[];
  leaderboard: LeaderboardCreator[];
  platformBreakdown: { platform: string; views: number; posts: number }[];
  campaigns: CampaignOption[];
  /** The workspace total's change over the window and the one before; null when a reading is missing or stale. */
  viewsGrowth?: PeriodGrowth | null;
  /** Weekday-hour slots, already medianed by the database in postingTimeZone. */
  postingBuckets: { day: number; hour: number; count: number; medianViews: number }[];
  postingTimeZone: string;
};

/* A filter row of segmented controls, the same control as the dashboard's
   date range. Its name sits beside it in the row's own text size: the old
   11px uppercase legend above each group read as a heading, not a label. */
function FilterGroup({
  legend,
  options,
  active,
  onChange,
}: {
  legend: string;
  options: { key: string; label: string }[];
  active: string;
  onChange: (v: string) => void;
}) {
  const id = `analytics-filter-${legend.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="cc-filter-row flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-2">
      <span id={id} className="text-sm text-[var(--cc-text-muted)]">
        {legend}
      </span>
      <div role="group" aria-labelledby={id} className="cc-segmented">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            className="cc-segmented-btn"
            onClick={() => onChange(o.key)}
            aria-pressed={o.key === active}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* The overview while it loads: the tile row in the tiles' own grid, then the
   chart card, so nothing moves when the figures arrive. */
function SkeletonGrid() {
  return (
    <div className="flex flex-col gap-6">
      <TileGridSkeleton count={5} />
      <Skeleton height={300} radius="var(--cc-r-card)" />
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [range, setRange] = useState("30d");
  const [section, setSection] = useState<"overview" | "comparison" | "creators" | "timing">("overview");
  const [platform, setPlatform] = useState("ALL");
  const [launchMode, setLaunchMode] = useState<SeriesMode>("daily");
  // Platforms the account has posts on, from the last unfiltered load. The
  // breakdown narrows to the chosen platform once one is picked, so it cannot
  // be read live -- the other pills would vanish the moment one was clicked.
  const [postedOn, setPostedOn] = useState<string[] | null>(null);
  // The posting hours have to be bucketed in someone's clock, and only the
  // browser knows which. Resolved once, so the buckets never straddle two zones.
  const [timeZone] = useState(resolveTimeZone);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    const from = rangeToFrom(range);
    if (from) params.set("from", from);
    if (platform !== "ALL") params.set("platform", platform);
    params.set("tz", timeZone);
    const qs = params.toString();
    fetch(`/api/analytics${qs ? `?${qs}` : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (d && d.kpis) {
          setData(d);
          if (platform === "ALL") setPostedOn(d.platformBreakdown.map((p: { platform: string }) => p.platform));
        } else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [range, platform, timeZone]);

  useEffect(() => {
    load();
  }, [load]);

  const k = data?.kpis;
  const growth = data?.viewsGrowth ?? null;
  /* The overview tiles share one figure size, set by the longest of them. */
  const tileFit = k
    ? Math.max(
        ...[k.totalViews, k.totalLikes, k.totalComments].map((n) => formatNumber(n).length),
        k.engagementSample > 0 ? `${k.avgEngagementRate.toFixed(1)}%`.length : 0,
      )
    : 0;
  /* Total Views over posts none of which has a view count is unknown, not 0:
     seven Instagram photos read "TOTAL VIEWS 0 · 7 posts". The caption says
     when the total was read and, when partial, how many posts it covers. */
  const viewsUnknown = k ? k.viewsKnownPosts === 0 && k.totalPosts > 0 : false;
  const viewsCaption = k
    ? k.viewsKnownPosts === undefined
      ? `${formatNumber(k.totalPosts)} posts`
      : (() => {
          const caption = asOfCaption(k.asOf ?? null, { known: k.viewsKnownPosts, total: k.totalPosts, what: "views" });
          return (k.viewsKnownPosts ?? 0) >= k.totalPosts ? [`${formatNumber(k.totalPosts)} posts`, caption].filter(Boolean).join(" · ") : caption;
        })()
    : null;
  // "All" plus the platforms there is something to show for. X, LinkedIn,
  // Snapchat and Pinterest have no reader, so their pills could only filter to
  // an empty page.
  const platformPills = PLATFORM_FILTERS.filter(
    (o) => o.key === "ALL" || o.key === platform || (postedOn ?? []).includes(o.key),
  );

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Analytics"
        tabs={
          <StatusTabs
            ariaLabel="Analytics sections"
            idBase="analytics"
            tabs={[
              { key: "overview", label: "Overview", icon: <BarChart3 size={16} aria-hidden="true" /> },
              { key: "comparison", label: "Compare campaigns", icon: <Activity size={16} aria-hidden="true" /> },
              { key: "creators", label: "Creators & platforms", icon: <Users size={16} aria-hidden="true" /> },
              { key: "timing", label: "Timing", icon: <Clock size={16} aria-hidden="true" /> },
            ]}
            active={section}
            onChange={(key) => setSection(key as typeof section)}
          />
        }
      />

      <div className="cc-toolbar cc-filter-rows">
        <FilterGroup legend="Range" options={RANGE_PRESETS} active={range} onChange={setRange} />
        {platformPills.length > 2 && (
          <FilterGroup legend="Platform" options={platformPills} active={platform} onChange={setPlatform} />
        )}
      </div>

      {loading ? (
        <SkeletonGrid />
      ) : error || !data || !k ? (
        <LoadError
          title="We couldn't load analytics"
          description="Nothing here was read, which is not the same as nothing having happened."
          onRetry={load}
        />
      ) : (
        <div role="tabpanel" id="analytics-panel" aria-labelledby={`analytics-tab-${section}`}>
          {section === "overview" && (
            <>
            <div className="flex flex-col gap-6">
              {/* No post in range means nothing was measured, so 0 views / 0
                  likes / 0 comments are not three findings — they are the same
                  absence stated three times, with the authority of a figure. */}
              {k.totalPosts === 0 ? (
                <EmptyState
                  icon={<BarChart3 size={32} color="var(--cc-text-subtle)" />}
                  title="Nothing published in this range"
                  description="Track a post on a campaign, or widen the date range, and the totals appear here."
                />
              ) : (
              <div className="cc-tiles-balanced">
                <MetricTile
                  fitTo={tileFit}
                  metric="totalViews"
                  value={viewsUnknown ? "\u2014" : formatNumber(k.totalViews)}
                  footer={viewsCaption}
                />
                {/* How far the workspace total moved in the window, against the
                    window before, with the two days it is read between always
                    shown: the total also moves when posts are added or removed,
                    so the tile says what it is a difference of. */}
                {growth && (
                  <MetricTile
                    fitTo={tileFit}
                    metric="viewsGained"
                    value={formatNumber(growth.current)}
                    delta={growthDelta(growth)}
                    footer={`${formatDateAbs(growth.from)} – ${formatDateAbs(growth.to)}`}
                  />
                )}
                <MetricTile fitTo={tileFit} metric="totalLikes" value={formatNumber(k.totalLikes)} />
                <MetricTile fitTo={tileFit} metric="totalComments" value={formatNumber(k.totalComments)} />
                {/* Absent entirely when no post in range carries a rate. */}
                {k.engagementSample > 0 && (
                  <MetricTile
                    fitTo={tileFit}
                    metric="engagementRate"
                    value={`${k.avgEngagementRate.toFixed(1)}%`}
                    footer={
                      k.engagementSample < k.totalPosts
                        ? `from ${formatNumber(k.engagementSample)} of ${formatNumber(k.totalPosts)} posts`
                        : undefined
                    }
                  />
                )}
              </div>
              )}

              <SectionCard
                icon={Calendar}
                title="Campaigns launched"
                action={
                  data.monthlyTrend.every((m) => m.campaigns === 0) ? undefined : (
                    <SeriesModeToggle
                      label="Campaigns launched"
                      value={launchMode}
                      onChange={setLaunchMode}
                      periodLabel="Monthly"
                    />
                  )
                }
              >
                {data.monthlyTrend.every((m) => m.campaigns === 0) ? (
                  <EmptyState
                    icon={<Calendar size={32} color="var(--cc-text-subtle)" />}
                    title="No campaign data"
                    description="Launch campaigns to see monthly trends."
                  />
                ) : (
                  <div className="h-[220px] md:h-[300px]">
                    <MonthlyTrendArea data={data.monthlyTrend} mode={launchMode} />
                  </div>
                )}
              </SectionCard>
            </div>
            </>
          )}

          {section === "comparison" && (
            <>
            <CampaignComparison campaigns={data.campaigns} range={range} platform={platform} />
            </>
          )}

          {section === "creators" && (
            <>
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <CreatorLeaderboard creators={data.leaderboard} />
              </div>

              <SectionCard
                icon={Smartphone}
                title="Views by platform"
                description="Which platforms your views came from."
                metric="totalViews"
              >
                {data.platformBreakdown.length === 0 ? (
                  <EmptyState icon={<Smartphone size={32} color="var(--cc-text-subtle)" />} title="No data" />
                ) : (
                  <PlatformSplit rows={data.platformBreakdown} />
                )}
              </SectionCard>
            </div>
            </>
          )}

          {section === "timing" && (
            <>
            <PostingTimeHeatmap
              buckets={data.postingBuckets ?? []}
              timeZone={data.postingTimeZone ?? timeZone}
              platform={platform}
            />
            </>
          )}
        </div>
      )}
    </div>
  );
}
