import type { SkeletonColumn } from "@/components/ui/PageSkeleton";

/** Column widths shared by the reports table and its loading skeleton. The
 *  title takes what is left. */
export const REPORT_WIDTHS = {
  title: undefined,
  campaign: 240,
  created: 140,
  visibility: 120,
  actions: 64,
} as const;

export const REPORT_COLUMNS_SKELETON: SkeletonColumn[] = [
  {},
  { width: REPORT_WIDTHS.campaign },
  { width: REPORT_WIDTHS.created },
  { width: REPORT_WIDTHS.visibility },
  { width: REPORT_WIDTHS.actions },
];
