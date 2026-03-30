/**
 * orgConfig — standalone raw uiConfig accessor.
 *
 * Boundary: this file reads and types the raw `uiConfig` JSON column from the DB.
 * It does NOT interpret entitlements, plan config, or feature flags — those live in
 * `lib/entitlements.ts` (canonical org capability source) and are merged with uiConfig
 * in `lib/dashboardPolicy.ts` (nav/branding resolution).
 *
 * Do not add entitlement logic here; do not call `getOrgEntitlements` from here.
 */
import { db } from "@/lib/db";

export type OrgUiConfig = {
  features?: {
    soundTracker?: boolean;
    creatorPortal?: boolean;
    aiBriefings?: boolean;
    reports?: boolean;
    csvExport?: boolean;
  };
  nav?: string[];
  branding?: {
    primaryColor?: string;
    brandName?: string;
  };
  limits?: {
    maxCampaigns?: number;
    maxCreators?: number;
    maxUsers?: number;
  };
  platforms?: {
    tiktok?: boolean;
    instagram?: boolean;
    youtube?: boolean;
  };
  dashboard?: string[];
};

export async function getOrgUiConfig(orgId: string): Promise<OrgUiConfig | null> {
  try {
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { uiConfig: true, brandName: true },
    });
    if (!org) return null;
    return (org.uiConfig as OrgUiConfig) ?? null;
  } catch {
    return null;
  }
}
