import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOrgEntitlements } from "@/lib/entitlements";
import { tenantConfigFor } from "@/lib/tenantConfig";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId as string;

  const entitlements = await getOrgEntitlements(orgId);
  if (!entitlements) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  return NextResponse.json(tenantConfigFor(entitlements));
}
