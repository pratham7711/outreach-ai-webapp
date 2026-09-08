import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/authenticate";
import { checkInstagramBusinessSource } from "@/lib/integrations/health";

/**
 * Is the platform's Instagram data source alive? Read by the banners on the
 * surfaces where Instagram numbers are consumed.
 *
 * Deliberately NOT orgId-filtered, unlike every other read in this codebase:
 * INSTAGRAM_BUSINESS_TOKEN is one deployment-wide env var serving every tenant,
 * so there is no per-tenant row here to scope. Authentication is still required
 * -- the answer says something about our infrastructure, and an anonymous caller
 * has no business learning it -- but any signed-in member gets the same answer,
 * because the banner has to render for the people who read the numbers, not only
 * for the admin who can fix it.
 *
 * The probe underneath is cached for 5 minutes across the deployment, so this
 * route is cheap to poll and cannot be used to hammer Graph.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const instagram = await checkInstagramBusinessSource();
  return NextResponse.json({ instagram });
}
