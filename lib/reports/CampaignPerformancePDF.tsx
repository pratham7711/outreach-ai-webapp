import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { CampaignPerformance } from "@/lib/reports/campaignPerformance";
import { formatCompact } from "@/lib/format";

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
  },
  headerLabel: {
    color: "#9097B4",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 20,
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
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  kpiBox: {
    width: "31%",
    border: "1px solid #E4E6F0",
    borderRadius: 8,
    padding: 12,
    marginRight: "2.33%",
    marginBottom: 10,
  },
  kpiLabel: {
    fontSize: 9,
    color: "#9097B4",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  kpiValue: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    color: "#1C2048",
  },
  table: {
    border: "1px solid #E4E6F0",
    borderRadius: 6,
    overflow: "hidden",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F8F9FC",
    borderBottom: "1px solid #E4E6F0",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "1px solid #E4E6F0",
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
  footer: {
    position: "absolute",
    bottom: 20,
    left: 28,
    right: 28,
    borderTop: "1px solid #E4E6F0",
    paddingTop: 10,
  },
  footerText: {
    fontSize: 9,
    color: "#9097B4",
  },
  emptyText: {
    fontSize: 11,
    color: "#9097B4",
  },
});

function fmtNumber(num: number): string {
  return formatCompact(num);
}

function fmtCurrency(n: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

export function CampaignPerformancePDF({
  campaignTitle,
  data,
}: {
  campaignTitle: string;
  data: CampaignPerformance;
}) {
  const { kpis, platformSplit, leaderboard, currency } = data;
  const engRate = kpis.engagementRate !== null ? (kpis.engagementRate * 100).toFixed(2) + "%" : "—";

  const kpiCells = [
    { label: "Views", value: fmtNumber(kpis.views) },
    { label: "Engagements", value: fmtNumber(kpis.engagements) },
    { label: "Eng. Rate", value: engRate },
    { label: "Spend", value: fmtCurrency(kpis.spend, currency) },
    { label: "CPM / CPE", value: `${kpis.cpm !== null ? fmtCurrency(kpis.cpm, currency) : "—"} / ${kpis.cpe !== null ? fmtCurrency(kpis.cpe, currency) : "—"}` },
    { label: "EMV", value: fmtCurrency(kpis.emv, currency) },
  ];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.headerLabel}>Campaign Performance Report</Text>
          <Text style={styles.headerTitle}>{campaignTitle}</Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.sectionTitle}>Key Metrics</Text>
          <View style={styles.kpiGrid}>
            {kpiCells.map((c) => (
              <View key={c.label} style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>{c.label}</Text>
                <Text style={styles.kpiValue}>{c.value}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Platform Split</Text>
          {platformSplit.length > 0 ? (
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Platform</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Posts</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Views</Text>
              </View>
              {platformSplit.map((row) => (
                <View key={row.platform} style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 2 }]}>{row.platform}</Text>
                  <Text style={[styles.tableCell, { flex: 1 }]}>{row.posts}</Text>
                  <Text style={[styles.tableCell, { flex: 1 }]}>{fmtNumber(row.views)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>No platform data.</Text>
          )}

          <Text style={styles.sectionTitle}>Top Creators</Text>
          {leaderboard.length > 0 ? (
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Creator</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Posts</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Views</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Eng.</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>EMV</Text>
              </View>
              {leaderboard.map((row) => (
                <View key={row.creatorId} style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 2 }]}>{row.name}</Text>
                  <Text style={[styles.tableCell, { flex: 1 }]}>{row.posts}</Text>
                  <Text style={[styles.tableCell, { flex: 1 }]}>{fmtNumber(row.views)}</Text>
                  <Text style={[styles.tableCell, { flex: 1 }]}>
                    {row.engagementRate !== null ? (row.engagementRate * 100).toFixed(1) + "%" : "—"}
                  </Text>
                  <Text style={[styles.tableCell, { flex: 1 }]}>{fmtCurrency(row.emv, currency)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>No creators yet.</Text>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Powered by Outreach AI</Text>
        </View>
      </Page>
    </Document>
  );
}
