import { BRAND } from "@/lib/brand";
import {
  ADVANCED_REPORTS_FEATURE,
  AI_ASSISTANT_FEATURE,
  ANALYTICS_FEATURE,
  API_ACCESS_FEATURE,
  AUDIT_LOG_FEATURE,
  BULK_EXPORT_FEATURE,
  CAMPAIGN_BUDGET_FEATURE,
  CUSTOM_BRANDING_FEATURE,
  DISCOVERY_FEATURE,
  MEDIA_KITS_FEATURE,
  MULTI_CURRENCY_FEATURE,
  REPORTS_FEATURE_KEYS,
  SONGS_FEATURE,
} from "@/lib/featureKeys";

export const FEATURES = {
  [ANALYTICS_FEATURE]:        { label: "Analytics Dashboard",     description: "View campaign analytics and reports" },
  [BULK_EXPORT_FEATURE]:      { label: "Bulk Export",             description: "Export data in bulk (CSV/XLSX)" },
  [API_ACCESS_FEATURE]:       { label: "API Access",              description: `Access ${BRAND.name} REST API and the MCP tool surface` },
  [CUSTOM_BRANDING_FEATURE]:  { label: "Custom Branding",         description: "White-label with own logo & colors" },
  [ADVANCED_REPORTS_FEATURE]: { label: "Advanced Reports",        description: "Advanced reporting & custom dashboards" },
  [DISCOVERY_FEATURE]:        { label: "Creator Discovery",       description: "Search & discover new creators" },
  [CAMPAIGN_BUDGET_FEATURE]:  { label: "Campaign Budget Tools",   description: "Budget tracking & forecasting" },
  [MULTI_CURRENCY_FEATURE]:   { label: "Multi-Currency Payouts",  description: "Pay creators in multiple currencies" },
  [AUDIT_LOG_FEATURE]:        { label: "Audit Log",               description: "Full audit trail of all actions" },
  [MEDIA_KITS_FEATURE]:       { label: "Media Kits",              description: "Generate creator media kits" },
  [SONGS_FEATURE]:            { label: "Songs",                 description: "Group campaigns under a release and roll up its performance" },
  [AI_ASSISTANT_FEATURE]:     { label: "AI Assistant",            description: "AI briefings and natural-language analytics (billed per request)" },
} as const;

export type FeatureKey = keyof typeof FEATURES;

/**
 * A feature key only counts as live if something in the app reads it.
 *
 * FEATURES above is that register — every key in it has a gate behind it
 * (media_kits, creator_discovery, api_access, ai_assistant and audit_log are
 * checked by their own routes; the reports keys gate the /reports nav rule).
 * The plan tiers in lib/plans.ts additionally list names nothing has ever read
 * — custom_domain, sso, dedicated_support, export_csv, shareable_links,
 * draft_approvals, creator_portal, audio_analytics, payments,
 * creator_database. The billing screen was rendering all of them with a green
 * tick, which told an enterprise customer they had bought working features.
 * (ai_creator_discovery was one of these until it was deleted: an
 * enterprise-only near-miss for creator_discovery, the key /api/discovery
 * really gates on, which is why that key's absence from every tier went
 * unnoticed. See lib/plans.ts.)
 */
const LIVE_FEATURE_KEYS = new Set<string>([...Object.keys(FEATURES), ...REPORTS_FEATURE_KEYS]);

export function isLiveFeature(key: string): boolean {
  return LIVE_FEATURE_KEYS.has(key);
}

/** Splits a plan's feature list into the keys the app enforces and the rest. */
export function partitionLiveFeatures(features: string[]): { live: string[]; notBuilt: string[] } {
  const live: string[] = [];
  const notBuilt: string[] = [];
  for (const f of features) (isLiveFeature(f) ? live : notBuilt).push(f);
  return { live, notBuilt };
}

export function clientHasFeature(
  plan: { features: Record<string, boolean> } | null,
  overrides: Record<string, boolean> | null,
  feature: FeatureKey
): boolean {
  const planVal = plan?.features?.[feature] ?? false;
  const override = overrides?.[feature];
  return override !== undefined ? override : planVal;
}

export function asFeatureMap(value: unknown): Record<string, boolean> | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, boolean>;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as Record<string, boolean>;
  return null;
}
