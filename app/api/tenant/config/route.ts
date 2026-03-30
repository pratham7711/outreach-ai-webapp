import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOrgEntitlements } from "@/lib/entitlements";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId as string;

  const entitlements = await getOrgEntitlements(orgId);
  if (!entitlements) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  return NextResponse.json({
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
  });
}
