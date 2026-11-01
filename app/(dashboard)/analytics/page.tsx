"use client";
import React, { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Skeleton, EmptyState } from "@pratham7711/ui";
import { Activity, BarChart3, Calendar, Clock, Smartphone, Users } from "lucide-react";
import CampaignComparison from "./CampaignComparison";
import { PostingTimeHeatmap } from "./PostingTimeHeatmap";
import { resolveTimeZone } from "@/lib/analytics/postingTime";
import CreatorLeaderboard, { LeaderboardCreator } from "./CreatorLeaderboard";
import { PageHeader, MetricTile, SectionCard } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatNumber,
  formatCurrency,
  RANGE_PRESETS,
  PLATFORM_FILTERS,
  rangeToFrom,
  platformColor,
} from "./shared";
import { loadCharts } from "@/components/charts/lazyCharts";
import { asOfCaption } from "@/lib/dataAge";
import { noun } from "@/lib/ui/noun";
import { platformLabel, formatDateAbs } from "@/lib/format";
import { growthDelta, type PeriodGrowth } from "@/lib/analytics/periodGrowth";
import { SeriesModeToggle } from "@/components/charts/SeriesModeToggle";
import type { SeriesMode } from "@/lib/charts/seriesMode";

const MonthlyTrendArea = dynamic(() => loadCharts().then((m) => m.MonthlyTrendArea), {
  ssr: false,
  loading: () => <Skeleton width="100%" height="100%" borderRadius="8px" />,
});

const PlatformBreakdownBar = dynamic(() => loadCharts().then((m) => m.PlatformBreakdownBar), {
  ssr: false,
  loading: () => <Skeleton width="100%" height="100%" borderRadius="8px" />,
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

function PillGroup({
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
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1.5">
      <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {legend}
      </span>
      <div role="group" aria-label={legend} className="inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-muted p-[3px]">
        {options.map((o) => {
          const isActive = o.key === active;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => onChange(o.key)}
              aria-pressed={isActive}
              className={`rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                isActive
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} height="96px" borderRadius="12px" />
        ))}
      </div>
      <Skeleton height="280px" borderRadius="12px" />
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [range, setRange] = useState("30d");
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
        subtitle="How every campaign and creator performed across your whole account."
      />

      <div className="mb-6 flex flex-wrap items-start gap-5">
        <PillGroup legend="Date range" options={RANGE_PRESETS} active={range} onChange={setRange} />
        {platformPills.length > 2 && (
          <PillGroup legend="Platform" options={platformPills} active={platform} onChange={setPlatform} />
        )}
      </div>

      {loading ? (
        <SkeletonGrid />
      ) : error || !data || !k ? (
        <EmptyState
          icon={<BarChart3 size={32} color="var(--cc-text-subtle)" />}
          title="Failed to load analytics"
          description="Adjust your filters or refresh to try again."
          action={
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          }
        />
      ) : (
        <Tabs defaultValue="overview" className="gap-6">
          <TabsList variant="line" className="max-w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview">
              <BarChart3 aria-hidden="true" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="comparison">
              <Activity aria-hidden="true" />
              Compare campaigns
            </TabsTrigger>
            <TabsTrigger value="creators">
              <Users aria-hidden="true" />
              Creators &amp; platforms
            </TabsTrigger>
            <TabsTrigger value="timing">
              <Clock aria-hidden="true" />
              Timing
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
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
                description={
                  launchMode === "cumulative"
                    ? "A running total of the campaigns you started over the last six months, and how many of those are active now."
                    : "How many campaigns you started each month over the last six months."
                }
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
          </TabsContent>

          <TabsContent value="comparison">
            <CampaignComparison campaigns={data.campaigns} range={range} platform={platform} />
          </TabsContent>

          <TabsContent value="creators">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
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
                  <>
                    <div className="h-[200px]">
                      <PlatformBreakdownBar data={data.platformBreakdown} />
                    </div>
                    <ul className="mt-4 flex flex-col gap-2">
                      {data.platformBreakdown.map((p) => (
                        <li key={p.platform} className="flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="size-2 shrink-0 rounded-full"
                              style={{ background: platformColor(p.platform) }}
                            />
                            <span className="text-xs text-muted-foreground">{platformLabel(p.platform)}</span>
                          </span>
                          <span className="text-xs font-semibold text-foreground tabular-nums">
                            {p.posts} {noun(p.posts, "post")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </SectionCard>
            </div>
          </TabsContent>

          <TabsContent value="timing">
            <PostingTimeHeatmap
              buckets={data.postingBuckets ?? []}
              timeZone={data.postingTimeZone ?? timeZone}
              platform={platform}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
