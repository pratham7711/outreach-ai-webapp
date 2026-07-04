import type { OrgEntitlements } from "@/lib/entitlements";
import type { OrgUiConfig } from "@/lib/orgConfig";
import {
  AUDIT_LOG_FEATURE,
  MEDIA_KITS_FEATURE,
  REPORTS_FEATURE_KEYS,
} from "@/lib/featureKeys";

export type DashboardPolicyInput = {
  entitlements: OrgEntitlements | null;
  uiConfig?: OrgUiConfig | null;
};

export type DashboardPolicy = {
  brandName: string | null;
  primaryColor: string;
  navAllowKeys: string[] | null;
  allowedNavHrefs: string[];
  allowedNavHrefSet: Set<string>;
  featureMap: Record<string, boolean>;
};

type DashboardNavRule = {
  href: string;
  key?: string;
  featureKeys?: string[];
  alwaysVisible?: boolean;
};

const DEFAULT_PRIMARY_COLOR = "#4F46E5";

export const DASHBOARD_NAV_RULES: DashboardNavRule[] = [
  { href: "/campaigns", key: "campaigns" },
  { href: "/inbox", alwaysVisible: true },
  { href: "/activations", key: "activations" },
  { href: "/calendar", key: "calendar" },
  { href: "/clients", key: "clients" },
  { href: "/fan-pages", key: "fan-pages" },
  { href: "/trackers", key: "trackers" },
  { href: "/discovery", key: "discovery" },
  { href: "/creators", key: "creators" },
  { href: "/lists", key: "lists" },
  { href: "/payouts", key: "payouts" },
  { href: "/requests", key: "requests" },
  { href: "/recipients", key: "recipients" },
  { href: "/reports", key: "reports", featureKeys: [...REPORTS_FEATURE_KEYS] },
  { href: "/media-kits", key: "media-kits", featureKeys: [MEDIA_KITS_FEATURE] },
  { href: "/settings", alwaysVisible: true },
  { href: "/connections", alwaysVisible: true },
  { href: "/settings/team", alwaysVisible: true },
  { href: "/settings/api-keys", alwaysVisible: true },
  { href: "/settings/billing", alwaysVisible: true },
  { href: "/settings/ingestion", alwaysVisible: true },
  { href: "/audit-log", key: "audit-log", featureKeys: [AUDIT_LOG_FEATURE] },
  { href: "/admin", alwaysVisible: true },
  { href: "/plans", alwaysVisible: true },
];

const NAV_KEYS_TO_ROUTE = new Map(
  DASHBOARD_NAV_RULES.flatMap((rule) => (rule.key ? [[rule.key, rule.href] as const] : []))
);

function normalizeNavAllowKeys(nav?: string[] | null): string[] | null {
  if (nav == null) return null;

  const normalized = nav
    .map((key) => key.trim())
    .filter(Boolean);

  return Array.from(new Set(normalized));
}

function buildFeatureMap(
  entitlements: OrgEntitlements | null,
  uiConfig?: OrgUiConfig | null
): Record<string, boolean> {
  const featureMap = { ...(entitlements?.featureMap ?? {}) };

  const uiFeatures = uiConfig?.features ?? {};
  for (const [key, enabled] of Object.entries(uiFeatures)) {
    if (typeof enabled === "boolean") {
      featureMap[key] = enabled;
    }
  }

  return featureMap;
}

function isRuleEnabled(rule: DashboardNavRule, featureMap: Record<string, boolean>): boolean {
  if (!rule.featureKeys || rule.featureKeys.length === 0) return true;
  return rule.featureKeys.some((key) => featureMap[key] === true);
}

function isNavKeyAllowed(
  rule: DashboardNavRule,
  navAllowKeys: string[] | null
): boolean {
  if (rule.alwaysVisible) return true;
  if (navAllowKeys === null) return true;
  if (!rule.key) return false;
  return navAllowKeys.includes(rule.key);
}

function pickBrandName(entitlements: OrgEntitlements | null, uiConfig?: OrgUiConfig | null): string | null {
  return uiConfig?.branding?.brandName ?? entitlements?.branding.brandName ?? null;
}

function pickPrimaryColor(entitlements: OrgEntitlements | null, uiConfig?: OrgUiConfig | null): string {
  return uiConfig?.branding?.primaryColor ?? entitlements?.branding.primaryColor ?? DEFAULT_PRIMARY_COLOR;
}

export function resolveDashboardPolicy({
  entitlements,
  uiConfig,
}: DashboardPolicyInput): DashboardPolicy {
  const featureMap = buildFeatureMap(entitlements, uiConfig);
  const navAllowKeys = normalizeNavAllowKeys(uiConfig?.nav ?? null);

  const allowedNavHrefs = DASHBOARD_NAV_RULES
    .filter((rule) => isRuleEnabled(rule, featureMap))
    .filter((rule) => isNavKeyAllowed(rule, navAllowKeys))
    .map((rule) => rule.href);

  return {
    brandName: pickBrandName(entitlements, uiConfig),
    primaryColor: pickPrimaryColor(entitlements, uiConfig),
    navAllowKeys,
    allowedNavHrefs,
    allowedNavHrefSet: new Set(allowedNavHrefs),
    featureMap,
  };
}

export function isDashboardHrefAllowed(
  href: string,
  policy: Pick<DashboardPolicy, "allowedNavHrefSet">
): boolean {
  return policy.allowedNavHrefSet.has(href);
}

export function getDashboardNavHref(key: string): string | undefined {
  return NAV_KEYS_TO_ROUTE.get(key);
}
