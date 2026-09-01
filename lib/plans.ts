/**
 * Tracker limits are deliberately tighter than creator or campaign limits.
 *
 * A creator or a campaign is a stored row: it costs a few bytes once. A tracker
 * is a standing instruction to load a real browser page on a schedule, forever
 * — at the measured ~10s a read and up to 24 reads a day, each one is recurring
 * compute rather than storage. 200 trackers on the hourly setting is 4,800 page
 * loads a day, which is the shape of thing that gets an IP noticed.
 */
export const PLANS = {
  free: {
    max_campaigns: 3,
    max_creators: 50,
    max_users: 2,
    max_trackers: 3,
    features: ["campaigns", "creator_database", "basic_reports"] as const,
  },
  starter: {
    max_campaigns: 20,
    max_creators: 500,
    max_users: 5,
    max_trackers: 25,
    features: ["campaigns", "creator_database", "basic_reports", "media_kits", "shareable_links", "draft_approvals"] as const,
  },
  pro: {
    max_campaigns: Infinity,
    max_creators: Infinity,
    max_users: 25,
    max_trackers: 200,
    features: ["campaigns", "creator_database", "basic_reports", "advanced_reports", "media_kits", "shareable_links", "draft_approvals", "creator_portal", "audio_analytics", "payments", "export_csv", "api_access"] as const,
  },
  enterprise: {
    max_campaigns: Infinity,
    max_creators: Infinity,
    max_users: Infinity,
    max_trackers: Infinity,
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
