import { PageHeaderSkeleton, StatGridSkeleton, ChartSkeleton, CardGridSkeleton } from "@/components/ui/PageSkeleton";

/**
 * The report reads the campaign, its posts and every metric snapshot before it
 * can render anything, which is 340ms warm and about 1.9s cold. Without a
 * fallback the client who followed the link watched a blank tab for that long;
 * with one, Next streams the shell straight away.
 *
 * Same 960px column as the report itself, so the skeleton sits where the content
 * lands rather than jumping when it arrives.
 */
export default function ShareReportLoading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--cc-bg)" }}>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "40px 24px 80px" }}>
        <PageHeaderSkeleton hasAction={false} />
        <StatGridSkeleton count={4} />
        <div style={{ marginTop: 24 }}>
          <ChartSkeleton />
        </div>
        <div style={{ marginTop: 24 }}>
          <CardGridSkeleton count={6} />
        </div>
      </div>
    </div>
  );
}
