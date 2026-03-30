import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { REPORTS_FEATURE_KEYS } from "@/lib/featureKeys";
import { getOrgEntitlements, hasAnyOrgFeature } from "@/lib/entitlements";
import { hasPermission } from "@/lib/rbac";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId as string;
  const entitlements = await getOrgEntitlements(orgId);
  if (!hasAnyOrgFeature(entitlements, [...REPORTS_FEATURE_KEYS])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const report = await db.report.findFirst({
    where: { id, orgId },
    include: { campaign: { select: { id: true, title: true } } },
  });

  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(report);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId as string;
  const entitlements = await getOrgEntitlements(orgId);
  if (!hasAnyOrgFeature(entitlements, [...REPORTS_FEATURE_KEYS])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const existing = await db.report.findFirst({ where: { id, orgId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const { title, isPublic, config, campaignId } = body;

  const report = await db.report.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(isPublic !== undefined && { isPublic }),
      ...(config !== undefined && { config }),
      ...(campaignId !== undefined && { campaignId }),
    },
    include: { campaign: { select: { id: true, title: true } } },
  });

  return NextResponse.json(report);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId as string;
  const role = (session.user as any).role as string;
  const entitlements = await getOrgEntitlements(orgId);
  if (!hasAnyOrgFeature(entitlements, [...REPORTS_FEATURE_KEYS])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  if (!hasPermission(role, "reports:*")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await db.report.findFirst({ where: { id, orgId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.report.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
