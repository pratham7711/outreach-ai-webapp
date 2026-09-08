/**
 * Trackers are the only thing a plan limits.
 *
 * That is the whole rule, and it follows from what each thing costs. A creator
 * or a campaign is a stored row: a few bytes, paid once, and capping them only
 * ever stops someone using the product they signed up for. A tracker is a
 * standing instruction to fetch a page on a schedule, forever — up to 24 reads
 * a day each, so 200 trackers on the hourly setting is 4,800 fetches a day,
 * which is recurring compute and the shape of thing that gets an IP noticed.
 *
 * So max_campaigns and max_creators are Infinity on every tier, deliberately
 * and not as a placeholder. They were 3/50 and 20/500 on the lower tiers, and
 * neither was ever enforced — the number was displayed on the billing screen
 * and nothing refused the next campaign. A limit that is shown and not enforced
 * is worse than no limit: the first person to notice learns the app does not
 * mean what it says. Unlimited is now the honest answer in both places.
 *
 * max_users went the same way on 2026-09-01. It was the one limit with a real
 * enforcement point -- the invite endpoint refused a seat over the cap -- but
 * the decision is that trackers are the only thing a plan limits. Trackers cost
 * money to keep reading (every tracked sound is a recurring platform fetch);
 * seats, campaigns and creators are rows.
 *
 * So max_trackers is the ONLY finite number in this file. If you are adding a
 * limit here, the question to answer first is what it costs us per unit.
 *
 * free is 0 on purpose, not as a placeholder: a self-serve signup gets the whole
 * product except the one feature with a recurring cost per row. Note that 0 is a
 * real limit and must survive every falsy check between here and the gate --
 * `?? Infinity` is correct, `|| Infinity` would turn "none" into "unlimited".
 *
 * A feature name here is not decoration: getOrgEntitlements builds an org's
 * featureMap from this list, so a key a route gates on and no tier grants is a
 * 403 for every org on every plan. That is what happened to `creator_discovery`
 * and `ai_assistant` -- both gated (app/api/discovery, app/api/ai/*,
 * campaigns/[id]/outreach/draft) and listed in no tier, so only the seed script,
 * which writes them straight into OrgPlanConfig.features, ever saw them work.
 *
 * `creator_discovery` is on every tier including free. It searches the org's own
 * Creator rows and nothing else -- no external call, no recurring cost -- and
 * the sidebar shows /discovery to every org (the rule in lib/dashboardPolicy.ts
 * is keyed, not feature-gated), so withholding it only produces a 403 behind a
 * link everyone can see. `ai_assistant` starts at pro, because that one bills
 * per request.
 *
 * `ai_creator_discovery` was removed at the same time: an enterprise-only name
 * one character away from the key the discovery route actually reads, which is
 * how the real key came to be missing in the first place.
 */
export const PLANS = {
  free: {
    max_campaigns: Infinity,
    max_creators: Infinity,
    max_users: Infinity,
    max_trackers: 0,
    features: ["campaigns", "creator_database", "basic_reports", "creator_discovery"] as const,
  },
  starter: {
    max_campaigns: Infinity,
    max_creators: Infinity,
    max_users: Infinity,
    max_trackers: 25,
    features: ["campaigns", "creator_database", "basic_reports", "creator_discovery", "media_kits", "shareable_links", "draft_approvals"] as const,
  },
  pro: {
    max_campaigns: Infinity,
    max_creators: Infinity,
    max_users: Infinity,
    max_trackers: 100,
    features: ["campaigns", "creator_database", "basic_reports", "advanced_reports", "creator_discovery", "media_kits", "shareable_links", "draft_approvals", "creator_portal", "audio_analytics", "payments", "export_csv", "api_access", "ai_assistant"] as const,
  },
  enterprise: {
    max_campaigns: Infinity,
    max_creators: Infinity,
    max_users: Infinity,
    max_trackers: Infinity,
    features: ["campaigns", "creator_database", "basic_reports", "advanced_reports", "creator_discovery", "media_kits", "shareable_links", "draft_approvals", "creator_portal", "audio_analytics", "payments", "export_csv", "api_access", "ai_assistant", "custom_domain", "sso", "audit_log", "dedicated_support"] as const,
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
