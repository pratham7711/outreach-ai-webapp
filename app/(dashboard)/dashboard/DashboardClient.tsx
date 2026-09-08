"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Activity, BarChart3, Clock, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OverviewSection } from "./sections/OverviewSection";
import { PerformanceSection } from "./sections/PerformanceSection";
import { ActivitySection } from "./sections/ActivitySection";
import { GettingStarted } from "./sections/GettingStarted";
import type { Campaign, PerformanceData } from "./types";

const DATE_PRESETS = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
];

const GRANULARITIES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
] as const;

const DEFAULT_WIDGETS = [
  "kpi_grid",
  "views_over_time",
  "platform_breakdown",
  "top_posts",
  "campaign_reach",
  "creator_performance",
];

const PERFORMANCE_WIDGETS = [
  "platform_breakdown",
  "campaign_reach",
  "top_posts",
  "creator_performance",
];

type Props = {
  campaignCount: number;
  creatorCount: number;
  recentCampaigns: Campaign[];
  dashboardWidgets: string[] | null;
};

export default function DashboardClient(props: Props) {
  const widgets = props.dashboardWidgets ?? DEFAULT_WIDGETS;
  const hasPerformance = PERFORMANCE_WIDGETS.some((w) => widgets.includes(w));

  const [financials, setFinancials] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [activeDays, setActiveDays] = useState(180);
  const [granularity, setGranularity] = useState<"daily" | "weekly" | "monthly">("monthly");

  const rangeParams = useCallback(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - activeDays);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [activeDays]);

  const fetchFinancials = useCallback(async () => {
    setLoading(true);
    const { from, to } = rangeParams();
    try {
      const res = await fetch(
        `/api/dashboard/financials?${new URLSearchParams({ from, to, granularity })}`
      );
      if (!res.ok) throw new Error(String(res.status));
      setFinancials(await res.json());
      setLoadError(false);
    } catch {
      // Without this branch a failed request left `financials` null silently, and
      // the panel below then said "No readings yet" — a statement about the data
      // when the truth is that we never received an answer.
      setFinancials(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [rangeParams, granularity]);

  useEffect(() => {
    fetchFinancials();
  }, [fetchFinancials]);

  const handleExport = useCallback(
    (type: string) => {
      const { from, to } = rangeParams();
      window.open(
        `/api/dashboard/financials/export?${new URLSearchParams({ from, to, type })}`,
        "_blank"
      );
    },
    [rangeParams]
  );

  const activePreset = DATE_PRESETS.find((p) => p.days === activeDays);

  return (
    <div className="cc-page-content rsp-page">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-[-0.02em] text-foreground">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activePreset
              ? `Your totals for the last ${activePreset.label.replace("D", " days").replace("M", " months").replace("Y", " year")}.`
              : "Your totals at a glance."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Date range"
            className="flex flex-wrap gap-1 rounded-lg bg-muted p-[3px]"
          >
            {DATE_PRESETS.map((p) => {
              const active = activeDays === p.days;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setActiveDays(p.days)}
                  aria-pressed={active}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? "bg-card text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <Select
            value={granularity}
            onValueChange={(v) => setGranularity(v as typeof granularity)}
          >
            <SelectTrigger size="sm" className="w-[112px]" aria-label="Chart granularity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRANULARITIES.map((g) => (
                <SelectItem key={g.value} value={g.value}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={() => handleExport("campaigns")}>
            <Download aria-hidden="true" className="size-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="mb-7 empty:mb-0">
        <GettingStarted />
      </div>

      {loadError && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3"
        >
          <span className="text-sm text-foreground">
            Couldn&apos;t load your totals. The figures below are unavailable, not zero.
          </span>
          <Button variant="outline" size="sm" onClick={fetchFinancials}>
            Retry
          </Button>
        </div>
      )}

      <Tabs defaultValue="overview" className="gap-6">
        <TabsList variant="line">
          <TabsTrigger value="overview">
            <BarChart3 aria-hidden="true" />
            Overview
          </TabsTrigger>
          {hasPerformance && (
            <TabsTrigger value="performance">
              <Activity aria-hidden="true" />
              Performance
            </TabsTrigger>
          )}
          <TabsTrigger value="activity">
            <Clock aria-hidden="true" />
            Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewSection
            financials={financials}
            loading={loading}
            widgets={widgets}
            fallbackCampaignCount={props.campaignCount}
            fallbackCreatorCount={props.creatorCount}
          />
        </TabsContent>

        {hasPerformance && (
          <TabsContent value="performance">
            <PerformanceSection
              financials={financials}
              loading={loading}
              widgets={widgets}
              onExportCreators={() => handleExport("creators")}
            />
          </TabsContent>
        )}

        <TabsContent value="activity">
          <ActivitySection recentCampaigns={props.recentCampaigns} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
