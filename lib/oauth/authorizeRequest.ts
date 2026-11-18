import {
  authorizationRedirect,
  grantedScope,
  isValidCodeChallenge,
  redirectUriMatches,
  resourceMatches,
  type ResolvedClient,
} from "./mcpOAuth";
import { OAuthUnavailable, resolveClient } from "./mcpOAuthStore";

/**
 * One check of an authorization request, shared by the consent page (GET) and
 * the decision it posts back: the hidden fields are never trusted, the request
 * is checked again from scratch.
 *
 * Until the client and its redirect URI are known good, nothing is sent back
 * to the redirect URI (RFC 6749 4.1.2.1): the page shows the problem instead,
 * so a forged link cannot bounce a signed-in person to an attacker's address.
 */

export type AuthorizeParams = {
  response_type?: string | null;
  client_id?: string | null;
  redirect_uri?: string | null;
  code_challenge?: string | null;
  code_challenge_method?: string | null;
  state?: string | null;
  scope?: string | null;
  resource?: string | null;
};

export type AuthorizeCheck =
  | { kind: "fatal"; message: string }
  | { kind: "redirect"; url: string }
  | {
      kind: "ok";
      client: ResolvedClient;
      redirectUri: string;
      codeChallenge: string;
      state: string | null;
      scope: string;
      resource: string | null;
    };

export function paramsFrom(source: URLSearchParams | Record<string, string | string[] | undefined>): AuthorizeParams {
  const get = (k: string): string | null => {
    if (source instanceof URLSearchParams) return source.get(k);
    const v = source[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] ?? null : null;
  };
  return {
    response_type: get("response_type"),
    client_id: get("client_id"),
    redirect_uri: get("redirect_uri"),
    code_challenge: get("code_challenge"),
    code_challenge_method: get("code_challenge_method"),
    state: get("state"),
    scope: get("scope"),
    resource: get("resource"),
  };
}

export async function checkAuthorizeRequest(p: AuthorizeParams, origin: string, issuer: string): Promise<AuthorizeCheck> {
  let client: ResolvedClient | null;
  try {
    client = await resolveClient(p.client_id);
  } catch (e) {
    if (e instanceof OAuthUnavailable) return { kind: "fatal", message: "Connecting apps isn't set up yet. Try again shortly." };
    throw e;
  }
  if (!client) return { kind: "fatal", message: "This app isn't recognised. Start the connection again from the app." };

  const redirectUri = p.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
  if (!redirectUri || !redirectUriMatches(client.redirectUris, redirectUri)) {
    return { kind: "fatal", message: "This app asked to send you to an address it didn't register. Start the connection again from the app." };
  }

  const back = (error: string, description: string): AuthorizeCheck => ({
    kind: "redirect",
    url: authorizationRedirect(redirectUri, { error, error_description: description, state: p.state, iss: issuer }),
  });
  if (p.response_type !== "code") return back("unsupported_response_type", "response_type must be code");
  if (p.code_challenge_method !== "S256" || !isValidCodeChallenge(p.code_challenge)) {
    return back("invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  if (!resourceMatches(p.resource, origin)) return back("invalid_target", "resource must be this MCP endpoint");

  return {
    kind: "ok",
    client,
    redirectUri,
    codeChallenge: p.code_challenge as string,
    state: p.state ?? null,
    scope: grantedScope(),
    resource: p.resource ?? null,
  };
}
