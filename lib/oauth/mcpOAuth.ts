import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { BRAND } from "@/lib/brand";

/**
 * OAuth 2.1 for the MCP endpoint, as the MCP authorization spec lays it out:
 * the MCP route is the protected resource, this app is its authorization
 * server, PKCE (S256) is mandatory, and a client either registers itself
 * (RFC 7591) or identifies by the URL of a client metadata document.
 *
 * Tokens act as the person who clicked Allow -- their role, their campaign
 * scope, re-read from the database on every call -- and are accepted on
 * /api/mcp only. An org API key is the other way in and stays org-wide; a
 * token is the narrower of the two on purpose.
 *
 * Everything here is pure or takes its inputs; the routes do the I/O.
 */

export const MCP_SCOPE = "mcp";
export const ACCESS_TOKEN_TTL_S = 60 * 60;
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;
export const CODE_TTL_S = 10 * 60;

const ACCESS_PREFIX = "mbo_at_";
const REFRESH_PREFIX = "mbo_rt_";
const CODE_PREFIX = "mbo_ac_";
const CLIENT_PREFIX = "mbo_client_";
const SECRET_PREFIX = "mbo_cs_";

/** The origin a request reached us on, so metadata names the host a client used. */
export function originOf(url: string | URL): string {
  try {
    return new URL(url).origin;
  } catch {
    return new URL(BRAND.url).origin;
  }
}

export function mcpResourceUrl(origin: string): string {
  return `${origin}/api/mcp`;
}

export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource/api/mcp`;
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: `${BRAND.name}`,
    resource_documentation: `${origin}/mcp`,
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [MCP_SCOPE],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/mcp`,
  };
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function token(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url");
}

export const newAccessToken = () => token(ACCESS_PREFIX);
export const newRefreshToken = () => token(REFRESH_PREFIX);
export const newAuthorizationCode = () => token(CODE_PREFIX);
export const newClientId = () => CLIENT_PREFIX + randomBytes(16).toString("hex");
export const newClientSecret = () => token(SECRET_PREFIX);

export function isAccessToken(value: string): boolean {
  return value.startsWith(ACCESS_PREFIX) && value.length > ACCESS_PREFIX.length + 20;
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** RFC 7636: the verifier is 43-128 unreserved characters, and S256 is the only method we take. */
export function verifyPkce(verifier: string | null | undefined, challenge: string): boolean {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return safeEqual(computed, challenge);
}

export function isValidCodeChallenge(challenge: string | null | undefined): challenge is string {
  return typeof challenge === "string" && /^[A-Za-z0-9\-_]{43}$/.test(challenge);
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const REFUSED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:"]);

/**
 * Which redirect URIs a client may register. https anywhere; http only to the
 * loopback (a desktop client listening on a local port, RFC 8252); a private
 * app scheme (cursor://, vscode://) for native apps. Never a fragment.
 */
export function isAllowedRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (REFUSED_SCHEMES.has(url.protocol)) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

/**
 * Whether `requested` is one of `registered`. Exact, except that a loopback
 * redirect may use any port: a native client picks a free port at sign-in time,
 * which it cannot know when it registers (RFC 8252 section 7.3).
 */
export function redirectUriMatches(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  if (req.protocol !== "http:" || !LOOPBACK_HOSTS.has(req.hostname)) return false;
  return registered.some((r) => {
    try {
      const reg = new URL(r);
      return (
        reg.protocol === "http:" &&
        reg.hostname === req.hostname &&
        reg.pathname === req.pathname &&
        reg.search === req.search
      );
    } catch {
      return false;
    }
  });
}

/** The scope every grant carries, whatever a client asked for: unknown scopes are dropped, never refused. */
export function grantedScope(): string {
  return MCP_SCOPE;
}

/** RFC 8707: a resource indicator, when sent, must name our MCP endpoint (a trailing slash aside). */
export function resourceMatches(requested: string | null | undefined, origin: string): boolean {
  if (!requested) return true;
  const want = mcpResourceUrl(origin);
  return requested.replace(/\/+$/, "") === want || requested.replace(/\/+$/, "") === origin;
}

export type ResolvedClient = {
  clientId: string;
  name: string | null;
  clientUri: string | null;
  logoUri: string | null;
  redirectUris: string[];
  tokenEndpointAuthMethod: "none" | "client_secret_post" | "client_secret_basic";
  clientSecretHash: string | null;
  kind: "registered" | "metadata-document";
};

/** A client_id that is itself a URL names a client metadata document. */
export function isMetadataDocumentClientId(clientId: string): boolean {
  try {
    const url = new URL(clientId);
    return url.protocol === "https:" && url.pathname !== "/" && !url.hash && !LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

const IP_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$|^\[.*\]$/;

/**
 * Reads and checks a client metadata document. The document must name itself
 * (client_id equal to the URL it was fetched from) and list its redirect URIs;
 * it can only ever describe a public client, because a document anyone can
 * read cannot carry a secret.
 */
export async function fetchMetadataDocumentClient(
  clientId: string,
  fetchFn: typeof fetch = fetch,
): Promise<ResolvedClient | null> {
  if (!isMetadataDocumentClientId(clientId)) return null;
  const url = new URL(clientId);
  if (IP_LITERAL.test(url.hostname)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetchFn(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > 20_000) return null;
    const doc = JSON.parse(text) as Record<string, unknown>;
    if (doc.client_id !== clientId) return null;
    const redirectUris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter(isAllowedRedirectUri) : [];
    if (redirectUris.length === 0) return null;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
    return {
      clientId,
      name: str(doc.client_name),
      clientUri: str(doc.client_uri),
      logoUri: str(doc.logo_uri),
      redirectUris,
      tokenEndpointAuthMethod: "none",
      clientSecretHash: null,
      kind: "metadata-document",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** What to call the client on the consent screen and in Connected apps. */
export function clientDisplayName(client: Pick<ResolvedClient, "name" | "redirectUris" | "clientId">): string {
  if (client.name) return client.name;
  const first = client.redirectUris[0];
  try {
    return new URL(first).hostname || client.clientId;
  } catch {
    return client.clientId;
  }
}

/** The host a code is sent back to, shown on the consent screen so a look-alike name cannot hide it. */
export function redirectHostLabel(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    if (url.protocol === "http:" || url.protocol === "https:") return url.host;
    return `${url.protocol}//${url.host}`;
  } catch {
    return redirectUri;
  }
}

export function authorizationRedirect(
  redirectUri: string,
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  return url.toString();
}

export type ClientCredentials = { clientId: string | null; clientSecret: string | null };

/** client_secret_basic from the Authorization header, else client_id / client_secret from the form. */
export function clientCredentialsFrom(authorization: string | null, form: URLSearchParams): ClientCredentials {
  if (authorization?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
      const i = decoded.indexOf(":");
      if (i > 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, i)),
          clientSecret: decodeURIComponent(decoded.slice(i + 1)),
        };
      }
    } catch {
      /* fall through to the form */
    }
  }
  return { clientId: form.get("client_id"), clientSecret: form.get("client_secret") };
}

/** Whether the presented credentials satisfy how the client registered. */
export function clientAuthenticates(client: ResolvedClient, presentedSecret: string | null): boolean {
  if (client.tokenEndpointAuthMethod === "none" || !client.clientSecretHash) return true;
  return typeof presentedSecret === "string" && safeEqual(hashSecret(presentedSecret), client.clientSecretHash);
}

export function oauthError(error: string, description: string, status = 400) {
  return Response.json(
    { error, error_description: description },
    { status, headers: { "cache-control": "no-store", ...CORS_HEADERS } },
  );
}

/** Public metadata and token endpoints are called from anywhere, including in-browser inspectors. */
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "www-authenticate, mcp-protocol-version",
  "access-control-max-age": "86400",
};

export function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
