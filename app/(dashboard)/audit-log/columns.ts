import type { SkeletonColumn } from "@/components/ui/PageSkeleton";

/** Column widths shared by the audit log table and its loading skeleton, so
 *  the placeholder and the loaded table line up. Entity takes what is left. */
export const AUDIT_LOG_WIDTHS = {
  time: 184,
  action: 200,
  entity: undefined,
  actor: 200,
  ip: 140,
} as const;

export const AUDIT_LOG_COLUMNS_SKELETON: SkeletonColumn[] = [
  { width: AUDIT_LOG_WIDTHS.time },
  { width: AUDIT_LOG_WIDTHS.action },
  {},
  { width: AUDIT_LOG_WIDTHS.actor },
  { width: AUDIT_LOG_WIDTHS.ip },
];

/** Rows per page: the default, and the sizes the footer offers. */
export const AUDIT_LOG_PAGE_SIZE = 25;
export const AUDIT_LOG_PAGE_SIZES = [10, 25, 50];
