import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { createAuditActor, logAudit } from "@/lib/audit";
import { createLogger } from "@/lib/observability/logger";
import {
  AGENCY_IG_STATE_COOKIE,
  agencyStateMatches,
  connectAgencyInstagram,
} from "@/lib/platforms/instagramAgencyConnect";

const SETTINGS_PATH = "/settings/integrations";

const log = createLogger({ context: { call: "settings.instagram.callback" } });

/**
 * Where Facebook Login returns. The code is spent only after the session, the
 * role and the state have all been checked: the state cookie names the org the
 * consent was started for, so a consent begun in one org cannot land in
 * another, and a member without settings rights never gets a token stored.
 */
export async function GET(req: NextRequest) {
  const finish = (query: string) => {
    const res = NextResponse.redirect(new URL(`${SETTINGS_PATH}?${query}`, req.url));
    res.cookies.delete(AGENCY_IG_STATE_COOKIE);
    return res;
  };

  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", req.url));
  const role = (session.user as any).role as string;
  const orgId = (session.user as any).orgId as string | undefined;
  if (!orgId || !hasPermission(role, "settings:*")) return finish("instagram=error&reason=forbidden");

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return finish("instagram=error&reason=denied");

  const code = params.get("code");
  if (!code || !agencyStateMatches(req.cookies.get(AGENCY_IG_STATE_COOKIE)?.value, params.get("state"), orgId)) {
    log.warn("agency Instagram state check failed", {
      orgId,
      hasCode: Boolean(code),
      hasCookie: Boolean(req.cookies.get(AGENCY_IG_STATE_COOKIE)?.value),
    });
    return finish("instagram=error&reason=state");
  }

  try {
    const result = await connectAgencyInstagram(orgId, code);
    if (!result.ok) return finish(`instagram=error&reason=${result.reason}`);
    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: "org.update",
      entityType: "organization",
      entityId: orgId,
      entityLabel: "Instagram Business account",
      metadata: { integration: "instagram_business", connected: true, igUserId: result.account.igUserId },
    });
    return finish("instagram=connected");
  } catch (error) {
    log.error("agency Instagram connect failed", {
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
    return finish("instagram=error&reason=exception");
  }
}
