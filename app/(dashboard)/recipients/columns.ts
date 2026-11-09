import type { SkeletonColumn } from "@/components/ui/PageSkeleton";

/** Column widths shared by the recipients table and its loading skeleton.
 *  The recipient takes what is left. */
export const RECIPIENT_WIDTHS = {
  recipient: undefined,
  methods: 180,
  paid: 140,
  pending: 140,
  last: 128,
  count: 104,
} as const;

export const RECIPIENT_COLUMNS_SKELETON: SkeletonColumn[] = [
  {},
  { width: RECIPIENT_WIDTHS.methods },
  { width: RECIPIENT_WIDTHS.paid, align: "right" },
  { width: RECIPIENT_WIDTHS.pending, align: "right" },
  { width: RECIPIENT_WIDTHS.last },
  { width: RECIPIENT_WIDTHS.count, align: "right" },
];

/** Rows per page: the default, and the sizes the footer offers. */
export const RECIPIENT_PAGE_SIZE = 25;
export const RECIPIENT_PAGE_SIZES = [10, 25, 50];
