"use client";
import React, { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Skeleton, EmptyState } from "@pratham7711/ui";
import { Activity, BarChart3, Calendar, Clock, Smartphone, Users } from "lucide-react";
import CampaignComparison from "./CampaignComparison";
import { PostingTimeHeatmap } from "./PostingTimeHeatmap";
import { resolveTimeZone } from "@/lib/analytics/postingTime";
import CreatorLeaderboard, { LeaderboardCreator } from "./CreatorLeaderboard";
import { MetricTile, SectionCard } from "@/components/ds";
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
};

type CampaignOption = { id: string; title: string; status: string };

type AnalyticsData = {
  kpis: KPIs;
  monthlyTrend: { month: string; campaigns: number; active: number }[];
  leaderboard: LeaderboardCreator[];
  platformBreakdown: { platform: string; views: number; posts: number }[];
  campaigns: CampaignOption[];
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
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {legend}
      </span>
      <div role="group" aria-label={legend} className="inline-flex gap-1 rounded-lg bg-muted p-[3px]">
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
        if (d && d.kpis) setData(d);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [range, platform, timeZone]);

  useEffect(() => {
    load();
  }, [load]);

  const k = data?.kpis;

  return (
    <div className="rsp-page page-enter">
      <div className="mb-6">
        <h1 className="text-[26px] font-extrabold tracking-[-0.02em] text-foreground">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How every campaign and creator performed across your whole account.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-start gap-5">
        <PillGroup legend="Date range" options={RANGE_PRESETS} active={range} onChange={setRange} />
        <PillGroup legend="Platform" options={PLATFORM_FILTERS} active={platform} onChange={setPlatform} />
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
          <TabsList variant="line">
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
              <div className="grid grid-cols-2 gap-5 lg:grid-cols-3">
                <MetricTile
                  metric="totalViews"
                  value={formatNumber(k.totalViews)}
                  footer={`${formatNumber(k.totalPosts)} posts`}
                />
                <MetricTile metric="totalLikes" value={formatNumber(k.totalLikes)} />
                <MetricTile metric="totalComments" value={formatNumber(k.totalComments)} />
                {/* Absent entirely when no post in range carries a rate. */}
                {k.engagementSample > 0 && (
                  <MetricTile
                    metric="avgEngagementRate"
                    value={`${k.avgEngagementRate.toFixed(1)}%`}
                    footer={
                      k.engagementSample < k.totalPosts
                        ? `from ${formatNumber(k.engagementSample)} of ${formatNumber(k.totalPosts)} posts`
                        : undefined
                    }
                  />
                )}
              </div>

              <SectionCard
                icon={Calendar}
                title="Campaigns launched"
                description="How many campaigns you started each month over the last six months."
              >
                {data.monthlyTrend.every((m) => m.campaigns === 0) ? (
                  <EmptyState
                    icon={<Calendar size={32} color="var(--cc-text-subtle)" />}
                    title="No campaign data"
                    description="Launch campaigns to see monthly trends."
                  />
                ) : (
                  <div className="h-[220px] md:h-[300px]">
                    <MonthlyTrendArea data={data.monthlyTrend} />
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
                            <span className="text-xs text-muted-foreground">{p.platform}</span>
                          </span>
                          <span className="text-xs font-semibold text-foreground tabular-nums">
                            {p.posts} posts
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
