/**
 * Platform-wide statistics for the operator dashboard.
 *
 * Sibling of app/api/platform/orgs, and guarded identically: the env allowlist
 * (PLATFORM_ADMIN_EMAILS), never a role. Roles in this product are granted
 * *within* an organisation, so an agency OWNER would otherwise qualify to read
 * every other agency's numbers.
 *
 * Read-only by construction -- there is no POST, PATCH or DELETE here. Changing
 * a tenant's subscription is /api/platform/orgs's job, and keeping the mutating
 * verbs in one file keeps the audit story short.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/billing/subscription";
import { getPlatformStats } from "@/lib/platform/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email ?? null;
  /* 404, not 403 -- the same choice /api/platform/orgs makes. A 403 confirms
     the endpoint exists and that the caller merely lacks standing, which tells
     an attacker where to keep pushing. */
  if (!session?.user || !isPlatformAdmin(email)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(await getPlatformStats());
}
