import type { SkeletonColumn } from "@/components/ui/PageSkeleton";

/** Column widths shared by the requests table and its loading skeleton.
 *  Creator and campaign share what is left. */
export const REQUEST_WIDTHS = {
  creator: undefined,
  campaign: undefined,
  amount: 140,
  status: 120,
  requested: 128,
  actions: 200,
} as const;

export const REQUEST_COLUMNS_SKELETON: SkeletonColumn[] = [
  {},
  {},
  { width: REQUEST_WIDTHS.amount, align: "right" },
  { width: REQUEST_WIDTHS.status },
  { width: REQUEST_WIDTHS.requested },
  { width: REQUEST_WIDTHS.actions, align: "right" },
];

/** Rows per page: the default, and the sizes the footer offers. */
export const REQUEST_PAGE_SIZE = 25;
export const REQUEST_PAGE_SIZES = [10, 25, 50];
