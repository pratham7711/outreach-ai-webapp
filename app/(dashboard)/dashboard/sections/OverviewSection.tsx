"use client";

import React from "react";
import dynamic from "next/dynamic";
import { BarChart3 } from "lucide-react";
import { MetricTile, SectionCard } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, type PerformanceData } from "../types";

const ViewsOverTimeArea = dynamic(
  () => import("../DashboardCharts").then((m) => m.ViewsOverTimeArea),
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

  return (
    <div className="flex flex-col gap-6">
      {widgets.includes("kpi_grid") && (
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          <MetricTile
            metric="activeCampaigns"
            value={String(s ? s.activeCampaigns : fallbackCampaignCount)}
          />
          <MetricTile
            metric="campaignCreators"
            value={String(s ? s.totalCreators : fallbackCreatorCount)}
          />
          {/* Both come from the same platform rollup, so they are either
              genuinely measured together or genuinely absent together — and
              when they are absent the tiles are not drawn. */}
          {platforms.length > 0 && (
            <>
              <MetricTile metric="totalViews" value={formatNumber(totalViews)} />
              <MetricTile metric="totalPosts" value={formatNumber(totalPosts)} />
            </>
          )}
        </div>
      )}

      {widgets.includes("views_over_time") && (
        <SectionCard
          icon={BarChart3}
          title="Views over time"
          description="Total views across every tracked post, by the date it was measured."
        >
          {loading ? (
            <Skeleton className="h-[400px] w-full rounded-lg" />
          ) : (
            <div className="h-[400px]">
              <ViewsOverTimeArea
                data={financials?.viewsOverTime ?? []}
                formatNumber={formatNumber}
              />
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
