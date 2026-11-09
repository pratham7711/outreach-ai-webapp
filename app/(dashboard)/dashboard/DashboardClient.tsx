"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Activity, BarChart3, Clock, Download } from "lucide-react";
import { OverviewSection } from "./sections/OverviewSection";
import { PerformanceSection } from "./sections/PerformanceSection";
import { ActivitySection } from "./sections/ActivitySection";
import type { ActivityEvent, Campaign, PerformanceData } from "./types";
import { PageHeader, Button as DsButton, Dropdown, LoadError, StatusTabs } from "@/components/ds";
import { action } from "@/lib/ui/actions";

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
  recentEvents: ActivityEvent[];
  dashboardWidgets: string[] | null;
};

export default function DashboardClient(props: Props) {
  const widgets = props.dashboardWidgets ?? DEFAULT_WIDGETS;
  const hasPerformance = PERFORMANCE_WIDGETS.some((w) => widgets.includes(w));

  const [financials, setFinancials] = useState<PerformanceData | null>(null);
  /* The same figures for the window of equal length just before, for the
     tiles' change pills. Its failure only drops the pills. */
  const [previous, setPrevious] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [activeDays, setActiveDays] = useState(180);
  const [granularity, setGranularity] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [section, setSection] = useState<"overview" | "performance" | "activity">("overview");

  const rangeParams = useCallback(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - activeDays);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [activeDays]);

  const fetchFinancials = useCallback(async () => {
    setLoading(true);
    const { from, to } = rangeParams();
    const prevFrom = new Date(new Date(from).getTime() - activeDays * 86_400_000).toISOString();
    const prevReq = fetch(`/api/dashboard/financials?${new URLSearchParams({ from: prevFrom, to: from, granularity })}`)
      .then((r) => (r.ok ? (r.json() as Promise<PerformanceData>) : null))
      .catch(() => null);
    try {
      const res = await fetch(
        `/api/dashboard/financials?${new URLSearchParams({ from, to, granularity })}`
      );
      if (!res.ok) throw new Error(String(res.status));
      setFinancials(await res.json());
      setPrevious(await prevReq);
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
  }, [rangeParams, granularity, activeDays]);

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


  return (
    <div className="cc-page-content rsp-page">
      <PageHeader
        title="Dashboard"
        actions={
          <>
            {/* A segmented control at the header's one control height: the
                range, the granularity and Export read as one cluster of
                36px, 14px controls rather than three kinds at 28px. */}
            <div role="group" aria-label="Date range" className="cc-segmented">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="cc-segmented-btn"
                  onClick={() => setActiveDays(p.days)}
                  aria-pressed={activeDays === p.days}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Dropdown
              value={granularity}
              onChange={(v) => setGranularity(v as typeof granularity)}
              options={GRANULARITIES.map((g) => ({ value: g.value, label: g.label }))}
              ariaLabel="Chart granularity"
              size="md"
              minWidth={120}
            />
            <DsButton variant="secondary" iconLeft={<Download size={16} aria-hidden="true" />} onClick={() => handleExport("campaigns")} className="cc-phone-hide" {...action("export-csv")}>
              Export CSV
            </DsButton>
          </>
        }
        tabs={
          <StatusTabs
            ariaLabel="Dashboard sections"
            idBase="dashboard"
            tabs={[
              { key: "overview", label: "Overview", icon: <BarChart3 size={16} aria-hidden="true" /> },
              ...(hasPerformance ? [{ key: "performance", label: "Performance", icon: <Activity size={16} aria-hidden="true" /> }] : []),
              { key: "activity", label: "Activity", icon: <Clock size={16} aria-hidden="true" /> },
            ]}
            active={section}
            onChange={(key) => setSection(key as typeof section)}
          />
        }
      />

      {loadError && (
        <div className="mb-6">
          <LoadError
            title="Couldn't load your totals"
            description="The figures below are unavailable, not zero."
            onRetry={fetchFinancials}
            retrying={loading}
          />
        </div>
      )}

      <div role="tabpanel" id="dashboard-panel" aria-labelledby={`dashboard-tab-${section}`}>
        {section === "overview" && (
          <OverviewSection
            financials={financials}
            previous={previous}
            periodDays={activeDays}
            loading={loading}
            widgets={widgets}
            fallbackCampaignCount={props.campaignCount}
            fallbackCreatorCount={props.creatorCount}
          />
        )}

        {hasPerformance && section === "performance" && (
          <PerformanceSection
            financials={financials}
            loading={loading}
            widgets={widgets}
            onExportCreators={() => handleExport("creators")}
          />
        )}

        {section === "activity" && (
          <ActivitySection recentCampaigns={props.recentCampaigns} recentEvents={props.recentEvents} />
        )}
      </div>
    </div>
  );
}
