import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, type AuthResult } from "@/lib/authenticate";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";
import { CREATOR_FINDER_FEATURE } from "@/lib/featureKeys";

export const noStore = { "Cache-Control": "no-store" };

/**
 * Every Creator Finder route starts here: signed in, and the org has
 * creator_finder switched on. An org without it gets a 403 that names the
 * feature, never an empty list, so "off" and "nothing found yet" can't be
 * confused.
 */
export async function requireCreatorFinder(req: NextRequest): Promise<AuthResult | NextResponse> {
  const auth = await authenticateRequest(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  const entitlements = await getOrgEntitlements(auth.orgId);
  if (!hasOrgFeature(entitlements, CREATOR_FINDER_FEATURE)) {
    return NextResponse.json(
      { error: "feature_disabled", reason: "Creator Finder isn't switched on for this workspace." },
      { status: 403, headers: noStore },
    );
  }
  return auth;
}
