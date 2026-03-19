import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPlanLimits } from "@/lib/plans";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId as string;

  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  const limits = getPlanLimits(org.plan);

  return NextResponse.json({
    orgId: org.id,
    brandName: org.brandName ?? org.name,
    logoUrl: org.logoUrl,
    faviconUrl: org.faviconUrl,
    primaryColor: org.primaryColor,
    secondaryColor: org.secondaryColor,
    accentColor: org.accentColor,
    fontFamily: org.fontFamily,
    plan: org.plan,
    features: limits.features,
    maxCampaigns: limits.max_campaigns,
    maxCreators: limits.max_creators,
    maxUsers: limits.max_users,
  });
}
