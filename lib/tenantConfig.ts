import type { OrgEntitlements } from "@/lib/entitlements";

/**
 * What the client's TenantProvider holds: /api/tenant/config's answer, and
 * the dashboard layout's `initial` for it, built in one place so the two
 * cannot drift apart.
 */
export function tenantConfigFor(entitlements: OrgEntitlements) {
  return {
    orgId: entitlements.orgId,
    brandName: entitlements.branding.brandName,
    logoUrl: entitlements.branding.logoUrl,
    faviconUrl: entitlements.branding.faviconUrl,
    primaryColor: entitlements.branding.primaryColor,
    secondaryColor: entitlements.branding.secondaryColor,
    accentColor: entitlements.branding.accentColor,
    fontFamily: entitlements.branding.fontFamily,
    plan: entitlements.planName,
    features: entitlements.features,
    maxCampaigns: entitlements.limits.maxCampaigns,
    maxCreators: entitlements.limits.maxCreators,
    maxUsers: entitlements.limits.maxUsers,
  };
}
