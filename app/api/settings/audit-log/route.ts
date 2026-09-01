import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOrgEntitlements } from "@/lib/entitlements";
import { AUDIT_LOG_FEATURE } from "@/lib/featureKeys";
import { hasPermission } from "@/lib/rbac";

const ToggleSchema = z.object({
  enabled: z.boolean(),
});

function buildFeatureMap(base: Record<string, boolean>, enabled: boolean) {
  return {
    ...base,
    [AUDIT_LOG_FEATURE]: enabled,
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
    enabled: entitlements.featureMap[AUDIT_LOG_FEATURE] !== false,
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

  /* No limit column is written here -- not maxCampaigns, maxCreators or
     maxUsers.
     This route exists to toggle one feature flag, and it was copying the
     resolved limits back into the row on the way past. All three are uncapped
     now, so the value being copied is Infinity, and the columns are non-null
     Int -- Prisma rejects the write outright, which would turn the audit-log
     toggle into a 500. maxUsers was the last one left; it went the same way
     when seats were uncapped.
     Leaving them out keeps whatever the row already holds; nothing reads any of
     the three any more (see lib/entitlements.ts), so the stale numbers are
     inert. maxTrackers is the only limit still read, and this route has never
     written it. */
  await db.orgPlanConfig.upsert({
    where: { orgId },
    update: {
      planName: entitlements.planName,
      features: nextFeatures,
    },
    create: {
      orgId,
      planName: entitlements.planName,
      features: nextFeatures,
    },
  });

  return NextResponse.json({
    enabled: parsed.data.enabled,
    plan: entitlements.planName,
  });
}
