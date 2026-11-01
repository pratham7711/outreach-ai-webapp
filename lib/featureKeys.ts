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

/* LKM-only for now: switched on per org in OrgPlanConfig.features, never by a
   plan, so no sign-up gets them. The org's id never appears in code. */
export const CREATOR_FINDER_FEATURE = "creator_finder" as const;
export const SONG_SCOUT_FEATURE = "song_scout" as const;
/* Scout's own AI switch, separate from creator_finder so the board works with
   the AI off. It also needs SCOUT_ANTHROPIC_API_KEY on the server. */
export const CREATOR_FINDER_AI_FEATURE = "creator_finder_ai" as const;

/* Granted to one org at a time through /api/admin/org-features, and never sold
   by a plan tier: __tests__/unit/lib/featureGateCoverage.test.ts fails if one of
   these appears in lib/plans.ts, so a new sign-up can never get them. */
export const ORG_GRANT_ONLY_FEATURES = [CREATOR_FINDER_FEATURE, CREATOR_FINDER_AI_FEATURE, SONG_SCOUT_FEATURE] as const;
