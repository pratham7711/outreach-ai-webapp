import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOrgEntitlements } from "@/lib/entitlements";
import { hasPermission } from "@/lib/rbac";

const ToggleSchema = z.object({
  enabled: z.boolean(),
});

function buildFeatureMap(base: Record<string, boolean>, enabled: boolean) {
  return {
    ...base,
    audit_log: enabled,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (session.user as any).role as string;
  if (!hasPermission(role, "settings:*")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orgId = (session.user as any).orgId as string;
  const entitlements = await getOrgEntitlements(orgId);
  if (!entitlements) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    enabled: entitlements.featureMap.audit_log !== false,
    plan: entitlements.planName,
  });
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (session.user as any).role as string;
  if (!hasPermission(role, "settings:*")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orgId = (session.user as any).orgId as string;
  const entitlements = await getOrgEntitlements(orgId);
  if (!entitlements) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = ToggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const nextFeatures = buildFeatureMap(entitlements.featureMap, parsed.data.enabled);

  await db.orgPlanConfig.upsert({
    where: { orgId },
    update: {
      planName: entitlements.planName,
      maxCampaigns: entitlements.limits.maxCampaigns,
      maxCreators: entitlements.limits.maxCreators,
      maxUsers: entitlements.limits.maxUsers,
      features: nextFeatures,
    },
    create: {
      orgId,
      planName: entitlements.planName,
      maxCampaigns: entitlements.limits.maxCampaigns,
      maxCreators: entitlements.limits.maxCreators,
      maxUsers: entitlements.limits.maxUsers,
      features: nextFeatures,
    },
  });

  return NextResponse.json({
    enabled: parsed.data.enabled,
    plan: entitlements.planName,
  });
}
