/**
 * @jest-environment node
 *
 * The pure half of the MCP OAuth server: PKCE, which redirect URIs a client
 * may use, resource indicators, client metadata documents and how a client
 * proves itself at the token endpoint.
 */
import { createHash } from "crypto";
import {
  authorizationRedirect,
  authorizationServerMetadata,
  clientAuthenticates,
  clientCredentialsFrom,
  clientDisplayName,
  fetchMetadataDocumentClient,
  hashSecret,
  isAccessToken,
  isAllowedRedirectUri,
  isMetadataDocumentClientId,
  isValidCodeChallenge,
  newAccessToken,
  newRefreshToken,
  protectedResourceMetadata,
  redirectHostLabel,
  redirectUriMatches,
  resourceMatches,
  verifyPkce,
  type ResolvedClient,
} from "@/lib/oauth/mcpOAuth";

const ORIGIN = "https://campaign.example.com";
const verifier = "a".repeat(20) + "-._~" + "B9".repeat(12);
const challenge = createHash("sha256").update(verifier).digest("base64url");

describe("PKCE", () => {
  it("accepts the verifier the challenge was made from", () => {
    expect(isValidCodeChallenge(challenge)).toBe(true);
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("refuses a different, short, missing or badly formed verifier", () => {
    expect(verifyPkce(verifier + "x", challenge)).toBe(false);
    expect(verifyPkce("short", challenge)).toBe(false);
    expect(verifyPkce(null, challenge)).toBe(false);
    expect(verifyPkce(verifier.replace("a", "!"), challenge)).toBe(false);
  });

  it("only takes a 43-character S256 challenge", () => {
    expect(isValidCodeChallenge("plain-verifier")).toBe(false);
    expect(isValidCodeChallenge(challenge + "=")).toBe(false);
    expect(isValidCodeChallenge(undefined)).toBe(false);
  });
});

describe("redirect URIs", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "http://localhost:6274/oauth/callback",
    "http://127.0.0.1/callback",
    "cursor://anysphere.cursor-retrieval/oauth/callback",
  ])("allows %s", (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(true);
  });

  it.each([
    "http://evil.example.com/cb",
    "https://claude.ai/cb#frag",
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "not a url",
    42,
  ])("refuses %s", (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false);
  });

  it("matches exactly, except a loopback port", () => {
    const registered = ["https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:3000/callback"];
    expect(redirectUriMatches(registered, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectUriMatches(registered, "http://127.0.0.1:51234/callback")).toBe(true);
    expect(redirectUriMatches(registered, "http://127.0.0.1:51234/other")).toBe(false);
    expect(redirectUriMatches(registered, "http://localhost:3000/callback")).toBe(false);
    expect(redirectUriMatches(registered, "https://claude.ai/api/mcp/auth_callback?x=1")).toBe(false);
    expect(redirectUriMatches(registered, "https://claude.ai.evil.com/api/mcp/auth_callback")).toBe(false);
  });

  it("puts code, state and iss on the redirect, keeping its own query", () => {
    const url = new URL(authorizationRedirect("https://app.test/cb?keep=1", { code: "c", state: "s", iss: ORIGIN, skip: null }));
    expect(Object.fromEntries(url.searchParams)).toEqual({ keep: "1", code: "c", state: "s", iss: ORIGIN });
  });

  it("names the host a code goes to", () => {
    expect(redirectHostLabel("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
    expect(redirectHostLabel("http://127.0.0.1:5000/cb")).toBe("127.0.0.1:5000");
    expect(redirectHostLabel("cursor://anysphere.cursor-retrieval/cb")).toBe("cursor://anysphere.cursor-retrieval");
  });
});

describe("metadata", () => {
  it("points the resource at this app as its authorization server", () => {
    const pr = protectedResourceMetadata(ORIGIN);
    expect(pr.resource).toBe(`${ORIGIN}/api/mcp`);
    expect(pr.authorization_servers).toEqual([ORIGIN]);
    const as = authorizationServerMetadata(ORIGIN);
    expect(as.issuer).toBe(ORIGIN);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`);
    expect(as.registration_endpoint).toBe(`${ORIGIN}/api/oauth/register`);
  });

  it("takes the MCP endpoint, or the origin, as the resource indicator", () => {
    expect(resourceMatches(null, ORIGIN)).toBe(true);
    expect(resourceMatches(`${ORIGIN}/api/mcp`, ORIGIN)).toBe(true);
    expect(resourceMatches(`${ORIGIN}/api/mcp/`, ORIGIN)).toBe(true);
    expect(resourceMatches(ORIGIN, ORIGIN)).toBe(true);
    expect(resourceMatches("https://other.example.com/api/mcp", ORIGIN)).toBe(false);
    expect(resourceMatches(`${ORIGIN}/api/campaigns`, ORIGIN)).toBe(false);
  });
});

describe("tokens", () => {
  it("are random, prefixed, and only an access token passes as one", () => {
    const a = newAccessToken();
    expect(a).not.toBe(newAccessToken());
    expect(isAccessToken(a)).toBe(true);
    expect(isAccessToken(newRefreshToken())).toBe(false);
    expect(isAccessToken("oai_abc")).toBe(false);
    expect(hashSecret(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("client metadata documents", () => {
  const id = "https://claude.ai/oauth/mcp-oauth-client-metadata";
  const doc = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ client_id: id, client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], ...over });
  const fetchReturning = (body: string, status = 200) =>
    jest.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

  it("recognises an https URL with a path as a document client id", () => {
    expect(isMetadataDocumentClientId(id)).toBe(true);
    expect(isMetadataDocumentClientId("https://claude.ai/")).toBe(false);
    expect(isMetadataDocumentClientId("http://claude.ai/meta")).toBe(false);
    expect(isMetadataDocumentClientId("https://localhost/meta")).toBe(false);
    expect(isMetadataDocumentClientId("mbo_client_abc")).toBe(false);
  });

  it("reads a document that names itself, as a public client", async () => {
    const fetchFn = fetchReturning(doc());
    const client = await fetchMetadataDocumentClient(id, fetchFn);
    expect(client).toMatchObject({ clientId: id, name: "Claude", tokenEndpointAuthMethod: "none", kind: "metadata-document" });
    expect((fetchFn as jest.Mock).mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });

  it("refuses a document for another id, without usable redirects, oversized, or unreachable", async () => {
    expect(await fetchMetadataDocumentClient(id, fetchReturning(doc({ client_id: "https://evil.example.com/meta" })))).toBeNull();
    expect(await fetchMetadataDocumentClient(id, fetchReturning(doc({ redirect_uris: ["http://evil.example.com/cb"] })))).toBeNull();
    expect(await fetchMetadataDocumentClient(id, fetchReturning(doc({ pad: "x".repeat(25_000) })))).toBeNull();
    expect(await fetchMetadataDocumentClient(id, fetchReturning("nope", 404))).toBeNull();
    expect(await fetchMetadataDocumentClient(id, fetchReturning("{not json"))).toBeNull();
  });

  it("never fetches an IP literal", async () => {
    const fetchFn = fetchReturning(doc());
    expect(await fetchMetadataDocumentClient("https://169.254.169.254/latest/meta-data", fetchFn)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("client authentication at the token endpoint", () => {
  const base: ResolvedClient = {
    clientId: "mbo_client_1",
    name: null,
    clientUri: null,
    logoUri: null,
    redirectUris: ["https://app.test/cb"],
    tokenEndpointAuthMethod: "none",
    clientSecretHash: null,
    kind: "registered",
  };

  it("reads Basic credentials first, then the form", () => {
    const basic = "Basic " + Buffer.from("id%3A1:se%20cret").toString("base64");
    expect(clientCredentialsFrom(basic, new URLSearchParams("client_id=other"))).toEqual({ clientId: "id:1", clientSecret: "se cret" });
    expect(clientCredentialsFrom(null, new URLSearchParams("client_id=a&client_secret=b"))).toEqual({ clientId: "a", clientSecret: "b" });
  });

  it("needs the registered secret only from a confidential client", () => {
    expect(clientAuthenticates(base, null)).toBe(true);
    const confidential = { ...base, tokenEndpointAuthMethod: "client_secret_post" as const, clientSecretHash: hashSecret("s3cret") };
    expect(clientAuthenticates(confidential, "s3cret")).toBe(true);
    expect(clientAuthenticates(confidential, "wrong")).toBe(false);
    expect(clientAuthenticates(confidential, null)).toBe(false);
  });

  it("falls back to the redirect host for a client with no name", () => {
    expect(clientDisplayName(base)).toBe("app.test");
    expect(clientDisplayName({ ...base, name: "Claude" })).toBe("Claude");
  });
});
