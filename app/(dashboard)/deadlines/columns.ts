import type { SkeletonColumn } from "@/components/ui/PageSkeleton";

/** Column widths shared by the deadlines table and its loading skeleton.
 *  Creator and Campaign share what is left. */
export const DEADLINES_WIDTHS = {
  creator: undefined,
  campaign: undefined,
  status: 168,
  due: 236,
  daysLeft: 128,
} as const;

export const DEADLINES_COLUMNS_SKELETON: SkeletonColumn[] = [
  {},
  {},
  { width: DEADLINES_WIDTHS.status },
  { width: DEADLINES_WIDTHS.due },
  { width: DEADLINES_WIDTHS.daysLeft, align: "right" },
];
