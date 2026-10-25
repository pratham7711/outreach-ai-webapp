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
import { OAUTH_PLATFORMS } from "@/lib/oauth/providers";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
    creatorSocialAccount: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  },
}));

jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));
jest.mock("@/lib/platforms/accountState", () => ({
  ...jest.requireActual("@/lib/platforms/accountState"),
  accountStatesFor: jest.fn(),
  accountIdsForGrantor: jest.fn(),
}));
jest.mock("@/lib/platforms/instagramAgencyCredential", () => ({
  ...jest.requireActual("@/lib/platforms/instagramAgencyCredential"),
  otherAgencyGrantors: jest.fn(),
}));
jest.mock("@/lib/platforms/instagramBusinessToken", () => ({
  ...jest.requireActual("@/lib/platforms/instagramBusinessToken"),
  getInstagramBusinessToken: jest.fn(),
}));

import { db } from "@/lib/db";

/* Answers creator.findMany the way the database would: the ownership check
   (lib/portal/creatorLink.ts) asks only for rows naming the portal login, and
   gets only those; every other query gets the rows as given. */
function roster(rows: any[]) {
  (db as any).creator.findMany.mockImplementation((args: any) =>
    Promise.resolve(
      args?.where && "creatorUserId" in args.where
        ? rows
            .filter((r) => r.deletedAt == null && r.creatorUserId === args.where.creatorUserId)
            .map(({ id, orgId }) => ({ id, orgId }))
        : rows,
    ),
  );
}
import { getCreatorSession } from "@/lib/creator-auth";
import { accountIdsForGrantor, accountStatesFor } from "@/lib/platforms/accountState";
import { otherAgencyGrantors } from "@/lib/platforms/instagramAgencyCredential";
import { getInstagramBusinessToken } from "@/lib/platforms/instagramBusinessToken";

const mockGetCreatorSession = getCreatorSession as jest.Mock;
const mockDb = db as unknown as {
  creator: { findMany: jest.Mock; findFirst: jest.Mock; updateMany: jest.Mock };
  creatorSocialAccount: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    upsert: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
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
  /* c1 names this portal account as its creator, so it is a LINKED row — proven ownership.
     A bare handle match no longer reaches any of this; see
     lib/portal/creatorLink.ts. */
  roster([
    { id: "c1", orgId: "org-1", creatorUserId: "cu-1" },
  ]);
  mockDb.creator.findFirst.mockResolvedValue({ id: "c1", orgId: "org-1" });
  mockDb.creatorSocialAccount.findMany.mockResolvedValue([]);
  /* No row yet: the callback reads the stored follower figure so a rounded
     platform cannot overwrite an exact one, and a first connection has none. */
  mockDb.creatorSocialAccount.findUnique.mockResolvedValue(null);
  mockDb.creatorSocialAccount.upsert.mockResolvedValue({ id: "sa-1" });
  mockDb.creatorSocialAccount.delete.mockResolvedValue({ id: "sa-1" });
  mockDb.creatorSocialAccount.count.mockResolvedValue(0);
  (accountStatesFor as jest.Mock).mockResolvedValue(new Map([["sa-fb", { grantorUserId: "fb-user-1" }]]));
  (accountIdsForGrantor as jest.Mock).mockResolvedValue(["sa-fb"]);
  (otherAgencyGrantors as jest.Mock).mockResolvedValue(new Set());
  (getInstagramBusinessToken as jest.Mock).mockResolvedValue(null);
  delete process.env.INSTAGRAM_BD_TOKEN_B;
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
    /* Derived, not listed: the payload is built from OAUTH_PLATFORMS, so a
       hand-written literal here would have to be edited every time a provider
       is added and would fail for a reason unrelated to what this test checks. */
    expect(Object.keys(body.providers).sort()).toEqual([...OAUTH_PLATFORMS].sort());
    expect(Object.values(body.providers).every((v) => v === false)).toBe(true);
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
    roster([]);
    const res = await listConnections();
    const body = await res.json();
    expect(body.accounts).toEqual([]);
    expect(mockDb.creatorSocialAccount.findMany).not.toHaveBeenCalled();
  });

  it("reports canConnect from the roster lookup the start route refuses on", async () => {
    expect((await (await listConnections()).json()).canConnect).toBe(true);

    mockDb.creator.findFirst.mockResolvedValue(null);
    expect((await (await listConnections()).json()).canConnect).toBe(false);
    const start = await startConnect(
      makeRequest("http://localhost/api/portal/connections/tiktok/start"),
      makeParams("tiktok"),
    );
    expect(start.headers.get("location")).toContain("reason=creator");
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

  it("revokes at Meta when the Facebook row is the creator's last Meta connection", async () => {
    mockDb.creatorSocialAccount.findFirst.mockResolvedValue({
      id: "sa-fb",
      creatorId: "c1",
      platform: "FACEBOOK",
      accessToken: encrypt("fb-user-token", "org-1"),
    });
    mockDb.creatorSocialAccount.count.mockResolvedValue(0);
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    global.fetch = fetchMock;
    const res = await deleteConnection(
      makeRequest("http://localhost:3009/api/portal/connections?id=sa-fb", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/me/permissions");
    expect(mockDb.creatorSocialAccount.delete).toHaveBeenCalledWith({ where: { id: "sa-fb" } });
  });

  it("does NOT revoke at Meta while an Instagram row shares the grant, so that token survives", async () => {
    // Measured on prod 2026-09-07: DELETE /me/permissions for the Facebook row
    // invalidated the Instagram token (Graph code 190) because both rows are one
    // Meta user grant. The row still goes; only the Graph revoke is deferred.
    mockDb.creatorSocialAccount.findFirst.mockResolvedValue({
      id: "sa-fb",
      creatorId: "c1",
      platform: "FACEBOOK",
      accessToken: encrypt("fb-user-token", "org-1"),
    });
    mockDb.creatorSocialAccount.count.mockResolvedValue(1);
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const res = await deleteConnection(
      makeRequest("http://localhost:3009/api/portal/connections?id=sa-fb", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.count).toHaveBeenCalledWith({
      where: {
        creatorId: "c1",
        platform: { in: ["INSTAGRAM", "FACEBOOK"] },
        id: { not: "sa-fb" },
        /* An Instagram-Login row carries platform INSTAGRAM but was minted by
           a different app id and has no me/permissions endpoint, so it is not
           part of this Facebook grant. Counting it as a sibling would suppress
           the real revoke and leave the grant standing at Meta after the
           creator disconnected their last Page -- the opposite of what
           disconnect means. Rows predating the origin column are null and
           still count. */
        OR: [{ origin: null }, { origin: { not: "oauth_instagram_login" } }],
      },
    });
    expect(mockDb.creatorSocialAccount.delete).toHaveBeenCalledWith({ where: { id: "sa-fb" } });
  });

  describe("last Meta row, grant held elsewhere", () => {
    /* DELETE /me/permissions ends everything that Facebook user gave the app,
       not just this creator's rows. Each case below is a token some other
       reader depends on; the row still goes, the grant at Meta stays. */
    function lastFacebookRow() {
      mockDb.creatorSocialAccount.findFirst.mockResolvedValue({
        id: "sa-fb",
        creatorId: "c1",
        platform: "FACEBOOK",
        accessToken: encrypt("fb-user-token", "org-1"),
      });
    }
    function graph(meId: string | null) {
      const fetchMock = jest.fn(async (url: string | URL) =>
        String(url).includes("/me/permissions")
          ? { ok: true, json: async () => ({ success: true }) }
          : meId
            ? { ok: true, json: async () => ({ id: meId }) }
            : { ok: false, status: 400, json: async () => ({ error: { code: 190 } }) },
      );
      global.fetch = fetchMock as unknown as typeof fetch;
      return fetchMock;
    }
    const revoked = (f: jest.Mock) => f.mock.calls.some(([u]) => String(u).includes("/me/permissions"));
    async function disconnect() {
      const res = await deleteConnection(
        makeRequest("http://localhost:3009/api/portal/connections?id=sa-fb", { method: "DELETE" }),
      );
      expect(res.status).toBe(200);
      expect(mockDb.creatorSocialAccount.delete).toHaveBeenCalledWith({ where: { id: "sa-fb" } });
    }

    it("does not revoke when the same user granted the platform's Business Discovery token", async () => {
      lastFacebookRow();
      (getInstagramBusinessToken as jest.Mock).mockResolvedValue("operator-token");
      const fetchMock = graph("fb-user-1");
      await disconnect();
      expect(revoked(fetchMock)).toBe(false);
    });

    it("does not revoke when the same user's grant backs the standby token B", async () => {
      lastFacebookRow();
      process.env.INSTAGRAM_BD_TOKEN_B = "standby-token";
      const fetchMock = graph("fb-user-1");
      await disconnect();
      expect(revoked(fetchMock)).toBe(false);
    });

    it("revokes when the platform token was granted by someone else", async () => {
      lastFacebookRow();
      (getInstagramBusinessToken as jest.Mock).mockResolvedValue("operator-token");
      const fetchMock = graph("someone-else");
      await disconnect();
      expect(revoked(fetchMock)).toBe(true);
    });

    it("does not revoke when the same user holds an agency's Instagram credential", async () => {
      lastFacebookRow();
      (otherAgencyGrantors as jest.Mock).mockResolvedValue(new Set(["fb-user-1"]));
      const fetchMock = graph(null);
      await disconnect();
      expect(revoked(fetchMock)).toBe(false);
    });

    it("does not revoke while the same user's connection on another creator record is live", async () => {
      lastFacebookRow();
      (accountIdsForGrantor as jest.Mock).mockResolvedValue(["sa-fb", "sa-elsewhere"]);
      mockDb.creatorSocialAccount.count.mockImplementation(async ({ where }) => ("creatorId" in where ? 0 : 1));
      const fetchMock = graph(null);
      await disconnect();
      expect(mockDb.creatorSocialAccount.count).toHaveBeenLastCalledWith({ where: { id: { in: ["sa-elsewhere"] } } });
      expect(revoked(fetchMock)).toBe(false);
    });

    it("revokes when that other connection is already gone", async () => {
      lastFacebookRow();
      (accountIdsForGrantor as jest.Mock).mockResolvedValue(["sa-fb", "sa-deleted"]);
      mockDb.creatorSocialAccount.count.mockResolvedValue(0);
      const fetchMock = graph(null);
      await disconnect();
      expect(revoked(fetchMock)).toBe(true);
    });

    it("leaves the grant when the granting user cannot be established", async () => {
      lastFacebookRow();
      (accountStatesFor as jest.Mock).mockResolvedValue(new Map());
      const fetchMock = graph(null);
      await disconnect();
      expect(revoked(fetchMock)).toBe(false);
    });

    it("reads the grantor from Facebook when none was recorded, and revokes when it is unshared", async () => {
      lastFacebookRow();
      (accountStatesFor as jest.Mock).mockResolvedValue(new Map());
      const fetchMock = graph("fb-user-1");
      await disconnect();
      expect(revoked(fetchMock)).toBe(true);
    });
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
    // Keyed on the platform account, so a creator can link several accounts on
    // one platform. Dev connections have no real account id, so they get a
    // stable synthetic one instead of colliding or duplicating.
    expect(args.where).toEqual({
      creatorId_platform_platformUserId: {
        creatorId: "c1",
        platform: "INSTAGRAM",
        platformUserId: "dev-instagram-c1",
      },
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

  it("refuses a coming-soon platform before touching any creator row", async () => {
    /* The guard is what matters, not which platform trips it: a platform we
       cannot actually call must not fall through to the dev connect path and
       mint a token for it.

       TikTok used to be coming_soon by code default and was the natural
       subject here. It is now "auto" -- live wherever its client key and
       secret are set -- because coming_soon is the one status that removes the
       Connect card entirely, which left the four Login Kit scopes with no
       screen to demonstrate them on. So the status is forced through the
       PLATFORM_CONNECT_STATUS override instead, which is the same path an
       environment would use to pull a platform back. */
    const savedOverride = process.env.PLATFORM_CONNECT_STATUS;
    process.env.PLATFORM_CONNECT_STATUS = "tiktok:coming_soon";
    try {
      const res = await startConnect(
        makeRequest("http://localhost:3009/api/portal/connections/tiktok/start"),
        makeParams("tiktok"),
      );
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe("coming_soon");
      expect(mockDb.creator.findFirst).not.toHaveBeenCalled();
      expect(mockDb.creatorSocialAccount.upsert).not.toHaveBeenCalled();
    } finally {
      if (savedOverride === undefined) delete process.env.PLATFORM_CONNECT_STATUS;
      else process.env.PLATFORM_CONNECT_STATUS = savedOverride;
    }
  });

  it("starts for a row linked to this portal account even when its handle differs", async () => {
    /* An agency invite sets creatorUserId on the row but never its handle, so
       a creator who registered under another handle has no handle match at
       all. The row that names this account is still theirs. */
    process.env.GOOGLE_CLIENT_ID = "g-id";
    process.env.GOOGLE_CLIENT_SECRET = "g-secret";
    mockDb.creator.findFirst.mockImplementation(async ({ where }) =>
      where.creatorUserId === "cu-1" ? { id: "c-invited", orgId: "org-2", creatorUserId: "cu-1" } : null,
    );
    const res = await startConnect(
      makeRequest("http://localhost:3009/api/portal/connections/youtube/start"),
      makeParams("youtube"),
    );
    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain("reason=creator");
    expect(location).toContain("accounts.google.com");
  });

  it("redirects with error when no org-side creator matches", async () => {
    // youtube rather than tiktok: the test above forces tiktok to coming_soon
    // and refuses it before the creator lookup this asserts on.
    mockDb.creator.findFirst.mockResolvedValue(null);
    const res = await startConnect(
      makeRequest("http://localhost:3009/api/portal/connections/youtube/start"),
      makeParams("youtube"),
    );
    expect(res.headers.get("location")).toContain("/portal/settings?error=youtube");
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
    expect(res.headers.get("location")).toContain("/portal/settings?error=instagram&reason=state");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.upsert).not.toHaveBeenCalled();
  });

  it("rejects when the state cookie is missing", async () => {
    global.fetch = jest.fn();
    const res = await oauthCallback(
      makeRequest("http://localhost:3009/api/portal/connections/instagram/callback?state=s1&code=c1"),
      makeParams("instagram"),
    );
    expect(res.headers.get("location")).toContain("/portal/settings?error=instagram&reason=state");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("exchanges the code and stores encrypted tokens on valid state", async () => {
    process.env.INSTAGRAM_CLIENT_ID = "ig-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "ig-secret";
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "real-provider-token",
          refresh_token: "real-refresh-token",
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "long-lived-token", expires_in: 60 * 24 * 3600 }),
      })
      // The identity call. Every platform now resolves who the connected
      // account actually is; Instagram rows used to be stored under the
      // creator's PORTAL username, so the settings screen named the wrong
      // account. See lib/platforms/accountSync.ts.
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              instagram_business_account: {
                id: "ig-17841400000000000",
                username: "realhandle",
                name: "Real Handle",
                biography: "bio text",
                profile_picture_url: "https://cdn.example/avatar.jpg",
                followers_count: 4321,
                follows_count: 120,
              },
            },
          ],
        }),
      })
      // media_count, read from the IG User on its own: nested in me/accounts it
      // pushed the identity read past Graph's 5s deadline (measured 2026-10-25).
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "ig-17841400000000000", media_count: 88 }),
      });

    const res = await oauthCallback(
      makeRequest(
        "http://localhost:3009/api/portal/connections/instagram/callback?state=st-ok&code=code-1",
        { headers: { cookie: "portal_oauth_state=st-ok" } },
      ),
      makeParams("instagram"),
    );

    expect(res.headers.get("location")).toContain("/portal/settings?connected=instagram");
    // Four calls: the code exchange, the trade for a long-lived token, the
    // identity read, then the post count. The short-lived token lasts about an
    // hour and Facebook issues no refresh_token, so storing the first one would
    // leave the connection dead by the next cron run.
    expect(global.fetch).toHaveBeenCalledTimes(4);
    const [tokenUrl, fetchInit] = (global.fetch as jest.Mock).mock.calls[0];
    expect(tokenUrl).toContain("graph.facebook.com");
    expect((fetchInit.body as URLSearchParams).get("code")).toBe("code-1");

    const [exchangeUrl] = (global.fetch as jest.Mock).mock.calls[1];
    expect(String(exchangeUrl)).toContain("grant_type=fb_exchange_token");
    expect(String(exchangeUrl)).toContain("fb_exchange_token=real-provider-token");

    const args = mockDb.creatorSocialAccount.upsert.mock.calls[0][0];
    expect(isEncrypted(args.update.accessToken)).toBe(true);
    expect(decrypt(args.update.accessToken, "org-1")).toBe("long-lived-token");
    expect(isEncrypted(args.update.refreshToken)).toBe(true);
    expect(decrypt(args.update.refreshToken, "org-1")).toBe("real-refresh-token");
    // ~60 days out, not ~1 hour.
    const expiry = args.update.tokenExpiry as Date;
    expect(expiry).toBeInstanceOf(Date);
    expect(expiry.getTime() - Date.now()).toBeGreaterThan(30 * 24 * 3600 * 1000);

    // The identity read went out on the creator's own token, and what came
    // back landed on the account row rather than on the shared Creator row.
    const [identityUrl] = (global.fetch as jest.Mock).mock.calls[2];
    expect(String(identityUrl)).toContain("me/accounts");
    expect(String(identityUrl)).toContain("instagram_business_account");
    expect(new URL(String(identityUrl)).searchParams.get("fields")).not.toContain("media_count");
    const [countUrl] = (global.fetch as jest.Mock).mock.calls[3];
    expect(new URL(String(countUrl)).pathname).toMatch(/\/ig-17841400000000000$/);
    expect(new URL(String(countUrl)).searchParams.get("fields")).toBe("media_count");

    // The identity is resolved BEFORE the write, because platformUserId is part
    // of the account's unique key — that is what lets a creator link a second
    // account on the same platform instead of overwriting the first.
    expect(args.where).toEqual({
      creatorId_platform_platformUserId: {
        creatorId: "c1",
        platform: "INSTAGRAM",
        platformUserId: "ig-17841400000000000",
      },
    });
    expect(args.update.handle).toBe("realhandle");
    expect(args.update.platformUserId).toBe("ig-17841400000000000");
    expect(args.update.followersCount).toBe(4321);
    expect(args.update.mediaCount).toBe(88);
    // Instagram publishes no lifetime like total, so it must stay null rather
    // than be summed from a sample and presented as a career figure.
    expect(args.update.totalLikes).toBeNull();
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
    expect(res.headers.get("location")).toContain("/portal/settings?error=instagram&reason=provider");
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
    expect(res.headers.get("location")).toContain("/portal/settings?error=instagram&reason=token_exchange");
    expect(mockDb.creatorSocialAccount.upsert).not.toHaveBeenCalled();
  });
});

/* The highest-severity hole in the portal: /api/portal/auth/register checks the
   handle against CreatorUser only, and everything here bridged to the org-side
   roster by handle alone. Registering as an existing roster creator therefore
   listed that creator's connected accounts and — worse — let the new account
   REVOKE their grants at TikTok, Meta and Google, the one action here that
   reaches outside our database and cannot be undone from our side.
   lib/portal/creatorLink.ts is the gate; these are its edges. */
describe("portal connections — ownership of the roster row", () => {
  /** A handle match that names some other portal account: no proof. */
  const unproven = () => {
    roster([
      { id: "c1", orgId: "org-1", creatorUserId: "cu-someone-else" },
    ]);
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([]);
  };

  it("lists nothing for a bare handle match", async () => {
    unproven();
    const res = await listConnections();
    expect((await res.json()).accounts).toEqual([]);
    // No linked row, so no account is ever read.
    expect(mockDb.creatorSocialAccount.findMany).not.toHaveBeenCalled();
  });

  it("refuses to revoke a connection on a row it has not proven it owns", async () => {
    unproven();
    mockDb.creatorSocialAccount.findFirst.mockResolvedValue({
      id: "acc-1",
      creatorId: "c1",
      platform: "TIKTOK",
      accessToken: encrypt("tok", "org-1"),
    });

    const res = await deleteConnection(
      makeRequest("http://localhost:3009/api/portal/connections?id=acc-1", { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
    expect(mockDb.creatorSocialAccount.delete).not.toHaveBeenCalled();
  });

  it("refuses to revoke on a stored connection under this handle alone", async () => {
    /* The takeover: the creator connected through the agency's connect link
       and never registered, so the row names no login; whoever registered the
       handle first must not be able to revoke the creator's grant. */
    roster([
      { id: "c1", orgId: "org-1", creatorUserId: null },
    ]);
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([
      { creatorId: "c1", handle: "@BlessingJolie" },
    ]);
    mockDb.creatorSocialAccount.findFirst.mockResolvedValue({
      id: "acc-1",
      creatorId: "c1",
      platform: "TIKTOK",
      accessToken: encrypt("tok", "org-1"),
    });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

    const res = await deleteConnection(
      makeRequest("http://localhost:3009/api/portal/connections?id=acc-1", { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
    expect(mockDb.creatorSocialAccount.delete).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

/* Where a freshly minted token is allowed to land. findCreatorForHandle matches
   on the handle alone, so without this guard an account that registered an
   existing roster creator's handle could staple its OWN OAuth token onto that
   creator's row. The first connection still has a way in: the identity the
   provider returns is the handle of the account that actually authorised, so
   "this account IS this handle" is itself the proof. */
describe("GET /api/portal/connections/[platform]/callback — where the token may land", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const runCallback = (identityUsername: string) => {
    process.env.INSTAGRAM_CLIENT_ID = "ig-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "ig-secret";
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "t", expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "ll", expires_in: 5_184_000 }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              instagram_business_account: {
                id: "ig-1",
                username: identityUsername,
                followers_count: 1,
                follows_count: 1,
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "ig-1", media_count: 1 }) });
    return oauthCallback(
      makeRequest(
        "http://localhost:3009/api/portal/connections/instagram/callback?state=st-ok&code=code-1",
        { headers: { cookie: "portal_oauth_state=st-ok" } },
      ),
      makeParams("instagram"),
    );
  };

  beforeEach(() => {
    // A bare handle match that names some other portal account.
    roster([
      { id: "c1", orgId: "org-1", creatorUserId: "cu-someone-else" },
    ]);
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([]);
    mockDb.creatorSocialAccount.upsert.mockResolvedValue({ id: "acc-1" });
  });

  it("refuses to attach somebody else's account to an unproven roster row", async () => {
    const res = await runCallback("some_other_account");
    expect(res.headers.get("location")).toContain("error=instagram&reason=creator");
    expect(mockDb.creatorSocialAccount.upsert).not.toHaveBeenCalled();
  });

  it("attaches when the authorised account IS this handle, establishing the link", async () => {
    const res = await runCallback("BlessingJolie");
    expect(res.headers.get("location")).toContain("connected=instagram");
    expect(mockDb.creatorSocialAccount.upsert).toHaveBeenCalled();
    /* The link is written onto the roster row, because the stored connection
       cannot say later which login made it. */
    expect(mockDb.creator.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", orgId: "org-1", creatorUserId: null },
      data: { creatorUserId: "cu-1" },
    });
  });

  it("does not link the row when the authorised account is somebody else's", async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: "c1", orgId: "org-1", creatorUserId: "cu-1" });
    const res = await runCallback("a_different_instagram_name");
    expect(res.headers.get("location")).toContain("connected=instagram");
    expect(mockDb.creator.updateMany).not.toHaveBeenCalled();
  });

  it("attaches to the row that names this portal account, whatever handle either carries", async () => {
    mockDb.creator.findFirst.mockImplementation(async ({ where }) =>
      where.creatorUserId === "cu-1" ? { id: "c-invited", orgId: "org-2", creatorUserId: "cu-1" } : null,
    );
    const res = await runCallback("a_different_instagram_name");
    expect(res.headers.get("location")).toContain("connected=instagram");
    expect(mockDb.creatorSocialAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          creatorId_platform_platformUserId: expect.objectContaining({ creatorId: "c-invited" }),
        }),
      }),
    );
  });

  it("still refuses a handle-matched row that names a different portal account", async () => {
    mockDb.creator.findFirst.mockImplementation(async ({ where }) =>
      where.creatorUserId ? null : { id: "c1", orgId: "org-1", creatorUserId: "cu-someone-else" },
    );
    const res = await runCallback("some_other_account");
    expect(res.headers.get("location")).toContain("error=instagram&reason=creator");
    expect(mockDb.creatorSocialAccount.upsert).not.toHaveBeenCalled();
  });
});
