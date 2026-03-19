export const FEATURES = {
  analytics:         { label: "Analytics Dashboard",     description: "View campaign analytics and reports" },
  bulk_export:       { label: "Bulk Export",             description: "Export data in bulk (CSV/XLSX)" },
  api_access:        { label: "API Access",              description: "Access CreatorCore REST API" },
  custom_branding:   { label: "Custom Branding",         description: "White-label with own logo & colors" },
  advanced_reports:  { label: "Advanced Reports",        description: "Advanced reporting & custom dashboards" },
  creator_discovery: { label: "Creator Discovery",       description: "Search & discover new creators" },
  campaign_budget:   { label: "Campaign Budget Tools",   description: "Budget tracking & forecasting" },
  multi_currency:    { label: "Multi-Currency Payouts",  description: "Pay creators in multiple currencies" },
  audit_log:         { label: "Audit Log",               description: "Full audit trail of all actions" },
  media_kits:        { label: "Media Kits",              description: "Generate creator media kits" },
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
