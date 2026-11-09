import type { SkeletonColumn } from "@/components/ui/PageSkeleton";

/** Column widths shared by the clients table and its loading skeleton, so the
 *  placeholder and the loaded table line up. Client takes what is left. */
export const CLIENTS_WIDTHS = {
  client: undefined,
  contact: 280,
  campaigns: 140,
} as const;

export const CLIENTS_COLUMNS_SKELETON: SkeletonColumn[] = [
  {},
  { width: CLIENTS_WIDTHS.contact },
  { width: CLIENTS_WIDTHS.campaigns, align: "right" },
];
