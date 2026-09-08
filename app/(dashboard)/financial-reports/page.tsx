"use client";
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Card, Badge, Skeleton, EmptyState } from "@pratham7711/ui";
import { PageHeader, MetricTile, Button } from "@/components/ds";
import { TrendingUp, TrendingDown, Minus, DollarSign, Wallet, BarChart2, Clock, Download, FileText, Table, TriangleAlert } from "lucide-react";
import { loadCharts } from "@/components/charts/lazyCharts";
import { downloadCsv } from "@/lib/csv";
import { campaignStatusCss, STATUS_PILL_RADIUS } from "@/lib/statusColors";
import { toast } from "sonner";

const PayoutTrendChart = dynamic(() => loadCharts().then((m) => m.PayoutTrendChart), {
  ssr: false,
  loading: () => <Skeleton width="100%" height="100%" borderRadius="8px" />,
});

const PERIODS = [
  { key: "THIS_MONTH", label: "This Month" },
  { key: "LAST_MONTH", label: "Last Month" },
  { key: "THIS_QUARTER", label: "This Quarter" },
  { key: "LAST_QUARTER", label: "Last Quarter" },
  { key: "THIS_YEAR", label: "This Year" },
  { key: "ALL_TIME", label: "All Time" },
];

/* The campaign statuses here are the same statuses the campaigns list shows,
   so they read from the one captured palette rather than a second private copy
   that had drifted: this table painted Active as a pale indigo tint where the
   reference gives it a solid blue, so the running campaigns were the ones that
   disappeared into the page. */

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

function ChangeChip({ value }: { value: number | null }) {
  if (value === null) return <span style={{ fontSize: 11, color: "var(--cc-text-subtle)" }}>—</span>;
  const positive = value >= 0;
  const Icon = value === 0 ? Minus : positive ? TrendingUp : TrendingDown;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600,
      padding: "2px 7px", borderRadius: 20,
      background: value === 0 ? "#F3F4F6" : positive ? "#D1FAE5" : "#FEE2E2",
      color: value === 0 ? "#6B7280" : positive ? "#059669" : "#DC2626",
    }}>
      <Icon size={10} />
      {value === 0 ? "No change" : `${Math.abs(value)}%`}
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  change,
  color = "var(--cc-primary)",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  change?: number | null;
  color?: string;
}) {
  return (
    <Card variant="outlined" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={16} color={color} />
        </div>
        {change !== undefined && <ChangeChip value={change ?? null} />}
      </div>
      <p style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 4px" }}>{value}</p>
      <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>{label}</p>
      {sub && <p style={{ fontSize: 11, color: "var(--cc-text-subtle)", margin: "4px 0 0" }}>{sub}</p>}
    </Card>
  );
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

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Financial Reports"
        subtitle={data ? `${data.period} vs ${data.previousPeriod}` : "Payout and budget summary with period comparison"}
        actions={
          data ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => exportGenerated("pdf")} disabled={exportingPdf}>
                <FileText size={14} style={{ marginRight: 6 }} />
                {exportingPdf ? "Generating..." : "Export PDF"}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => exportGenerated("xlsx")} disabled={exportingXlsx}>
                <Table size={14} style={{ marginRight: 6 }} />
                {exportingXlsx ? "Generating..." : "Export Excel"}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => exportCSV(data)}>
                <Download size={14} style={{ marginRight: 6 }} />
                Export CSV
              </Button>
            </>
          ) : null
        }
      />

      {/* Period Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, flexWrap: "wrap" }}>
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            aria-pressed={period === p.key}
            style={{
              padding: "0 10px", height: 40, borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: "pointer",
              border: period === p.key ? "1.5px solid var(--cc-primary)" : "1.5px solid var(--cc-border)",
              background: period === p.key ? "var(--cc-primary)" : "var(--cc-card)",
              color: period === p.key ? "white" : "var(--cc-text-muted)",
              transition: "all 0.1s",
              whiteSpace: "nowrap",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error ? (
        <Card variant="outlined" style={{ padding: 40, textAlign: "center" }}>
          <p style={{ color: "#DC2626", fontSize: 14 }}>{error}</p>
          <Button variant="secondary" size="sm" onClick={() => load(period)} style={{ marginTop: 12 }}>Retry</Button>
        </Card>
      ) : loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
            {[...Array(4)].map((_, i) => <Skeleton key={i} width="100%" height="100px" borderRadius="12px" />)}
          </div>
          <Skeleton width="100%" height="260px" borderRadius="12px" />
          <Skeleton width="100%" height="200px" borderRadius="12px" />
        </div>
      ) : data ? (
        <>
          {data.hasMixedCurrencies && (
            <div
              role="note"
              style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "10px 14px",
                borderRadius: 10, background: "#FEF3C7", border: "1px solid #FDE68A",
                fontSize: 13, color: "#92400E",
              }}
            >
              <TriangleAlert size={15} />
              <span>
                Summary totals are shown in {data.reportCurrency}. This org also holds amounts in{" "}
                {(data.currenciesPresent ?? []).filter((c) => c !== data.reportCurrency).join(", ")} — those are
                not converted; see per-currency balances and campaigns below.
              </span>
            </div>
          )}
          {/* Stat Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
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

          {/* Balances */}
          {data.balances.length > 0 && (
            <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
              {data.balances.map(b => (
                <div key={b.label} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--cc-border)", background: "var(--cc-card)" }}>
                  <p style={{ fontSize: 11, color: "var(--cc-text-muted)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{b.label}</p>
                  <p style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>{fmt(b.currentBalance, b.currency)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Monthly Trend Chart */}
          <Card variant="outlined" style={{ padding: 24, marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Payout Trend</h2>
            <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 20 }}>Last 6 months of payout activity</p>
            {data.monthlyTrend.length === 0 ? (
              <EmptyState
                icon={<BarChart2 size={32} color="var(--cc-text-subtle)" />}
                title="No payout data"
                description="Payouts will appear here as they are recorded."
              />
            ) : (
              <div style={{ width: "100%", height: 240 }}>
                <PayoutTrendChart data={data.monthlyTrend} />
              </div>
            )}
          </Card>

          {/* Top Campaigns */}
          <Card variant="outlined" noPadding>
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--cc-border)" }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>Top Campaigns</h2>
              <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "4px 0 0" }}>By budget, most recent</p>
            </div>
            {data.topCampaigns.length === 0 ? (
              <div style={{ padding: 32 }}>
                <EmptyState icon={<BarChart2 size={32} color="var(--cc-text-subtle)" />} title="No campaigns" description="Campaigns will appear here once created." />
              </div>
            ) : (
              <div className="rsp-table-wrap">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--cc-border)" }}>
                    {["Campaign", "Status", "Budget", "Spend", "Utilization"].map(col => (
                      <th key={col} style={{ padding: "11px 20px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.topCampaigns.map((c, idx) => (
                    <tr key={c.id} style={{ borderBottom: idx < data.topCampaigns.length - 1 ? "1px solid var(--cc-border)" : "none" }}>
                      <td style={{ padding: "14px 20px" }}>
                        <a href={`/campaigns/${c.id}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-primary)", textDecoration: "none" }}>{c.title}</a>
                      </td>
                      <td style={{ padding: "14px 20px" }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: "3px 8px",
                          borderRadius: STATUS_PILL_RADIUS,
                          ...campaignStatusCss(c.status),
                        }}>
                          {c.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td style={{ padding: "14px 20px", fontSize: 13, color: "var(--cc-text)" }}>{fmt(c.budget, c.currency)}</td>
                      <td style={{ padding: "14px 20px", fontSize: 13, color: "var(--cc-text)" }}>{fmt(c.spend, c.currency)}</td>
                      <td style={{ padding: "14px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--cc-bg)", overflow: "hidden", minWidth: 60 }}>
                            <div style={{
                              height: "100%", borderRadius: 3,
                              background: c.utilization >= 90 ? "#DC2626" : c.utilization >= 70 ? "#D97706" : "#059669",
                              width: `${Math.min(c.utilization, 100)}%`,
                            }} />
                          </div>
                          <span style={{ fontSize: 12, color: "var(--cc-text-muted)", minWidth: 32, textAlign: "right" }}>{c.utilization}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
