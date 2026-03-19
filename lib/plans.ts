export const PLANS = {
  free: {
    max_campaigns: 3,
    max_creators: 50,
    max_users: 2,
    features: ["campaigns", "creator_database", "basic_reports"] as const,
  },
  starter: {
    max_campaigns: 20,
    max_creators: 500,
    max_users: 5,
    features: ["campaigns", "creator_database", "basic_reports", "media_kits", "shareable_links", "draft_approvals"] as const,
  },
  pro: {
    max_campaigns: Infinity,
    max_creators: Infinity,
    max_users: 25,
    features: ["campaigns", "creator_database", "basic_reports", "advanced_reports", "media_kits", "shareable_links", "draft_approvals", "creator_portal", "audio_analytics", "payments", "export_csv", "api_access"] as const,
  },
  enterprise: {
    max_campaigns: Infinity,
    max_creators: Infinity,
    max_users: Infinity,
    features: ["campaigns", "creator_database", "basic_reports", "advanced_reports", "media_kits", "shareable_links", "draft_approvals", "creator_portal", "audio_analytics", "payments", "export_csv", "api_access", "custom_domain", "sso", "audit_log", "dedicated_support", "ai_creator_discovery"] as const,
  },
} as const;

export type PlanName = keyof typeof PLANS;

export function hasFeature(plan: string, feature: string): boolean {
  const planConfig = PLANS[plan as PlanName];
  if (!planConfig) return false;
  return (planConfig.features as readonly string[]).includes(feature);
}

export function getPlanLimits(plan: string) {
  return PLANS[plan as PlanName] ?? PLANS.free;
}
