import { NextRequest } from "next/server";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import {
  CORS_HEADERS,
  hashSecret,
  isAllowedRedirectUri,
  newClientId,
  newClientSecret,
  oauthError,
  preflight,
} from "@/lib/oauth/mcpOAuth";
import { OAuthUnavailable, registerClient } from "@/lib/oauth/mcpOAuthStore";

export const dynamic = "force-dynamic";

const AUTH_METHODS = new Set(["none", "client_secret_post", "client_secret_basic"]);

/**
 * RFC 7591 dynamic client registration. Open, as MCP clients expect: a client
 * that registers has asked for nothing yet, and every grant still needs a
 * signed-in person to press Allow on a screen that names the app and the host
 * it sends codes to. Rate-limited per IP so the table cannot be flooded.
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit({ key: rateLimitKey("oauth-register", req), limit: 20, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return oauthError("slow_down", "Too many registrations from this address.", 429);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return oauthError("invalid_client_metadata", "The body must be JSON.");
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (redirectUris.length === 0 || redirectUris.length > 10 || !redirectUris.every(isAllowedRedirectUri)) {
    return oauthError(
      "invalid_redirect_uri",
      "redirect_uris must list 1-10 https URLs, loopback http URLs or app-scheme URLs, without fragments.",
    );
  }
  const grantTypes = Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code"];
  if (!grantTypes.includes("authorization_code")) {
    return oauthError("invalid_client_metadata", "grant_types must include authorization_code.");
  }
  const method = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
  if (!AUTH_METHODS.has(method)) {
    return oauthError("invalid_client_metadata", "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.");
  }
  const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const httpsOrNull = (v: unknown) => {
    const s = str(v, 2000);
    return s && /^https:\/\//i.test(s) ? s : null;
  };

  const clientId = newClientId();
  const secret = method === "none" ? null : newClientSecret();
  try {
    const row = await registerClient({
      clientId,
      clientSecretHash: secret ? hashSecret(secret) : null,
      name: str(body.client_name),
      clientUri: httpsOrNull(body.client_uri),
      logoUri: httpsOrNull(body.logo_uri),
      redirectUris: redirectUris as string[],
      tokenEndpointAuthMethod: method,
    });
    return Response.json(
      {
        client_id: row.clientId,
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
        client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
        client_name: row.name ?? undefined,
        client_uri: row.clientUri ?? undefined,
        logo_uri: row.logoUri ?? undefined,
        redirect_uris: row.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: method,
        scope: "mcp",
      },
      { status: 201, headers: { ...CORS_HEADERS, "cache-control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof OAuthUnavailable) return oauthError("temporarily_unavailable", "Sign-in for apps is not set up yet.", 503);
    throw e;
  }
}

export const OPTIONS = preflight;
