/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { GET as listConnections, DELETE as deleteConnection } from "@/app/api/portal/connections/route";
import { GET as startConnect } from "@/app/api/portal/connections/[platform]/start/route";
import { GET as oauthCallback } from "@/app/api/portal/connections/[platform]/callback/route";
import { encrypt, decrypt, isEncrypted } from "@/lib/crypto/encrypt";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn(), findFirst: jest.fn() },
    creatorSocialAccount: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));

import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";

const mockGetCreatorSession = getCreatorSession as jest.Mock;
const mockDb = db as unknown as {
  creator: { findMany: jest.Mock; findFirst: jest.Mock };
  creatorSocialAccount: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    upsert: jest.Mock;
    delete: jest.Mock;
  };
};

const authedCreatorSession = {
  id: "sess-1",
  creatorUserId: "cu-1",
  email: "creator@demo.com",
  name: "Blessing Jolie",
  handle: "blessingjolie",
};

const PROVIDER_ENV_KEYS = [
  "INSTAGRAM_CLIENT_ID",
  "INSTAGRAM_CLIENT_SECRET",
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

function makeRequest(url: string, options?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, options);
}

function makeParams(platform: string) {
  return { params: Promise.resolve({ platform }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of PROVIDER_ENV_KEYS) delete process.env[key];
  mockGetCreatorSession.mockResolvedValue(authedCreatorSession);
  mockDb.creator.findMany.mockResolvedValue([{ id: "c1", orgId: "org-1" }]);
  mockDb.creator.findFirst.mockResolvedValue({ id: "c1", orgId: "org-1" });
  mockDb.creatorSocialAccount.findMany.mockResolvedValue([]);
  mockDb.creatorSocialAccount.upsert.mockResolvedValue({ id: "sa-1" });
  mockDb.creatorSocialAccount.delete.mockResolvedValue({ id: "sa-1" });
});

describe("GET /api/portal/connections", () => {
  it("returns 401 without a portal session", async () => {
    mockGetCreatorSession.mockResolvedValue(null);
    const res = await listConnections();
    expect(res.status).toBe(401);
  });

  it("lists accounts with encrypted flag and never returns token values", async () => {
    const plaintext = "super-secret-access-token";
    const ciphertext = encrypt(plaintext, "org-1");
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([
      {
        id: "sa-1",
        platform: "INSTAGRAM",
        handle: "@blessingjolie",
        tokenExpiry: null,
        accessToken: ciphertext,
      },
    ]);
    const res = await listConnections();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0]).toMatchObject({
      id: "sa-1",
      platform: "INSTAGRAM",
      handle: "@blessingjolie",
      connected: true,
      encrypted: true,
    });
    expect(body.providers).toEqual({ instagram: false, tiktok: false, youtube: false });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(plaintext);
    expect(raw).not.toContain(ciphertext);
    expect(raw).not.toContain("accessToken");
    expect(raw).not.toContain("enc:v1");
  });

  it("reports providerConfigured per platform when credentials exist", async () => {
    process.env.TIKTOK_CLIENT_KEY = "tt-key";
    process.env.TIKTOK_CLIENT_SECRET = "tt-secret";
    const res = await listConnections();
    const body = await res.json();
    expect(body.providers.tiktok).toBe(true);
    expect(body.providers.instagram).toBe(false);
  });

  it("returns an empty list when no org-side creator matches the handle", async () => {
    mockDb.creator.findMany.mockResolvedValue([]);
    const res = await listConnections();
    const body = await res.json();
    expect(body.accounts).toEqual([]);
    expect(mockDb.creatorSocialAccount.findMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/portal/connections", () => {
  it("returns 401 without a portal session", async () => {
    mockGetCreatorSession.mockResolvedValue(null);
    const res = await deleteConnection(
      makeRequest("http://localhost:3009/api/portal/connections?id=sa-1", { method: "DELETE" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when id is missing", async () => {
    const res = await deleteConnection(
      makeRequest("http://localhost:3009/api/portal/connections", { method: "DELETE" }),
    );
    expect(res.status).toBe(400);
  });

  it("refuses to delete another creator's row", async () => {
    mockDb.creatorSocialAccount.findFirst.mockResolvedValue({
      id: "sa-2",
      creatorId: "someone-elses-creator",
    });
    const res = await deleteConnection(
      makeRequest("http://localhost:3009/api/portal/connections?id=sa-2", { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
    expect(mockDb.creatorSocialAccount.delete).not.toHaveBeenCalled();
  });

  it("deletes the session creator's own row", async () => {
    mockDb.creatorSocialAccount.findFirst.mockResolvedValue({ id: "sa-1", creatorId: "c1" });
    const res = await deleteConnection(
      makeRequest("http://localhost:3009/api/portal/connections?id=sa-1", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    expect(mockDb.creatorSocialAccount.delete).toHaveBeenCalledWith({ where: { id: "sa-1" } });
  });
});

describe("GET /api/portal/connections/[platform]/start", () => {
  it("returns 401 without a portal session", async () => {
    mockGetCreatorSession.mockResolvedValue(null);
    const res = await startConnect(
      makeRequest("http://localhost:3009/api/portal/connections/instagram/start"),
      makeParams("instagram"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for an unknown platform", async () => {
    const res = await startConnect(
      makeRequest("http://localhost:3009/api/portal/connections/myspace/start"),
      makeParams("myspace"),
    );
    expect(res.status).toBe(400);
  });

  it("dev-connect creates an encrypted row and redirects back to settings", async () => {
    const res = await startConnect(
      makeRequest("http://localhost:3009/api/portal/connections/instagram/start"),
      makeParams("instagram"),
    );
    expect([302, 303, 307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toContain("/portal/settings?connected=instagram");

    expect(mockDb.creatorSocialAccount.upsert).toHaveBeenCalledTimes(1);
    const args = mockDb.creatorSocialAccount.upsert.mock.calls[0][0];
    expect(args.where).toEqual({
      creatorId_platform: { creatorId: "c1", platform: "INSTAGRAM" },
    });
    const stored = args.create.accessToken;
    expect(isEncrypted(stored)).toBe(true);
    expect(decrypt(stored, "org-1")).toMatch(/^dev-token-instagram-\d+$/);
    expect(args.create.handle).toBe("blessingjolie");
  });

  it("redirects to the provider with a state cookie when configured", async () => {
    process.env.INSTAGRAM_CLIENT_ID = "ig-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "ig-secret";
    const res = await startConnect(
      makeRequest("http://localhost:3009/api/portal/connections/instagram/start"),
      makeParams("instagram"),
    );
    expect([302, 303, 307, 308]).toContain(res.status);
    const location = res.headers.get("location") as string;
    expect(location).toContain("facebook.com");
    expect(location).toContain("client_id=ig-id");
    expect(location).toContain("state=");
    const stateCookie = res.cookies.get("portal_oauth_state");
    expect(stateCookie?.value).toBeTruthy();
    expect(location).toContain(`state=${stateCookie?.value}`);
    expect(mockDb.creatorSocialAccount.upsert).not.toHaveBeenCalled();
  });

  it("redirects with error when no org-side creator matches", async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);
    const res = await startConnect(
      makeRequest("http://localhost:3009/api/portal/connections/tiktok/start"),
      makeParams("tiktok"),
    );
    expect(res.headers.get("location")).toContain("/portal/settings?error=tiktok");
    expect(mockDb.creatorSocialAccount.upsert).not.toHaveBeenCalled();
  });
});

describe("GET /api/portal/connections/[platform]/callback", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns 401 without a portal session", async () => {
    mockGetCreatorSession.mockResolvedValue(null);
    const res = await oauthCallback(
      makeRequest("http://localhost:3009/api/portal/connections/instagram/callback?state=s&code=c"),
      makeParams("instagram"),
    );
    expect(res.status).toBe(401);
  });

  it("rejects when the state does not match the cookie", async () => {
    global.fetch = jest.fn();
    const res = await oauthCallback(
      makeRequest(
        "http://localhost:3009/api/portal/connections/instagram/callback?state=attacker&code=c1",
        { headers: { cookie: "portal_oauth_state=legit" } },
      ),
      makeParams("instagram"),
    );
    expect(res.headers.get("location")).toContain("/portal/settings?error=instagram");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.upsert).not.toHaveBeenCalled();
  });

  it("rejects when the state cookie is missing", async () => {
    global.fetch = jest.fn();
    const res = await oauthCallback(
      makeRequest("http://localhost:3009/api/portal/connections/instagram/callback?state=s1&code=c1"),
      makeParams("instagram"),
    );
    expect(res.headers.get("location")).toContain("/portal/settings?error=instagram");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("exchanges the code and stores encrypted tokens on valid state", async () => {
    process.env.INSTAGRAM_CLIENT_ID = "ig-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "ig-secret";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "real-provider-token",
        refresh_token: "real-refresh-token",
        expires_in: 3600,
      }),
    });

    const res = await oauthCallback(
      makeRequest(
        "http://localhost:3009/api/portal/connections/instagram/callback?state=st-ok&code=code-1",
        { headers: { cookie: "portal_oauth_state=st-ok" } },
      ),
      makeParams("instagram"),
    );

    expect(res.headers.get("location")).toContain("/portal/settings?connected=instagram");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [tokenUrl, fetchInit] = (global.fetch as jest.Mock).mock.calls[0];
    expect(tokenUrl).toContain("graph.facebook.com");
    expect((fetchInit.body as URLSearchParams).get("code")).toBe("code-1");

    const args = mockDb.creatorSocialAccount.upsert.mock.calls[0][0];
    expect(isEncrypted(args.update.accessToken)).toBe(true);
    expect(decrypt(args.update.accessToken, "org-1")).toBe("real-provider-token");
    expect(isEncrypted(args.update.refreshToken)).toBe(true);
    expect(decrypt(args.update.refreshToken, "org-1")).toBe("real-refresh-token");
    expect(args.update.tokenExpiry).toBeInstanceOf(Date);
  });

  it("redirects with error when the provider is unconfigured", async () => {
    global.fetch = jest.fn();
    const res = await oauthCallback(
      makeRequest(
        "http://localhost:3009/api/portal/connections/instagram/callback?state=st-ok&code=code-1",
        { headers: { cookie: "portal_oauth_state=st-ok" } },
      ),
      makeParams("instagram"),
    );
    expect(res.headers.get("location")).toContain("/portal/settings?error=instagram");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("redirects with error when the token exchange fails", async () => {
    process.env.INSTAGRAM_CLIENT_ID = "ig-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "ig-secret";
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const res = await oauthCallback(
      makeRequest(
        "http://localhost:3009/api/portal/connections/instagram/callback?state=st-ok&code=code-1",
        { headers: { cookie: "portal_oauth_state=st-ok" } },
      ),
      makeParams("instagram"),
    );
    expect(res.headers.get("location")).toContain("/portal/settings?error=instagram");
    expect(mockDb.creatorSocialAccount.upsert).not.toHaveBeenCalled();
  });
});
