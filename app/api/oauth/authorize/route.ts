import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";
import { API_ACCESS_FEATURE } from "@/lib/featureKeys";
import { checkAuthorizeRequest, paramsFrom } from "@/lib/oauth/authorizeRequest";
import { authorizationRedirect } from "@/lib/oauth/mcpOAuth";
import { createAuthorizationCode } from "@/lib/oauth/mcpOAuthStore";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { originFromHeaders } from "@/lib/oauth/requestOrigin";

export const dynamic = "force-dynamic";

function seeOther(url: string) {
  return new Response(null, { status: 303, headers: { location: url, "cache-control": "no-store" } });
}

/**
 * The consent screen's Allow / Cancel. Same-origin only: a cross-site form
 * post must not be able to press Allow for somebody who is signed in.
 */
export async function POST(req: NextRequest) {
  const origin = originFromHeaders(req.headers);
  if (req.headers.get("origin") !== origin) {
    return Response.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  const form = new URLSearchParams(await req.text());
  const params = paramsFrom(form);

  const session = await auth();
  const user = session?.user as { id?: string; email?: string | null; orgId?: string } | undefined;
  if (!user?.id || !user.orgId) {
    const back = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string")
    );
    return seeOther(`/oauth/authorize?${back.toString()}`);
  }

  const check = await checkAuthorizeRequest(params, origin, origin);
  if (check.kind === "fatal") {
    const back = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string")
    );
    return seeOther(`/oauth/authorize?${back.toString()}`);
  }
  if (check.kind === "redirect") return seeOther(check.url);

  const deny = (description: string) =>
    seeOther(
      authorizationRedirect(check.redirectUri, {
        error: "access_denied",
        error_description: description,
        state: check.state,
        iss: origin,
      })
    );

  if (form.get("decision") !== "allow") return deny("The person declined to connect.");
  if (!hasOrgFeature(await getOrgEntitlements(user.orgId), API_ACCESS_FEATURE)) {
    return deny("This workspace's plan does not include API access.");
  }

  const code = await createAuthorizationCode({
    clientId: check.client.clientId,
    userId: user.id,
    orgId: user.orgId,
    redirectUri: check.redirectUri,
    codeChallenge: check.codeChallenge,
    scope: check.scope,
    resource: check.resource,
  });

  await logAudit({
    orgId: user.orgId,
    userId: user.id,
    actorEmail: user.email ?? undefined,
    actorType: "user",
    action: "mcp_app.connect",
    entityType: "mcp_app",
    entityId: check.client.clientId.slice(0, 190),
    entityLabel: check.client.name ?? check.client.clientId.slice(0, 190),
    ipAddress: getRequestIp(req),
  }).catch(() => {});

  return seeOther(authorizationRedirect(check.redirectUri, { code, state: check.state, iss: origin }));
}
