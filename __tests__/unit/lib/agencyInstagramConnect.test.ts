/**
 * @jest-environment node
 *
 * Settings → Integrations → connect the org's own Instagram account. The
 * callback spends the code only for an owner or admin of the org the consent
 * was started in, and stores the first Page that has an Instagram account;
 * Graph is faked at fetch, so the exchange, the long-lived swap and the Page
 * listing all run through the real client.
 */
import { randomBytes } from "crypto";

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

const mockAuth = jest.fn();
jest.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => mockAuth(...args) }));

const mockAudit = jest.fn();
jest.mock("@/lib/audit", () => ({
  logAudit: (...args: unknown[]) => mockAudit(...args),
  createAuditActor: () => ({ actorType: "user" }),
}));

const mockGetOperator = jest.fn();
jest.mock("@/lib/platforms/instagramBusinessToken", () => ({
  ...jest.requireActual("@/lib/platforms/instagramBusinessToken"),
  getInstagramBusinessToken: (...args: unknown[]) => mockGetOperator(...args),
}));

const mockUpsert = jest.fn();
const mockFindMany = jest.fn();
const mockAccountStateCount = jest.fn();
const mockSocialCount = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    platformCredential: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
    creatorAccountState: { count: (...args: unknown[]) => mockAccountStateCount(...args) },
    creatorSocialAccount: { count: (...args: unknown[]) => mockSocialCount(...args) },
  },
}));

import { NextRequest } from "next/server";
import { GET as callback } from "@/app/api/settings/integrations/instagram/callback/route";
import { GET as start } from "@/app/api/settings/integrations/instagram/start/route";
import { AGENCY_IG_STATE_COOKIE, revokeAgencyGrantIfUnshared } from "@/lib/platforms/instagramAgencyConnect";
import { agencyProvider, parseAgencyMeta } from "@/lib/platforms/instagramAgencyCredential";
import { decrypt } from "@/lib/crypto/encrypt";

const ORG = "org-agency";
const BASE = "http://localhost:3013";

type Seen = { method: string; path: string; params: URLSearchParams };

function fakeGraph({ pages }: { pages: unknown[] }) {
  const seen: Seen[] = [];
  global.fetch = jest.fn(async (input: string, init?: { method?: string; body?: URLSearchParams }) => {
    const u = new URL(input);
    const method = init?.method ?? "GET";
    const params = method === "POST" && init?.body ? new URLSearchParams(init.body) : u.searchParams;
    seen.push({ method, path: u.pathname, params });
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });
    if (u.pathname === "/v26.0/oauth/access_token" && method === "POST") {
      return ok({ access_token: "short-lived", token_type: "bearer", expires_in: 5400 });
    }
    if (u.pathname === "/v26.0/oauth/access_token") return ok({ access_token: "long-lived", expires_in: 5_184_000 });
    if (u.pathname === "/v26.0/me/accounts") return ok({ data: pages });
    if (u.pathname === "/v26.0/me") return ok({ id: u.searchParams.get("access_token") === "operator" ? "fb-op" : "fb-1" });
    if (method === "DELETE") return ok({ success: true });
    return { ok: false, status: 500, json: async () => ({}), headers: { get: () => null } };
  }) as unknown as typeof fetch;
  return seen;
}

function session(role: string, orgId = ORG) {
  return { user: { id: "u1", email: "admin@example.test", role, orgId } };
}

function callbackRequest(query: string, cookie?: string) {
  return new NextRequest(`${BASE}/api/settings/integrations/instagram/callback?${query}`, {
    headers: cookie ? { cookie: `${AGENCY_IG_STATE_COOKIE}=${cookie}` } : {},
  });
}

const PAGES = [
  { id: "page-without-ig", name: "Plain Page" },
  {
    id: "page-1",
    name: "Agency Page",
    instagram_business_account: { id: "17840000000000001", username: "agency.account", followers_count: 1200 },
  },
];

const realFetch = global.fetch;

beforeEach(() => {
  process.env.INSTAGRAM_CLIENT_ID = "app-id";
  process.env.INSTAGRAM_CLIENT_SECRET = "app-secret";
  process.env.APP_URL = BASE;
  mockAuth.mockReset();
  mockAudit.mockReset().mockResolvedValue(undefined);
  mockUpsert.mockReset().mockResolvedValue({});
  mockFindMany.mockReset().mockResolvedValue([]);
  mockAccountStateCount.mockReset().mockResolvedValue(0);
  mockSocialCount.mockReset().mockResolvedValue(0);
  mockGetOperator.mockReset().mockResolvedValue("operator");
});
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.APP_URL;
});

describe("start", () => {
  it("sends an admin to Facebook Login with the four scopes and this route's callback", async () => {
    mockAuth.mockResolvedValue(session("ADMIN"));
    const res = await start(new NextRequest(`${BASE}/api/settings/integrations/instagram/start`));

    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location")!);
    expect(`${to.origin}${to.pathname}`).toBe("https://www.facebook.com/v26.0/dialog/oauth");
    expect(to.searchParams.get("client_id")).toBe("app-id");
    expect(to.searchParams.get("scope")).toBe(
      "instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement",
    );
    expect(to.searchParams.get("redirect_uri")).toBe(`${BASE}/api/settings/integrations/instagram/callback`);
    const state = to.searchParams.get("state");
    expect(res.cookies.get(AGENCY_IG_STATE_COOKIE)?.value).toBe(`${state}.${ORG}`);
  });

  it("sends a member back to settings without starting a consent", async () => {
    mockAuth.mockResolvedValue(session("MEMBER"));
    const res = await start(new NextRequest(`${BASE}/api/settings/integrations/instagram/start`));
    expect(res.headers.get("location")).toBe(`${BASE}/settings/integrations?instagram=error&reason=forbidden`);
    expect(res.cookies.get(AGENCY_IG_STATE_COOKIE)).toBeUndefined();
  });
});

describe("callback role gate", () => {
  it.each(["MEMBER", "VIEWER", "MANAGER"])("refuses a %s before the code is spent", async (role) => {
    mockAuth.mockResolvedValue(session(role));
    const seen = fakeGraph({ pages: PAGES });

    const res = await callback(callbackRequest("code=c&state=s", `s.${ORG}`));

    expect(res.headers.get("location")).toBe(`${BASE}/settings/integrations?instagram=error&reason=forbidden`);
    expect(seen).toEqual([]);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("sends a signed-out browser to the login page", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await callback(callbackRequest("code=c&state=s", `s.${ORG}`));
    expect(res.headers.get("location")).toBe(`${BASE}/login`);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("refuses a consent started in another org", async () => {
    mockAuth.mockResolvedValue(session("OWNER"));
    const seen = fakeGraph({ pages: PAGES });

    const res = await callback(callbackRequest("code=c&state=s", "s.org-other"));

    expect(res.headers.get("location")).toContain("reason=state");
    expect(seen).toEqual([]);
  });

  it("refuses a state the browser did not start", async () => {
    mockAuth.mockResolvedValue(session("OWNER"));
    fakeGraph({ pages: PAGES });
    const res = await callback(callbackRequest("code=c&state=forged", `s.${ORG}`));
    expect(res.headers.get("location")).toContain("reason=state");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("says the consent was cancelled when Facebook says so", async () => {
    mockAuth.mockResolvedValue(session("OWNER"));
    const res = await callback(callbackRequest("error=access_denied&state=s", `s.${ORG}`));
    expect(res.headers.get("location")).toContain("reason=denied");
  });
});

describe("callback for an owner or admin", () => {
  it.each(["OWNER", "ADMIN"])("%s: exchanges, goes long-lived, and stores the first Page with an Instagram account", async (role) => {
    mockAuth.mockResolvedValue(session(role));
    const seen = fakeGraph({ pages: PAGES });

    const res = await callback(callbackRequest("code=the-code&state=s", `s.${ORG}`));

    expect(res.headers.get("location")).toBe(`${BASE}/settings/integrations?instagram=connected`);
    const exchange = seen.find((s) => s.method === "POST")!;
    expect(exchange.params.get("code")).toBe("the-code");
    expect(exchange.params.get("redirect_uri")).toBe(`${BASE}/api/settings/integrations/instagram/callback`);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const { where, create } = mockUpsert.mock.calls[0][0];
    expect(where).toEqual({ provider: agencyProvider(ORG) });
    expect(decrypt(create.accessToken, agencyProvider(ORG))).toBe("long-lived");
    expect(parseAgencyMeta(create.source)).toEqual({
      via: "oauth",
      igUserId: "17840000000000001",
      username: "agency.account",
      pageId: "page-1",
      fbUserId: "fb-1",
    });
    expect(create.expiresAt.getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
    expect(mockAudit).toHaveBeenCalledTimes(1);
  });

  it("stores nothing when no Page the user shared has an Instagram account", async () => {
    mockAuth.mockResolvedValue(session("OWNER"));
    fakeGraph({ pages: [{ id: "page-without-ig", name: "Plain Page" }] });

    const res = await callback(callbackRequest("code=c&state=s", `s.${ORG}`));

    expect(res.headers.get("location")).toContain("reason=no_instagram_account");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("says Facebook shared no Page when the grant reaches none", async () => {
    mockAuth.mockResolvedValue(session("OWNER"));
    fakeGraph({ pages: [] });

    const res = await callback(callbackRequest("code=c&state=s", `s.${ORG}`));

    expect(res.headers.get("location")).toContain("reason=no_page");
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("disconnect's revoke", () => {
  const account = { igUserId: "17840000000000001", username: "agency.account", pageId: "page-1", fbUserId: "fb-1" };

  it("revokes when nothing else here was granted by that Facebook user", async () => {
    const seen = fakeGraph({ pages: [] });
    expect(await revokeAgencyGrantIfUnshared(ORG, "agency-token", account, {})).toBe("revoked");
    expect(seen.filter((s) => s.method === "DELETE").map((s) => s.path)).toEqual(["/v26.0/me/permissions"]);
  });

  it("leaves the grant alone when the operator token was granted by the same user", async () => {
    const seen = fakeGraph({ pages: [] });
    expect(
      await revokeAgencyGrantIfUnshared(ORG, "agency-token", { ...account, fbUserId: "fb-op" }, {}),
    ).toBe("shared-grant");
    expect(seen.some((s) => s.method === "DELETE")).toBe(false);
  });

  it("leaves the grant alone when another org or a creator connection shares it", async () => {
    const seen = fakeGraph({ pages: [] });
    mockAccountStateCount.mockResolvedValue(1);
    expect(await revokeAgencyGrantIfUnshared(ORG, "agency-token", account, {})).toBe("shared-grant");
    mockAccountStateCount.mockResolvedValue(0);
    mockFindMany.mockResolvedValue([{ source: JSON.stringify({ ...account, via: "oauth" }) }]);
    expect(await revokeAgencyGrantIfUnshared(ORG, "agency-token", account, {})).toBe("shared-grant");
    expect(seen.some((s) => s.method === "DELETE")).toBe(false);
  });

  it("leaves the grant alone when the granting user is unknown", async () => {
    const seen = fakeGraph({ pages: [] });
    expect(await revokeAgencyGrantIfUnshared(ORG, "agency-token", { ...account, fbUserId: null }, {})).toBe(
      "unknown-grantor",
    );
    expect(seen.some((s) => s.method === "DELETE")).toBe(false);
  });
});
