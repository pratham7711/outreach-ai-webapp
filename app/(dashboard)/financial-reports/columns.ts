import type { SkeletonColumn } from "@/components/ui/PageSkeleton";

/** Top campaigns: widths shared by the table and its loading skeleton. The
 *  campaign name takes what is left. */
export const FIN_TOP_WIDTHS = {
  campaign: undefined,
  status: 128,
  budget: 140,
  spend: 140,
  utilization: 200,
} as const;

export const FIN_TOP_COLUMNS_SKELETON: SkeletonColumn[] = [
  {},
  { width: FIN_TOP_WIDTHS.status },
  { width: FIN_TOP_WIDTHS.budget, align: "right" },
  { width: FIN_TOP_WIDTHS.spend, align: "right" },
  { width: FIN_TOP_WIDTHS.utilization },
];
