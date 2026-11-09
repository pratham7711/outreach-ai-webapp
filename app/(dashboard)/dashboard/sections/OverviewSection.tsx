"use client";

import React from "react";
import dynamic from "next/dynamic";
import { BarChart3 } from "lucide-react";
import { MetricHint, MetricTile, SectionCard, Skeleton } from "@/components/ds";
import { loadCharts } from "@/components/charts/lazyCharts";
import { formatNumber, type PerformanceData } from "../types";
import { asOfCaption } from "@/lib/dataAge";
import { countDelta } from "@/lib/analytics/periodGrowth";
import { SeriesModeToggle } from "@/components/charts/SeriesModeToggle";
import { periodLabel, type SeriesMode } from "@/lib/charts/seriesMode";

/* The granularity dropdown above already says "Monthly"; the chart's own
   switch names what the bars are instead, so the page doesn't say it twice. */
const PER_PERIOD = { Daily: "Per day", Weekly: "Per week", Monthly: "Per month" } as const;

const ViewsOverTimeArea = dynamic(
  () => loadCharts().then((m) => m.ViewsOverTimeArea),
  { ssr: false, loading: () => <Skeleton height={400} /> }
);

type OverviewSectionProps = {
  financials: PerformanceData | null;
  previous?: PerformanceData | null;
  periodDays?: number;
  loading: boolean;
  widgets: string[];
  fallbackCampaignCount: number;
  fallbackCreatorCount: number;
};

export function OverviewSection({
  financials,
  previous,
  periodDays,
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
  const prevPosts = previous?.platformBreakdown?.reduce((n, p) => n + p.postsCount, 0);
  const vsLabel = periodDays ? `vs the ${periodDays} days before` : "vs the period before";
  const [viewsMode, setViewsMode] = React.useState<SeriesMode>("cumulative");
  /* A total over posts none of which has a view count is unknown, not 0: on 7D
     the tile read "TOTAL VIEWS 0" beside "TOTAL POSTS 5" -- five Instagram
     photos, which publish no view count. The caption says when the total was
     read and, when partial, how many posts it covers. */
  const viewsKnown = s?.viewsKnownPosts;
  const viewsUnknown = viewsKnown === 0 && totalPosts > 0;
  const viewsCaption =
    viewsKnown === undefined || !s ? null : asOfCaption(s.asOf ?? null, { known: viewsKnown, total: totalPosts, what: "views" });

  /* The server-rendered fallbacks are org-wide totals, while both tiles are
     labelled for the range picked above. Until the ranged numbers land the tile
     therefore states a number that is not the one it claims to be — measured on
     /dashboard as "512 active campaigns" and "1832 creators" for several seconds
     before 8 and 1 replaced them. A placeholder is honest; a wrong number the
     reader has already taken in is not.
     The same holds after a range change: the previous range's figures used to
     stay up, unmarked, until the new ones replaced them, so a click on 7D
     showed the 6M totals under a 7-day heading for as long as the request
     took. Any request in flight now blanks the tiles. */
  const pending = loading;
  const tileValue = (value: React.ReactNode) =>
    pending ? <Skeleton width={96} height={28} /> : value;
  /* The tiles share one figure size, set by the longest of them. */
  const tileFit = pending || !s
    ? 0
    : Math.max(
        String(s.activeCampaigns).length,
        String(s.totalCreators).length,
        platforms.length > 0 ? formatNumber(totalViews).length : 0,
        platforms.length > 0 ? formatNumber(totalPosts).length : 0,
      );

  return (
    <div className="flex flex-col gap-6">
      {widgets.includes("kpi_grid") && (
        <div className="cc-tiles-balanced" aria-busy={pending}>
          <MetricTile
            fitTo={tileFit}
            metric="activeCampaigns"
            value={tileValue(String(s ? s.activeCampaigns : fallbackCampaignCount))}
          />
          {/* Creators who posted in the selected range, so the tile moves
              with the range picker like the two beside it. It counted every
              creator holding an activation and read 6 on every range. The
              help text is restated here for the same reason as Total Views'. */}
          <MetricTile
            fitTo={tileFit}
            metric="workspaceCreators"
            what="How many different creators published at least one post in the selected range."
            how="Counts each creator once, however many posts or campaigns they have in the range chosen above. Posts nobody could attribute to a creator are not counted."
            value={tileValue(String(s ? s.totalCreators : fallbackCreatorCount))}
            delta={pending || !s ? undefined : countDelta(s.totalCreators, previous?.summary?.totalCreators, vsLabel)}
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
                fitTo={tileFit}
                metric="totalViews"
                what="How many times posts published in the selected range have been watched, counting each post's lifetime views."
                how="Adds up the latest view count of every tracked post published inside the range chosen above. The chart below is not filtered this way — each of its points covers every post the workspace holds, so its numbers are larger."
                value={tileValue(viewsUnknown ? "\u2014" : formatNumber(totalViews))}
                footer={pending ? null : viewsCaption}
              />
              <MetricTile
                fitTo={tileFit}
                metric="totalPosts"
                what="How many pieces of content your creators published in the selected range."
                how="Counts tracked posts with a publish date inside the range chosen above, whether or not they are still live."
                value={tileValue(formatNumber(totalPosts))}
                delta={pending ? undefined : countDelta(totalPosts, prevPosts, vsLabel)}
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
             row per org per day at 00:30 UTC holding the lifetime views of every
             post the org holds, and the line joins those readings. Each point is
             a running total (it only goes up), and the series starts the day the
             first reading landed -- there is no history to backfill, because
             history was never recorded. */
          /* The method used to be the description: two 12px lines in the
             card header saying when readings are taken and what they cover.
             One line stays there; the rest is the hint's, where the other
             metrics keep theirs. */
          action={
            <span className="flex items-center gap-3">
              <MetricHint
                label="Views over time"
                what={
                  viewsMode === "daily"
                    ? "Views gained in each period: the change from the previous period's last reading. A period is left blank when the one before it has no reading, and a bar below zero means posts left the workspace or a platform corrected its count."
                    : "The lifetime views of every post in this workspace, read once a day. A video in two campaigns is counted once, and posts older than the range the tiles above use are included."
                }
                how="One reading is taken each day at 00:30 UTC. The line starts from the first reading; earlier days were never measured."
              />
              {!loading && series.length >= 2 ? (
                <SeriesModeToggle
                  label="Views over time"
                  value={viewsMode}
                  onChange={setViewsMode}
                  periodLabel={PER_PERIOD[periodLabel(series[0]?.date)]}
                />
              ) : null}
            </span>
          }
        >
          {loading ? (
            <Skeleton height={400} />
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
                  <p className="text-xs font-medium text-[var(--cc-text-muted)]">
                    First reading · {series[0].date}
                  </p>
                  <p className="text-[40px] leading-none font-bold tracking-[-0.02em] text-[var(--cc-text)] tabular-nums">
                    {formatNumber(series[0].views)}
                  </p>
                  <p className="max-w-sm text-xs text-[var(--cc-text-muted)]">
                    Lifetime views across {formatNumber(series[0].posts)} posts. The next reading
                    is taken at 00:30 UTC — from two readings on, this becomes a line.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-[var(--cc-text)]">No readings yet</p>
                  <p className="max-w-sm text-xs text-[var(--cc-text-muted)]">
                    Views are measured once a day at 00:30 UTC. The first reading appears after
                    the next run, and the line builds from there.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="h-[240px] md:h-[400px]">
              <ViewsOverTimeArea data={series} formatNumber={formatNumber} mode={viewsMode} />
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
