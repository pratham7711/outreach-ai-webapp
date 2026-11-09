"use client";
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { BarChart2, ChevronDown, Download } from "lucide-react";
import {
  Banner,
  DataTable,
  Dropdown,
  LoadError,
  MenuButton,
  MetricTile,
  NoResults,
  PageHeader,
  SectionCard,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from "@/components/ds";
import { TileGridSkeleton } from "@/components/ui/PageSkeleton";
import { loadCharts } from "@/components/charts/lazyCharts";
import { downloadCsv } from "@/lib/csv";
import { toast } from "sonner";
import { FIN_TOP_WIDTHS } from "./columns";

const PayoutTrendChart = dynamic(() => loadCharts().then((m) => m.PayoutTrendChart), {
  ssr: false,
  loading: () => <Skeleton width="100%" height="100%" />,
});

const PERIODS = [
  { key: "THIS_MONTH", label: "This month" },
  { key: "LAST_MONTH", label: "Last month" },
  { key: "THIS_QUARTER", label: "This quarter" },
  { key: "LAST_QUARTER", label: "Last quarter" },
  { key: "THIS_YEAR", label: "This year" },
  { key: "ALL_TIME", label: "All time" },
];

type Stats = {
  paidPayouts: number;
  pendingPayouts: number;
  totalPayouts: number;
  totalBudget: number;
  campaignCount: number;
  activeCampaigns: number;
  approvedRequests: number;
  pendingRequests: number;
};

type Campaign = {
  id: string;
  title: string;
  status: string;
  budget: number;
  currency: string;
  spend: number;
  utilization: number;
};

type Balance = { label: string; currentBalance: number; currency: string };

type ReportData = {
  period: string;
  previousPeriod: string;
  reportCurrency: string;
  currenciesPresent?: string[];
  hasMixedCurrencies?: boolean;
  current: Stats;
  previous: Stats;
  comparison: {
    payoutsChange: number | null;
    budgetChange: number | null;
    campaignCountChange: number | null;
    requestsChange: number | null;
  };
  monthlyTrend: { month: string; paid: number; pending: number }[];
  topCampaigns: Campaign[];
  balances: Balance[];
};

function toDelta(change: number | null | undefined) {
  if (change === null || change === undefined) return undefined;
  const trend: "up" | "down" | "flat" = change === 0 ? "flat" : change > 0 ? "up" : "down";
  return {
    value: change === 0 ? "No change" : `${Math.abs(change)}%`,
    trend,
    label: change === 0 ? undefined : "vs last period",
  };
}

function fmt(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

function exportCSV(data: ReportData) {
  /* The currency the screen shows travels with the file. A "Budget 40000" cell
     with no currency beside it is not a figure anyone can act on, and this org
     may hold several -- the page already says so in its mixed-currency banner
     and in the Top Campaigns table, and only the download dropped it. */
  const others = (data.currenciesPresent ?? []).filter((c) => c !== data.reportCurrency);
  const rows: string[][] = [
    ["Org Financial Report", data.period],
    ["Report Currency", data.reportCurrency],
    ...(others.length > 0 ? [["Currencies Present (not converted)", others.join(", ")]] : []),
    [],
    ["Metric", "Current", "Previous", "Change %"],
    ["Paid Payouts", String(data.current.paidPayouts), String(data.previous.paidPayouts), String(data.comparison.payoutsChange ?? "—")],
    ["Total Budget", String(data.current.totalBudget), String(data.previous.totalBudget), String(data.comparison.budgetChange ?? "—")],
    ["Campaigns", String(data.current.campaignCount), String(data.previous.campaignCount), String(data.comparison.campaignCountChange ?? "—")],
    ["Approved Requests", String(data.current.approvedRequests), String(data.previous.approvedRequests), String(data.comparison.requestsChange ?? "—")],
    [],
    ["Monthly Trend"],
    ["Month", "Paid", "Pending"],
    ...data.monthlyTrend.map(r => [r.month, String(r.paid), String(r.pending)]),
    [],
    ["Top Campaigns"],
    ["Title", "Status", "Budget", "Currency", "Spend", "Utilization %"],
    ...data.topCampaigns.map(c => [c.title, c.status, String(c.budget), c.currency, String(c.spend), String(c.utilization)]),
  ];

  downloadCsv(`financial-report-${data.period.replace(/\s+/g, "-").toLowerCase()}`, rows);
}

const TOP_COLUMNS: DataTableColumn<Campaign>[] = [
  {
    key: "campaign",
    header: "Campaign",
    width: FIN_TOP_WIDTHS.campaign,
    minWidth: 220,
    primary: true,
    truncate: (c) => c.title,
    render: (c) => c.title,
  },
  {
    key: "status",
    header: "Status",
    width: FIN_TOP_WIDTHS.status,
    render: (c) => <StatusBadge status={c.status} />,
  },
  {
    key: "budget",
    header: "Budget",
    align: "right",
    width: FIN_TOP_WIDTHS.budget,
    render: (c) => fmt(c.budget, c.currency),
  },
  {
    key: "spend",
    header: "Spend",
    align: "right",
    width: FIN_TOP_WIDTHS.spend,
    render: (c) => fmt(c.spend, c.currency),
  },
  {
    key: "utilization",
    header: "Utilization",
    width: FIN_TOP_WIDTHS.utilization,
    render: (c) => (
      <div className="flex items-center gap-3">
        <div
          className="h-1.5 min-w-[60px] flex-1 overflow-hidden rounded-full bg-[var(--cc-bg)]"
          role="presentation"
        >
          {/* Hue here is status: near or over budget. */}
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(c.utilization, 100)}%`,
              background:
                c.utilization >= 90 ? "var(--cc-danger-solid)" : c.utilization >= 70 ? "var(--cc-warning-solid)" : "var(--cc-success-fg)",
            }}
          />
        </div>
        <span className="min-w-10 text-right text-[var(--cc-text-muted)] tabular-nums">{c.utilization}%</span>
      </div>
    ),
  },
];

export default function FinancialReportsPage() {
  const [period, setPeriod] = useState("THIS_MONTH");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/financial-reports?period=${p}`);
      if (!res.ok) throw new Error("Failed to load");
      setData(await res.json());
    } catch {
      setError("Failed to load financial data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(period); }, [period, load]);

  const exportGenerated = async (format: "pdf" | "xlsx") => {
    if (!data) return;
    const setter = format === "pdf" ? setExportingPdf : setExportingXlsx;
    setter(true);
    try {
      const res = await fetch("/api/financial-reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, format }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `financial-report-${data.period.replace(/\s+/g, "-").toLowerCase()}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // The button simply stopped saying "Generating..." and no file arrived.
        toast.error(`Couldn't generate the ${format.toUpperCase()} export. Try again.`);
      }
    } catch {
      toast.error(`Couldn't generate the ${format.toUpperCase()} export. Try again.`);
    } finally {
      setter(false);
    }
  };

  const exporting = exportingPdf || exportingXlsx;

  return (
    <div className="rsp-page page-enter">
      {/* The period and one Export menu, in place of six period pills and three
          export buttons in a row. */}
      <PageHeader
        title="Financial Reports"
        subtitle={data ? `${data.period} vs ${data.previousPeriod}` : "Payout and budget summary with period comparison"}
        actions={
          <>
            <Dropdown
              ariaLabel="Reporting period"
              value={period}
              onChange={setPeriod}
              options={PERIODS.map((p) => ({ value: p.key, label: p.label }))}
              minWidth={150}
            />
            {data ? (
              <MenuButton
                label="Export report"
                triggerClassName="ui-btn ui-btn-secondary ui-btn-md"
                portal
                align="right"
                trigger={
                  <>
                    <Download size={16} aria-hidden="true" />
                    {exporting ? "Generating…" : "Export"}
                    <ChevronDown size={14} aria-hidden="true" />
                  </>
                }
                items={[
                  { label: exportingPdf ? "Generating PDF…" : "Export PDF", disabled: exportingPdf, onClick: () => exportGenerated("pdf") },
                  { label: exportingXlsx ? "Generating Excel…" : "Export Excel", disabled: exportingXlsx, onClick: () => exportGenerated("xlsx") },
                  { label: "Export CSV", onClick: () => exportCSV(data) },
                ]}
              />
            ) : null}
          </>
        }
      />

      {error ? (
        <LoadError title="We couldn't load the financial report" description={error} onRetry={() => load(period)} />
      ) : loading ? (
        <div className="flex flex-col gap-6" aria-busy="true">
          <TileGridSkeleton count={4} />
          <SectionCard title="Payout trend" description="Last 6 months of payout activity">
            <Skeleton width="100%" height={240} />
          </SectionCard>
          <SectionCard title="Top campaigns" description="By budget, most recent" padded={false}>
            <DataTable bare caption="Top campaigns" columns={TOP_COLUMNS} rows={[]} rowKey={(c) => c.id} loading skeletonRows={5} />
          </SectionCard>
        </div>
      ) : data ? (
        <div className="flex flex-col gap-6">
          {data.hasMixedCurrencies && (
            <Banner tone="warning" role="status">
              Summary totals are shown in {data.reportCurrency}. This org also holds amounts in{" "}
              {(data.currenciesPresent ?? []).filter((c) => c !== data.reportCurrency).join(", ")} — those are
              not converted; see per-currency balances and campaigns below.
            </Banner>
          )}

          <div className="cc-tiles-balanced">
            <MetricTile
              metric="paidPayouts"
              value={fmt(data.current.paidPayouts, data.reportCurrency)}
              footer={`${fmt(data.previous.paidPayouts, data.reportCurrency)} last period`}
              delta={toDelta(data.comparison.payoutsChange)}
            />
            <MetricTile
              metric="pendingPayouts"
              /* Period-scoped like everything else on this report: payouts
                 raised inside the reporting period, not your whole outstanding
                 balance. The two differ the moment a payout sits unpaid across
                 a month boundary. */
              how="Adds up payouts marked Pending that were raised inside the reporting period."
              value={fmt(data.current.pendingPayouts, data.reportCurrency)}
              footer={`${data.current.approvedRequests > 0 ? fmt(data.current.approvedRequests, data.reportCurrency) + " approved requests" : "No pending requests"}`}
            />
            <MetricTile
              metric="totalBudget"
              value={fmt(data.current.totalBudget, data.reportCurrency)}
              footer={`${fmt(data.previous.totalBudget, data.reportCurrency)} last period`}
              delta={toDelta(data.comparison.budgetChange)}
            />
            <MetricTile
              metric="campaigns"
              /* Overridden because this tile is period-scoped and the shared
                 definition is not: the query filters campaigns on createdAt
                 inside the reporting period, so a workspace with 40 campaigns
                 shows 3 here for a month in which it started three. The
                 unqualified "in total" reading made that look like data loss. */
              what="How many campaigns your team started inside the reporting period. Campaigns created earlier are not counted, however active they still are."
              how="Counts campaigns whose creation date falls in the period, deleted ones excluded."
              value={String(data.current.campaignCount)}
              footer={`${data.current.activeCampaigns} active`}
              delta={toDelta(data.comparison.campaignCountChange)}
            />
          </div>

          {/* Per-account balances, each in its own currency: figures inside one
              card rather than a second row of tiles beside the KPIs. */}
          {data.balances.length > 0 && (
            <SectionCard title="Balances">
              <div className="cc-tiles-balanced">
                {data.balances.map((b) => (
                  <MetricTile key={b.label} variant="plain" label={b.label} value={fmt(b.currentBalance, b.currency)} />
                ))}
              </div>
            </SectionCard>
          )}

          <SectionCard title="Payout trend" description="Last 6 months of payout activity">
            {data.monthlyTrend.length === 0 ? (
              <NoResults
                icon={<BarChart2 size={32} strokeWidth={1.75} />}
                title="No payout data"
                description="Payouts will appear here as they are recorded."
              />
            ) : (
              <div className="h-60 w-full">
                <PayoutTrendChart data={data.monthlyTrend} currency={data.reportCurrency} />
              </div>
            )}
          </SectionCard>

          <SectionCard title="Top campaigns" description="By budget, most recent" padded={false}>
            <DataTable
              bare
              caption="Top campaigns"
              columns={TOP_COLUMNS}
              rows={data.topCampaigns}
              rowKey={(c) => c.id}
              rowHref={(c) => `/campaigns/${c.id}`}
              empty={
                <NoResults
                  icon={<BarChart2 size={32} strokeWidth={1.75} />}
                  title="No campaigns"
                  description="Campaigns will appear here once created."
                />
              }
            />
          </SectionCard>
        </div>
      ) : null}
    </div>
  );
}
