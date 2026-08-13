"use client";

import React from "react";
import dynamic from "next/dynamic";
import { BarChart3 } from "lucide-react";
import { MetricTile, SectionCard } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMetric, periodDelta } from "@/lib/metrics";
import { formatCurrency, formatNumber, type FinancialData } from "../types";

const SpendOverTimeArea = dynamic(
  () => import("../DashboardCharts").then((m) => m.SpendOverTimeArea),
  { ssr: false, loading: () => <Skeleton className="h-[400px] w-full rounded-lg" /> }
);

type OverviewSectionProps = {
  financials: FinancialData | null;
  loading: boolean;
  widgets: string[];
  fallbackChartData: { month: string; spend: number }[];
  fallbackCampaignCount: number;
  fallbackCreatorCount: number;
  fallbackPendingPayouts: number;
};

export function OverviewSection({
  financials,
  loading,
  widgets,
  fallbackChartData,
  fallbackCampaignCount,
  fallbackCreatorCount,
  fallbackPendingPayouts,
}: OverviewSectionProps) {
  const s = financials?.summary;
  const series = financials?.spendOverTime ?? [];

  // Direction and tone are deliberately separate. Spend climbing is not a win on
  // its own, so it reads neutral-negative; reach climbing is. periodDelta returns
  // null when there is too little history, and the tile then shows no delta at
  // all rather than a meaningless 0%.
  const spendDelta = periodDelta(series.map((d) => d.spend), {
    higherIsBetter: false,
    label: "spend vs previous period",
  });
  const viewsDelta = periodDelta(series.map((d) => d.views), {
    higherIsBetter: true,
    label: "views vs previous period",
  });

  return (
    <div className="flex flex-col gap-6">
      {widgets.includes("kpi_grid") && (
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          <MetricTile
            metric="totalSpend"
            value={formatMetric(s?.totalSpend, formatCurrency)}
            delta={spendDelta ?? undefined}
            footer={s ? `${s.budgetUtilization.toFixed(1)}% of total budget used` : undefined}
          />
          <MetricTile
            metric="activeCampaigns"
            value={String(s ? s.activeCampaigns : fallbackCampaignCount)}
          />
          <MetricTile
            metric="pendingPayouts"
            value={formatMetric(s?.pendingPayouts ?? fallbackPendingPayouts, formatCurrency)}
          />
          <MetricTile
            metric="views"
            value={formatMetric(
              series.length ? series.reduce((sum, d) => sum + d.views, 0) : null,
              formatNumber,
            )}
            delta={viewsDelta ?? undefined}
            footer={`${s ? s.totalCreators : fallbackCreatorCount} creators paid`}
          />
        </div>
      )}

      {widgets.includes("financial_summary") && s && (
        <div className="rounded-xl border border-border bg-card px-6 py-5">
          <h2 className="mb-4 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Budget &amp; escrow
          </h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4 lg:divide-x lg:divide-border">
            <MetricTile variant="plain" metric="totalBudget" value={formatCurrency(s.totalBudget)} />
            <div className="lg:pl-6">
              <MetricTile
                variant="plain"
                metric="avgCampaignSpend"
                value={formatCurrency(s.avgCampaignSpend)}
              />
            </div>
            <div className="lg:pl-6">
              <MetricTile
                variant="plain"
                metric="totalDeposits"
                value={formatCurrency(s.totalDeposits)}
              />
            </div>
            <div className="lg:pl-6">
              <MetricTile
                variant="plain"
                metric="releasedDeposits"
                value={formatCurrency(s.releasedDeposits)}
              />
            </div>
          </div>
        </div>
      )}

      {widgets.includes("views_over_time") && (
        <SectionCard
          icon={BarChart3}
          title="Spend and views over time"
          description="Each measure has its own scale, so the two panels are read separately."
        >
          {loading ? (
            <Skeleton className="h-[400px] w-full rounded-lg" />
          ) : (
            <div className="h-[400px]">
              <SpendOverTimeArea
                data={
                  financials?.spendOverTime ??
                  fallbackChartData.map((d) => ({ date: d.month, spend: d.spend, views: 0 }))
                }
                formatNumber={formatNumber}
                formatCurrency={formatCurrency}
              />
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
