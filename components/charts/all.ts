/**
 * Every Recharts-backed component the dashboard renders, in one module.
 *
 * This barrel exists to be the far side of a single import() -- see lazyCharts,
 * which explains why. Nothing imports this file directly, and only components
 * actually rendered somewhere belong in it: an entry here is what pulls a module
 * into the shared chunk.
 *
 * The public share report is deliberately absent. It has its own Recharts copy
 * because a visitor who follows a share link never loads a dashboard page, so it
 * would carry the dashboard's chart code for nothing.
 */
export { ViewsOverTimeArea, PlatformBreakdownPie, ViewsByCampaignBar } from "@/app/(dashboard)/dashboard/DashboardCharts";

export {
  MonthlyTrendArea,
  PlatformBreakdownBar,
  CampaignComparisonLine,
} from "@/app/(dashboard)/analytics/AnalyticsCharts";

export { PlatformViewsPie, CreatorPerformanceBar } from "@/app/(dashboard)/campaigns/[id]/CampaignTabCharts";

export { PerformanceOverTimeArea, TrackingLine } from "@/app/(dashboard)/campaigns/[id]/posts/[postId]/PostCharts";

export { default as PerformanceTab } from "@/app/(dashboard)/campaigns/[id]/PerformanceTab";
export { default as MarketplaceAnalytics } from "@/app/(dashboard)/campaigns/[id]/MarketplaceAnalytics";
export { default as PayoutTrendChart } from "@/app/(dashboard)/financial-reports/PayoutTrendChart";
