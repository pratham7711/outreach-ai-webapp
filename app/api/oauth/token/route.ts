import { NextRequest } from "next/server";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { CORS_HEADERS, clientAuthenticates, clientCredentialsFrom, oauthError, preflight } from "@/lib/oauth/mcpOAuth";
import {
  OAuthUnavailable,
  exchangeAuthorizationCode,
  refreshTokens,
  resolveClient,
  type IssuedTokens,
  type TokenFailure,
} from "@/lib/oauth/mcpOAuthStore";
import { originFromHeaders } from "@/lib/oauth/requestOrigin";

export const dynamic = "force-dynamic";

async function formOf(req: NextRequest): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") form.set(k, v);
    return form;
  }
  return new URLSearchParams(await req.text());
}

/** RFC 6749 token endpoint: authorization_code (with PKCE) and refresh_token. */
export async function POST(req: NextRequest) {
  const limit = rateLimit({ key: rateLimitKey("oauth-token", req), limit: 120, windowMs: 60 * 1000 });
  if (!limit.allowed) return oauthError("slow_down", "Too many token requests.", 429);

  const form = await formOf(req);
  const { clientId, clientSecret } = clientCredentialsFrom(req.headers.get("authorization"), form);
  try {
    const client = await resolveClient(clientId);
    if (!client || !clientAuthenticates(client, clientSecret)) {
      return oauthError("invalid_client", "Unknown client or wrong client credentials.", 401);
    }

    let result: IssuedTokens | TokenFailure;
    const grant = form.get("grant_type");
    if (grant === "authorization_code") {
      result = await exchangeAuthorizationCode({
        code: form.get("code"),
        client,
        redirectUri: form.get("redirect_uri"),
        codeVerifier: form.get("code_verifier"),
        resource: form.get("resource"),
        origin: originFromHeaders(req.headers),
      });
    } else if (grant === "refresh_token") {
      result = await refreshTokens({ refreshToken: form.get("refresh_token"), client });
    } else {
      return oauthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token.");
    }

    if ("error" in result) return oauthError(result.error, result.description);
    return Response.json(result, { headers: { ...CORS_HEADERS, "cache-control": "no-store", pragma: "no-cache" } });
  } catch (e) {
    if (e instanceof OAuthUnavailable) return oauthError("temporarily_unavailable", "Sign-in for apps is not set up yet.", 503);
    throw e;
  }
}

export const OPTIONS = preflight;
