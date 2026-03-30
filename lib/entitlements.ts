import { db } from "@/lib/db";
import { PLANS, type PlanName } from "@/lib/plans";

type JsonObject = Record<string, unknown>;

export type OrgEntitlements = {
  orgId: string;
  planName: string;
  features: string[];
  featureMap: Record<string, boolean>;
  limits: {
    maxCampaigns: number;
    maxCreators: number;
    maxUsers: number;
  };
  branding: {
    brandName: string | null;
    logoUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    fontFamily: string;
  };
  uiConfig: JsonObject | null;
};

function isPlanName(value: string): value is PlanName {
  return value in PLANS;
}

function normalizeFeatureMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, enabled]) => typeof enabled === "boolean")
    .map(([key, enabled]) => [key, enabled as boolean]);

  return Object.fromEntries(entries);
}

function featureMapToList(featureMap: Record<string, boolean>): string[] {
  return Object.entries(featureMap)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
}

export async function getOrgEntitlements(orgId: string): Promise<OrgEntitlements | null> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    include: { planConfig: true },
  });

  if (!org) return null;

  const fallbackPlanName = isPlanName(org.plan) ? org.plan : "free";
  const fallbackPlan = PLANS[fallbackPlanName];
  const planName = org.planConfig?.planName ?? org.plan ?? fallbackPlanName;
  const configFeatureMap = normalizeFeatureMap(org.planConfig?.features);
  const fallbackFeatureMap = Object.fromEntries(fallbackPlan.features.map((feature) => [feature, true]));

  const featureMap = {
    ...fallbackFeatureMap,
    ...configFeatureMap,
    // Audit log starts enabled unless explicitly disabled by the org toggle.
    audit_log: configFeatureMap.audit_log ?? true,
  };

  return {
    orgId: org.id,
    planName,
    features: featureMapToList(featureMap),
    featureMap,
    limits: {
      maxCampaigns: org.planConfig?.maxCampaigns ?? fallbackPlan.max_campaigns,
      maxCreators: org.planConfig?.maxCreators ?? fallbackPlan.max_creators,
      maxUsers: org.planConfig?.maxUsers ?? fallbackPlan.max_users,
    },
    branding: {
      brandName: org.brandName ?? org.name,
      logoUrl: org.logoUrl ?? null,
      faviconUrl: org.faviconUrl ?? null,
      primaryColor: org.primaryColor,
      secondaryColor: org.secondaryColor,
      accentColor: org.accentColor,
      fontFamily: org.fontFamily,
    },
    uiConfig: (org.uiConfig as JsonObject | null) ?? null,
  };
}
