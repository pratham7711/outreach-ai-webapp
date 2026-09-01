"use client";

import React from "react";
import dynamic from "next/dynamic";
import { BarChart3 } from "lucide-react";
import { MetricTile, SectionCard } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { loadCharts } from "@/components/charts/lazyCharts";
import { formatNumber, type PerformanceData } from "../types";

const ViewsOverTimeArea = dynamic(
  () => loadCharts().then((m) => m.ViewsOverTimeArea),
  { ssr: false, loading: () => <Skeleton className="h-[400px] w-full rounded-lg" /> }
);

type OverviewSectionProps = {
  financials: PerformanceData | null;
  loading: boolean;
  widgets: string[];
  fallbackCampaignCount: number;
  fallbackCreatorCount: number;
};

export function OverviewSection({
  financials,
  loading,
  widgets,
  fallbackCampaignCount,
  fallbackCreatorCount,
}: OverviewSectionProps) {
  const s = financials?.summary;
  const platforms = financials?.platformBreakdown ?? [];
  const totalViews = platforms.reduce((n, p) => n + p.views, 0);
  const totalPosts = platforms.reduce((n, p) => n + p.postsCount, 0);
  const series = financials?.viewsOverTime ?? [];


  return (
    <div className="flex flex-col gap-6">
      {widgets.includes("kpi_grid") && (
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          <MetricTile

            metric="activeCampaigns"
            value={String(s ? s.activeCampaigns : fallbackCampaignCount)}
          />
          {/* workspaceCreators, not campaignCreators: this is every creator
              booked anywhere in the workspace, counted once. The campaign
              definition's help text said "on this campaign", which is a
              different number on any account running more than one. */}
          <MetricTile
            metric="workspaceCreators"
            value={String(s ? s.totalCreators : fallbackCreatorCount)}
          />
          {/* Both come from the same platform rollup, so they are either
              genuinely measured together or genuinely absent together — and
              when they are absent the tiles are not drawn. */}
          {platforms.length > 0 && (
            <>
              {/* Overridden on this screen because the chart below them is NOT
                  scoped the same way, and the gap is large enough to look like
                  a bug: on production the tiles read 334.3M and the chart's
                  point reads 1.80bn.
                  Both follow the range picker above -- these tiles cover posts
                  PUBLISHED in the selected range, while a chart point is a
                  lifetime reading across every post the workspace holds, taken
                  on that day. Narrowing the range moves the tiles a lot and the
                  chart's values not at all; it only drops older readings off
                  the left. */}
              <MetricTile
                metric="totalViews"
                what="How many times posts published in the selected range have been watched, counting each post's lifetime views."
                how="Adds up the latest view count of every tracked post published inside the range chosen above. The chart below is not filtered this way — each of its points covers every post the workspace holds, so its numbers are larger."
                value={formatNumber(totalViews)}
              />
              <MetricTile
                metric="totalPosts"
                what="How many pieces of content your creators published in the selected range."
                how="Counts tracked posts with a publish date inside the range chosen above, whether or not they are still live."
                value={formatNumber(totalPosts)}
              />
            </>
          )}
        </div>
      )}

      {widgets.includes("views_over_time") && (
        <SectionCard
          icon={BarChart3}
          title="Views over time"
          /* This label has been wrong twice, in the one word that decides how
             the chart is read.
             It first said "by the date it was measured", when nothing was being
             measured: the query bucketed posts by publication date and gave each
             one its CURRENT view count. So the past moved -- a March post gaining
             views today raised March and every point after it -- and the chart
             you screenshotted last week no longer matched the chart today.
             It is now genuinely measured: /api/cron/snapshot-org-views writes one
             row per org per day at 03:30 UTC holding the lifetime views of every
             post the org holds, and the line joins those readings. Each point is
             a running total (it only goes up), and the series starts the day the
             first reading landed -- there is no history to backfill, because
             history was never recorded. */
          description="One reading per day, taken at 03:30 UTC: the lifetime views of every post in this workspace as of that morning — including posts older than the range the tiles above use. The line starts from the first reading; earlier days were never measured."
        >
          {loading ? (
            <Skeleton className="h-[400px] w-full rounded-lg" />
          ) : series.length < 2 ? (
            /* A chart needs two points to be a chart.
               An empty area chart is indistinguishable from a workspace with
               zero views, and ONE point is worse: a single dot floating in the
               middle of a 400px card, against a y-axis running to 2B, reads as
               a rendering failure rather than as a first reading. Both cases
               get the reading stated plainly and a sentence saying when the
               line starts. */
            <div className="flex h-[400px] flex-col items-center justify-center gap-3 text-center">
              {series.length === 1 ? (
                <>
                  <p className="text-[11px] font-medium tracking-[0.06em] text-[var(--cc-text-muted)] uppercase">
                    First reading · {series[0].date}
                  </p>
                  <p className="text-[40px] leading-none font-bold tracking-[-0.02em] text-[var(--cc-text)] tabular-nums">
                    {formatNumber(series[0].views)}
                  </p>
                  <p className="max-w-sm text-xs text-[var(--cc-text-muted)]">
                    Lifetime views across {formatNumber(series[0].posts)} posts. The next reading
                    is taken at 03:30 UTC — from two readings on, this becomes a line.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-[var(--cc-text)]">No readings yet</p>
                  <p className="max-w-sm text-xs text-[var(--cc-text-muted)]">
                    Views are measured once a day at 03:30 UTC. The first reading appears after
                    the next run, and the line builds from there.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="h-[400px]">
              <ViewsOverTimeArea data={series} formatNumber={formatNumber} />
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
