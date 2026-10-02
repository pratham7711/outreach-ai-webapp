/**
 * @jest-environment node
 *
 * The connect link's OAuth round trip: /connect/<token> → start?connect= →
 * consent → callback. No portal login anywhere, and the row the connection
 * lands on is the one the agency bound the link to — orgId and id from the
 * token row, never a handle lookup.
 */
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { GET as startConnect } from "@/app/api/portal/connections/[platform]/start/route";
import { GET as oauthCallback } from "@/app/api/portal/connections/[platform]/callback/route";
import { decrypt } from "@/lib/crypto/encrypt";
import { connectState, hashConnectToken, newConnectToken } from "@/lib/creators/connectToken";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findFirst: jest.fn(), findMany: jest.fn() },
    creatorSocialAccount: { findUnique: jest.fn(), upsert: jest.fn() },
    creatorConnectToken: { findUnique: jest.fn(), update: jest.fn() },
  },
}));
jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));
jest.mock("@/lib/creators/connectTables", () => ({ connectTablesReady: jest.fn() }));
jest.mock("@/lib/platforms/accountState", () => ({ recordConnectionState: jest.fn() }));
jest.mock("@/lib/portal/creatorLookup", () => ({ findCreatorForHandle: jest.fn() }));
jest.mock("@/lib/portal/creatorLink", () => ({ findLinkedCreatorsForHandle: jest.fn() }));

import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { connectTablesReady } from "@/lib/creators/connectTables";
import { recordConnectionState } from "@/lib/platforms/accountState";
import { findCreatorForHandle } from "@/lib/portal/creatorLookup";

const mockDb = db as unknown as {
  creator: { findFirst: jest.Mock; findMany: jest.Mock };
  creatorSocialAccount: { findUnique: jest.Mock; upsert: jest.Mock };
  creatorConnectToken: { findUnique: jest.Mock; update: jest.Mock };
};
const mockSession = getCreatorSession as jest.Mock;
const mockReady = connectTablesReady as jest.Mock;
const mockRecord = recordConnectionState as jest.Mock;
const mockFindByHandle = findCreatorForHandle as jest.Mock;

const BASE = "http://localhost:3009/api/portal/connections";
const TOKEN = newConnectToken();
const saved = {
  id: process.env.GOOGLE_CLIENT_ID,
  secret: process.env.GOOGLE_CLIENT_SECRET,
  auth: process.env.NEXTAUTH_SECRET,
};
const originalFetch = global.fetch;
let revoked = false;

function params(platform: string) {
  return { params: Promise.resolve({ platform }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  revoked = false;
  process.env.GOOGLE_CLIENT_ID = "g-id";
  process.env.GOOGLE_CLIENT_SECRET = "g-secret";
  process.env.NEXTAUTH_SECRET = "test-auth-secret";
  mockReady.mockResolvedValue(true);
  mockSession.mockResolvedValue(null);
  mockDb.creatorConnectToken.findUnique.mockImplementation(async ({ where }) => {
    if (where.tokenHash) return where.tokenHash === hashConnectToken(TOKEN) ? { id: "tok-1" } : null;
    if (where.id === "tok-1")
      return { id: "tok-1", orgId: "org-a", creatorId: "c-bound", revokedAt: revoked ? new Date() : null };
    return null;
  });
  mockDb.creator.findFirst.mockResolvedValue({ id: "c-bound", handle: "fake_roster_handle" });
  mockDb.creatorSocialAccount.findUnique.mockResolvedValue(null);
  mockDb.creatorSocialAccount.upsert.mockResolvedValue({ id: "sa-new" });
  mockDb.creatorConnectToken.update.mockResolvedValue({});
});

afterAll(() => {
  global.fetch = originalFetch;
  for (const [key, value] of [
    ["GOOGLE_CLIENT_ID", saved.id],
    ["GOOGLE_CLIENT_SECRET", saved.secret],
    ["NEXTAUTH_SECRET", saved.auth],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("start?connect=<token>", () => {
  it("sends the creator to consent with a signed state and no login", async () => {
    const res = await startConnect(
      new NextRequest(`${BASE}/youtube/start?connect=${TOKEN}`),
      params("youtube"),
    );
    const location = new URL(res.headers.get("location")!);
    expect(location.hostname).toBe("accounts.google.com");
    const state = location.searchParams.get("state")!;
    expect(state.startsWith("ct.")).toBe(true);
    // The raw token never goes to the provider.
    expect(location.toString()).not.toContain(TOKEN);
    expect(res.cookies.get("portal_oauth_state")?.value).toBe(state);
    expect(res.cookies.get("portal_oauth_return")?.value).toBe(`/connect/${TOKEN}`);
    expect(mockSession).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed link without a lookup", async () => {
    const res = await startConnect(
      new NextRequest(`${BASE}/youtube/start?connect=not-a-token`),
      params("youtube"),
    );
    expect(res.status).toBe(404);
    expect(mockDb.creatorConnectToken.findUnique).not.toHaveBeenCalled();
  });

  it("sends a revoked link back to its page instead of to consent", async () => {
    revoked = true;
    const res = await startConnect(
      new NextRequest(`${BASE}/youtube/start?connect=${TOKEN}`),
      params("youtube"),
    );
    expect(res.headers.get("location")).toContain(`/connect/${TOKEN}?error=link`);
  });

  it("outside production, connects an unconfigured platform onto the bound row", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const res = await startConnect(
      new NextRequest(`${BASE}/youtube/start?connect=${TOKEN}`),
      params("youtube"),
    );
    expect(res.headers.get("location")).toContain(`/connect/${TOKEN}?connected=youtube`);
    const args = mockDb.creatorSocialAccount.upsert.mock.calls[0][0];
    expect(args.create.creatorId).toBe("c-bound");
    expect(args.create.origin).toBe("dev");
    expect(mockDb.creatorConnectToken.update.mock.calls[0][0].where).toEqual({ id: "tok-1" });
  });
});

describe("callback with a connect-link state", () => {
  function callback(state: string, cookieState = state) {
    return oauthCallback(
      new NextRequest(`${BASE}/youtube/callback?state=${encodeURIComponent(state)}&code=code-1`, {
        headers: {
          cookie: `portal_oauth_state=${encodeURIComponent(cookieState)}; portal_oauth_return=/connect/${TOKEN}`,
        },
      }),
      params("youtube"),
    );
  }

  function googleAnswers() {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "yt-access", refresh_token: "yt-refresh", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: "UC-fake-channel",
              snippet: { customUrl: "@fake_channel", title: "Fake Channel" },
              statistics: { subscriberCount: "10", videoCount: "2" },
            },
          ],
        }),
      });
  }

  it("stores the connection on the bound row and marks the link used", async () => {
    googleAnswers();
    const res = await callback(connectState("tok-1")!);

    expect(res.headers.get("location")).toContain(`/connect/${TOKEN}?connected=youtube`);
    const args = mockDb.creatorSocialAccount.upsert.mock.calls[0][0];
    expect(args.where.creatorId_platform_platformUserId).toEqual({
      creatorId: "c-bound",
      platform: "YOUTUBE",
      platformUserId: "UC-fake-channel",
    });
    expect(decrypt(args.create.accessToken, "org-a")).toBe("yt-access");
    // No portal session, and no handle lookup of any kind.
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockFindByHandle).not.toHaveBeenCalled();
    expect(mockDb.creator.findMany).not.toHaveBeenCalled();
    expect(mockDb.creator.findFirst.mock.calls[0][0].where).toEqual({
      id: "c-bound",
      orgId: "org-a",
      deletedAt: null,
    });
    expect(mockDb.creatorConnectToken.update).toHaveBeenCalledWith({
      where: { id: "tok-1" },
      data: { usedAt: expect.any(Date) },
    });
    expect(mockRecord).toHaveBeenCalledWith("sa-new", expect.objectContaining({ grantorUserId: undefined }));
  });

  it("stops before spending the code when the link was revoked mid-consent", async () => {
    revoked = true;
    global.fetch = jest.fn();
    const res = await callback(connectState("tok-1")!);
    expect(res.headers.get("location")).toContain(`/connect/${TOKEN}?error=youtube&reason=link`);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.upsert).not.toHaveBeenCalled();
  });

  it("still requires the state cookie this browser was given", async () => {
    global.fetch = jest.fn();
    const res = await callback(connectState("tok-1")!, "something-else");
    expect(res.headers.get("location")).toContain("reason=state");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("treats a forged connect state as an ordinary signed-out callback: 401", async () => {
    global.fetch = jest.fn();
    const [p, nonce, , mac] = connectState("tok-1")!.split(".");
    const forged = `${p}.${nonce}.tok-other.${mac}`;
    const res = await callback(forged);
    expect(res.status).toBe(401);
    expect(mockDb.creatorConnectToken.findUnique).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.upsert).not.toHaveBeenCalled();
  });
});
