import type { SkeletonColumn } from "@/components/ui/PageSkeleton";

/** Column widths shared by the payouts table and its loading skeleton, so the
 *  placeholder and the loaded table line up. Creator and campaign share what is
 *  left. */
export const PAYOUT_WIDTHS = {
  creator: undefined,
  campaign: undefined,
  amount: 140,
  status: 128,
  date: 128,
  actions: 176,
} as const;

export const PAYOUT_COLUMNS_SKELETON: SkeletonColumn[] = [
  {},
  {},
  { width: PAYOUT_WIDTHS.amount, align: "right" },
  { width: PAYOUT_WIDTHS.status },
  { width: PAYOUT_WIDTHS.date },
  { width: PAYOUT_WIDTHS.actions, align: "right" },
];
