export const AUDIT_LOG_FEATURE = "audit_log" as const;
export const MEDIA_KITS_FEATURE = "media_kits" as const;

export const REPORTS_FEATURE_KEYS = [
  "reports",
  "basic_reports",
  "advanced_reports",
] as const;

export type ReportsFeatureKey = (typeof REPORTS_FEATURE_KEYS)[number];
