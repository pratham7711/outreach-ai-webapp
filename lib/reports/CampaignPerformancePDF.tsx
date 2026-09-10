import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { SharedReportData } from "@/lib/reports/campaignPerformance";
import { DEFAULT_SHARE_VISIBILITY, type ShareVisibility } from "@/lib/reports/shareVisibility";
import { formatFull } from "@/lib/format";
import { ACTIVATION_STATUS_LABEL } from "@/lib/activationQueues";
import { POWERED_BY } from "@/lib/brand";

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
  /* Same frame as `table`, without `overflow: hidden`. The posts table is the
     one that runs past a page break, and clipping it would take the overflow
     with it. */
  postsTable: {
    border: "1px solid #E4E6F0",
    borderRadius: 6,
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
  return formatFull(num);
}

function fmtCurrency(n: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

/** A measured counter, or an em dash — never a zero we did not measure. */
function fmtMaybe(n: number | null): string {
  return n === null ? "—" : formatFull(n);
}

function fmtPostedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * How many post rows the PDF prints before it stops and says how many are left.
 *
 * A campaign here runs to hundreds of posts, and a react-pdf document lays every
 * row out in memory. The cap keeps the render bounded; the "+N more" line keeps
 * it honest, because a table that silently ends at 200 reads as a complete list.
 */
const MAX_POST_ROWS = 200;

export function CampaignPerformancePDF({
  campaignTitle,
  data,
  visibility = DEFAULT_SHARE_VISIBILITY,
  budget = null,
}: {
  campaignTitle: string;
  data: SharedReportData;
  /** Same gating as the web report — a PDF that ignored it would be the leak. */
  visibility?: ShareVisibility;
  budget?: number | null;
}) {
  // Redacted server-side before it gets here, same as the web report.
  const { kpis, platformSplit, leaderboard, posts, currency } = data;
  /* redactForShare has already nulled the creator on every row of a
     hide-creators link, exactly as it nulls the leaderboard — so the column is
     dropped rather than printing a page of em dashes, and the handle a post URL
     would have carried never reaches the document either. */
  const showPostCreators = visibility.showCreators && posts.some((p) => p.creator !== null);
  const postRows = posts.slice(0, MAX_POST_ROWS);
  const hiddenPosts = posts.length - postRows.length;
  // Matches the web report: dropped entirely when nobody on it has a status.
  const showStatusColumn = leaderboard.some((r) => r.status !== null);

  // Engagement is unknown for posts we never fetched, so those cells are left
  // out of the report rather than printed as a zero or a dash.
  const kpiCells = [
    { label: "Views", value: fmtNumber(kpis.views) },
    kpis.engagements !== null
      ? { label: "Engagements", value: fmtNumber(kpis.engagements) }
      : null,
    kpis.engagementRate !== null
      ? { label: "Eng. Rate", value: `${(kpis.engagementRate * 100).toFixed(2)}%` }
      : null,
    // The web report leads with this tile; the PDF simply did not have it.
    { label: "Total Posts", value: fmtNumber(kpis.posts) },
    budget !== null ? { label: "Total Budget", value: fmtCurrency(budget, currency) } : null,
  ].filter((cell): cell is { label: string; value: string } => cell !== null);

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

          {visibility.showCreators && (
          <>
          <Text style={styles.sectionTitle}>Top Creators</Text>
          {leaderboard.length > 0 ? (
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Creator</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Posts</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Views</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Eng.</Text>
                {showStatusColumn && <Text style={[styles.tableHeaderCell, { flex: 1.4 }]}>Status</Text>}
              </View>
              {leaderboard.map((row) => (
                <View key={row.creatorId} style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 2 }]}>{row.name}</Text>
                  <Text style={[styles.tableCell, { flex: 1 }]}>{row.posts}</Text>
                  <Text style={[styles.tableCell, { flex: 1 }]}>{fmtNumber(row.views)}</Text>
                  <Text style={[styles.tableCell, { flex: 1 }]}>
                    {row.engagementRate !== null ? (row.engagementRate * 100).toFixed(1) + "%" : "—"}
                  </Text>
                  {showStatusColumn && (
                    <Text style={[styles.tableCell, { flex: 1.4 }]}>
                      {row.status ? ACTIVATION_STATUS_LABEL[row.status] ?? row.status : ""}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>No creators yet.</Text>
          )}
          </>
          )}

          {/* The post list, which is what a client report fundamentally is.
              The PDF carried a ten-row creator leaderboard and nothing else,
              while the web report at the same URL listed every post. Same rows,
              same redaction — `posts` arrives from redactForShare. */}
          <Text style={styles.sectionTitle}>Posts</Text>
          {postRows.length > 0 ? (
            <View style={styles.postsTable}>
              <View style={styles.tableHeader} fixed>
                {showPostCreators && (
                  <Text style={[styles.tableHeaderCell, { flex: 1.6 }]}>Creator</Text>
                )}
                <Text style={[styles.tableHeaderCell, { flex: 1.1 }]}>Platform</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1.2 }]}>Posted</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Views</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Likes</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Comments</Text>
              </View>
              {postRows.map((row) => (
                <View key={row.id} style={styles.tableRow} wrap={false}>
                  {showPostCreators && (
                    <Text style={[styles.tableCell, { flex: 1.6 }]}>
                      {row.creator?.handle ? `@${row.creator.handle}` : row.creator?.name ?? "—"}
                    </Text>
                  )}
                  <Text style={[styles.tableCell, { flex: 1.1 }]}>{row.platform}</Text>
                  <Text style={[styles.tableCell, { flex: 1.2 }]}>{fmtPostedAt(row.postedAt)}</Text>
                  <Text style={[styles.tableCell, { flex: 1 }]}>{fmtNumber(row.views)}</Text>
                  <Text style={[styles.tableCell, { flex: 1 }]}>{fmtMaybe(row.likes)}</Text>
                  <Text style={[styles.tableCell, { flex: 1 }]}>{fmtMaybe(row.comments)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>No posts yet.</Text>
          )}
          {hiddenPosts > 0 && (
            <Text style={[styles.emptyText, { marginTop: 8 }]}>
              {`+${hiddenPosts} more post${hiddenPosts === 1 ? "" : "s"} not shown. Use Export Posts on the online report for the full list.`}
            </Text>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>{POWERED_BY}</Text>
        </View>
      </Page>
    </Document>
  );
}
