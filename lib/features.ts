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
} from "@/lib/featureKeys";

export const FEATURES = {
  [ANALYTICS_FEATURE]:        { label: "Analytics Dashboard",     description: "View campaign analytics and reports" },
  [BULK_EXPORT_FEATURE]:      { label: "Bulk Export",             description: "Export data in bulk (CSV/XLSX)" },
  [API_ACCESS_FEATURE]:       { label: "API Access",              description: "Access Outreach AI REST API and the MCP tool surface" },
  [CUSTOM_BRANDING_FEATURE]:  { label: "Custom Branding",         description: "White-label with own logo & colors" },
  [ADVANCED_REPORTS_FEATURE]: { label: "Advanced Reports",        description: "Advanced reporting & custom dashboards" },
  [DISCOVERY_FEATURE]:        { label: "Creator Discovery",       description: "Search & discover new creators" },
  [CAMPAIGN_BUDGET_FEATURE]:  { label: "Campaign Budget Tools",   description: "Budget tracking & forecasting" },
  [MULTI_CURRENCY_FEATURE]:   { label: "Multi-Currency Payouts",  description: "Pay creators in multiple currencies" },
  [AUDIT_LOG_FEATURE]:        { label: "Audit Log",               description: "Full audit trail of all actions" },
  [MEDIA_KITS_FEATURE]:       { label: "Media Kits",              description: "Generate creator media kits" },
  [AI_ASSISTANT_FEATURE]:     { label: "AI Assistant",            description: "AI briefings and natural-language analytics (billed per request)" },
} as const;

export type FeatureKey = keyof typeof FEATURES;

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
