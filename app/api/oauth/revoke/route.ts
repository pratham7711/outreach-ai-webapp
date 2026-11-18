import { NextRequest } from "next/server";
import { CORS_HEADERS, clientAuthenticates, clientCredentialsFrom, oauthError, preflight } from "@/lib/oauth/mcpOAuth";
import { OAuthUnavailable, resolveClient, revokeToken } from "@/lib/oauth/mcpOAuthStore";

export const dynamic = "force-dynamic";

/** RFC 7009. Answers 200 for an unknown token, so it reveals nothing about which tokens exist. */
export async function POST(req: NextRequest) {
  const form = new URLSearchParams(await req.text());
  const { clientId, clientSecret } = clientCredentialsFrom(req.headers.get("authorization"), form);
  try {
    const client = clientId ? await resolveClient(clientId) : null;
    if (clientId && (!client || !clientAuthenticates(client, clientSecret))) {
      return oauthError("invalid_client", "Unknown client or wrong client credentials.", 401);
    }
    await revokeToken(form.get("token"), client?.clientId ?? null);
    return new Response(null, { status: 200, headers: { ...CORS_HEADERS, "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof OAuthUnavailable) return oauthError("temporarily_unavailable", "Sign-in for apps is not set up yet.", 503);
    throw e;
  }
}

export const OPTIONS = preflight;
