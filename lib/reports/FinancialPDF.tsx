import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export type ReportData = {
  period: string;
  previousPeriod: string;
  current: {
    paidPayouts: number;
    pendingPayouts: number;
    totalPayouts: number;
    totalBudget: number;
    campaignCount: number;
    activeCampaigns: number;
    approvedRequests: number;
    pendingRequests: number;
  };
  previous: {
    paidPayouts: number;
    pendingPayouts: number;
    totalPayouts: number;
    totalBudget: number;
    campaignCount: number;
    activeCampaigns: number;
    approvedRequests: number;
    pendingRequests: number;
  };
  comparison: {
    payoutsChange: number | null;
    budgetChange: number | null;
    campaignCountChange: number | null;
    requestsChange: number | null;
  };
  monthlyTrend: { month: string; paid: number; pending: number }[];
  topCampaigns: {
    id: string;
    title: string;
    status: string;
    budget: number;
    currency: string;
    spend: number;
    utilization: number;
  }[];
  balances: { label: string; currentBalance: number; currency: string }[];
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1C2048",
    backgroundColor: "#FFFFFF",
    padding: 0,
  },
  header: {
    backgroundColor: "#1C2048",
    padding: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
  },
  headerPeriod: {
    color: "#9097B4",
    fontSize: 11,
    marginTop: 4,
  },
  headerBadge: {
    backgroundColor: "#5B5BD6",
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  headerBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
  },
  body: {
    padding: 28,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#1C2048",
    marginBottom: 10,
    marginTop: 20,
  },
  kpiRow: {
    flexDirection: "row",
  },
  kpiBox: {
    flex: 1,
    border: "1px solid #E4E6F0",
    borderRadius: 8,
    padding: 14,
    marginRight: 8,
  },
  kpiBoxLast: {
    flex: 1,
    border: "1px solid #E4E6F0",
    borderRadius: 8,
    padding: 14,
  },
  kpiLabel: {
    fontSize: 9,
    color: "#9097B4",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  kpiValue: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#1C2048",
    marginBottom: 4,
  },
  kpiChange: {
    fontSize: 9,
    color: "#9097B4",
  },
  kpiChangePositive: {
    fontSize: 9,
    color: "#059669",
  },
  kpiChangeNegative: {
    fontSize: 9,
    color: "#DC2626",
  },
  accentBar: {
    height: 3,
    backgroundColor: "#5B5BD6",
    borderRadius: 2,
    marginBottom: 8,
    width: 24,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F8F9FC",
    borderBottom: "1px solid #E4E6F0",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "1px solid #E4E6F0",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  tableRowLast: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  tableHeaderCell: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#9097B4",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  tableCell: {
    fontSize: 10,
    color: "#1C2048",
  },
  table: {
    border: "1px solid #E4E6F0",
    borderRadius: 6,
    overflow: "hidden",
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 28,
    right: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTop: "1px solid #E4E6F0",
    paddingTop: 10,
  },
  footerText: {
    fontSize: 9,
    color: "#9097B4",
  },
  footerAccent: {
    fontSize: 9,
    color: "#5B5BD6",
  },
});

function fmtCurrency(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtChange(value: number | null): string {
  if (value === null) return "vs prior: —";
  if (value === 0) return "vs prior: No change";
  return `vs prior: ${value > 0 ? "+" : ""}${value}%`;
}

function getChangeStyle(value: number | null) {
  if (value === null || value === 0) return styles.kpiChange;
  return value > 0 ? styles.kpiChangePositive : styles.kpiChangeNegative;
}

export function FinancialPDF({ data }: { data: ReportData }) {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Financial Report</Text>
            <Text style={styles.headerPeriod}>{data.period} vs {data.previousPeriod}</Text>
          </View>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{data.period}</Text>
          </View>
        </View>

        <View style={styles.body}>
          {/* KPI Row */}
          <Text style={styles.sectionTitle}>Key Metrics</Text>
          <View style={styles.kpiRow}>
            <View style={styles.kpiBox}>
              <View style={styles.accentBar} />
              <Text style={styles.kpiLabel}>Paid Payouts</Text>
              <Text style={styles.kpiValue}>{fmtCurrency(data.current.paidPayouts)}</Text>
              <Text style={getChangeStyle(data.comparison.payoutsChange)}>
                {fmtChange(data.comparison.payoutsChange)}
              </Text>
            </View>
            <View style={styles.kpiBox}>
              <View style={styles.accentBar} />
              <Text style={styles.kpiLabel}>Pending Payouts</Text>
              <Text style={styles.kpiValue}>{fmtCurrency(data.current.pendingPayouts)}</Text>
              <Text style={styles.kpiChange}>current period</Text>
            </View>
            <View style={styles.kpiBox}>
              <View style={styles.accentBar} />
              <Text style={styles.kpiLabel}>Total Budget</Text>
              <Text style={styles.kpiValue}>{fmtCurrency(data.current.totalBudget)}</Text>
              <Text style={getChangeStyle(data.comparison.budgetChange)}>
                {fmtChange(data.comparison.budgetChange)}
              </Text>
            </View>
            <View style={styles.kpiBoxLast}>
              <View style={styles.accentBar} />
              <Text style={styles.kpiLabel}>Campaigns</Text>
              <Text style={styles.kpiValue}>{String(data.current.campaignCount)}</Text>
              <Text style={getChangeStyle(data.comparison.campaignCountChange)}>
                {fmtChange(data.comparison.campaignCountChange)}
              </Text>
            </View>
          </View>

          {/* Monthly Trend */}
          <Text style={styles.sectionTitle}>Monthly Trend</Text>
          {data.monthlyTrend.length === 0 ? (
            <Text style={styles.kpiChange}>No monthly trend data available.</Text>
          ) : (
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Month</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Paid</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Pending</Text>
              </View>
              {data.monthlyTrend.map((row, idx) => {
                const isLast = idx === data.monthlyTrend.length - 1;
                return (
                  <View key={row.month} style={isLast ? styles.tableRowLast : styles.tableRow}>
                    <Text style={[styles.tableCell, { flex: 2 }]}>{row.month}</Text>
                    <Text style={[styles.tableCell, { flex: 1 }]}>{fmtCurrency(row.paid)}</Text>
                    <Text style={[styles.tableCell, { flex: 1 }]}>{fmtCurrency(row.pending)}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Top Campaigns */}
          <Text style={styles.sectionTitle}>Top Campaigns</Text>
          {data.topCampaigns.length === 0 ? (
            <Text style={styles.kpiChange}>No campaign data available.</Text>
          ) : (
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Campaign</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Status</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Budget</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Spend</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Util %</Text>
              </View>
              {data.topCampaigns.map((c, idx) => {
                const isLast = idx === data.topCampaigns.length - 1;
                return (
                  <View key={c.id} style={isLast ? styles.tableRowLast : styles.tableRow}>
                    <Text style={[styles.tableCell, { flex: 3 }]}>{c.title}</Text>
                    <Text style={[styles.tableCell, { flex: 1, fontSize: 9 }]}>{c.status.replace(/_/g, " ")}</Text>
                    <Text style={[styles.tableCell, { flex: 1 }]}>{fmtCurrency(c.budget)}</Text>
                    <Text style={[styles.tableCell, { flex: 1 }]}>{fmtCurrency(c.spend)}</Text>
                    <Text style={[styles.tableCell, { flex: 1 }]}>{c.utilization}%</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Generated by <Text style={styles.footerAccent}>Outreach AI</Text> • {today}</Text>
          <Text style={styles.footerText}>{data.period}</Text>
        </View>
      </Page>
    </Document>
  );
}
