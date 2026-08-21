export const ANALYTICS_FEATURE = "analytics" as const;
export const BULK_EXPORT_FEATURE = "bulk_export" as const;
export const API_ACCESS_FEATURE = "api_access" as const;
export const CUSTOM_BRANDING_FEATURE = "custom_branding" as const;
export const ADVANCED_REPORTS_FEATURE = "advanced_reports" as const;
export const DISCOVERY_FEATURE = "creator_discovery" as const;
export const CAMPAIGN_BUDGET_FEATURE = "campaign_budget" as const;
export const MULTI_CURRENCY_FEATURE = "multi_currency" as const;
export const AUDIT_LOG_FEATURE = "audit_log" as const;
export const MEDIA_KITS_FEATURE = "media_kits" as const;
export const AI_ASSISTANT_FEATURE = "ai_assistant" as const;
export const SONGS_FEATURE = "songs" as const;

export const REPORTS_FEATURE_KEYS = [
  "reports",
  "basic_reports",
  ADVANCED_REPORTS_FEATURE,
] as const;

export type ReportsFeatureKey = (typeof REPORTS_FEATURE_KEYS)[number];
