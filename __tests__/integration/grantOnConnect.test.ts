/**
 * @jest-environment node
 *
 * Every successful connect records a grant for the org the connection was
 * made under (plan K4): the connect link's org, or, signed in, the org of the
 * roster row the handle resolved to. Never an org named by the request.
 */
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { GET as startConnect } from "@/app/api/portal/connections/[platform]/start/route";
import { GET as oauthCallback } from "@/app/api/portal/connections/[platform]/callback/route";
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
jest.mock("@/lib/creators/grants", () => ({
  ...jest.requireActual("@/lib/creators/grants"),
  recordGrant: jest.fn(),
}));

import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { connectTablesReady } from "@/lib/creators/connectTables";
import { findCreatorForHandle } from "@/lib/portal/creatorLookup";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { recordGrant } from "@/lib/creators/grants";

const mockDb = db as unknown as {
  creator: { findFirst: jest.Mock; findMany: jest.Mock };
  creatorSocialAccount: { findUnique: jest.Mock; upsert: jest.Mock };
  creatorConnectToken: { findUnique: jest.Mock; update: jest.Mock };
};
const mockSession = getCreatorSession as jest.Mock;
const mockFindByHandle = findCreatorForHandle as jest.Mock;
const mockLinked = findLinkedCreatorsForHandle as jest.Mock;
const mockRecordGrant = recordGrant as jest.Mock;

const BASE = "http://localhost:3009/api/portal/connections";
const TOKEN = newConnectToken();
const saved = {
  id: process.env.GOOGLE_CLIENT_ID,
  secret: process.env.GOOGLE_CLIENT_SECRET,
  auth: process.env.NEXTAUTH_SECRET,
};
const originalFetch = global.fetch;

function params(platform: string) {
  return { params: Promise.resolve({ platform }) };
}

function googleAnswers(scope?: string) {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "yt-access",
        refresh_token: "yt-refresh",
        expires_in: 3600,
        ...(scope ? { scope } : {}),
      }),
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

function callback(state: string, cookie: string) {
  return oauthCallback(
    new NextRequest(`${BASE}/youtube/callback?state=${encodeURIComponent(state)}&code=code-1`, {
      headers: { cookie: `portal_oauth_state=${encodeURIComponent(state)}; ${cookie}` },
    }),
    params("youtube"),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = "g-id";
  process.env.GOOGLE_CLIENT_SECRET = "g-secret";
  process.env.NEXTAUTH_SECRET = "test-auth-secret";
  (connectTablesReady as jest.Mock).mockResolvedValue(true);
  mockSession.mockResolvedValue(null);
  mockLinked.mockResolvedValue([]);
  mockRecordGrant.mockResolvedValue(true);
  mockDb.creatorConnectToken.findUnique.mockImplementation(async ({ where }) => {
    if (where.tokenHash) return where.tokenHash === hashConnectToken(TOKEN) ? { id: "tok-1" } : null;
    if (where.id === "tok-1") return { id: "tok-1", orgId: "org-link", creatorId: "c-bound", revokedAt: null };
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

describe("OAuth callback", () => {
  it("records a connect-link grant for the link's org, with the scopes Google reported", async () => {
    googleAnswers("openid https://www.googleapis.com/auth/youtube.readonly");
    const res = await callback(connectState("tok-1")!, `portal_oauth_return=/connect/${TOKEN}`);

    expect(res.headers.get("location")).toContain("connected=youtube");
    expect(mockRecordGrant).toHaveBeenCalledTimes(1);
    expect(mockRecordGrant).toHaveBeenCalledWith({
      orgId: "org-link",
      creatorId: "c-bound",
      platform: "YOUTUBE",
      connectionId: "sa-new",
      platformAccountId: "UC-fake-channel",
      scopes: ["openid", "https://www.googleapis.com/auth/youtube.readonly"],
      scopesSource: "provider",
      source: "connect-link",
    });
  });

  it("records a portal grant for the org of the roster row the handle resolved to", async () => {
    mockSession.mockResolvedValue({ handle: "fake_channel" });
    mockFindByHandle.mockResolvedValue({ id: "c-portal", orgId: "org-portal" });
    googleAnswers();
    const res = await callback("plain-state", "portal_oauth_return=/portal/settings");

    expect(res.headers.get("location")).toContain("connected=youtube");
    expect(mockRecordGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-portal",
        creatorId: "c-portal",
        source: "portal",
        /* Google said nothing about scope here, so the record says it is
           what was asked for, not what was granted. */
        scopesSource: "requested",
      }),
    );
  });

  it("records nothing when the connection was refused", async () => {
    mockSession.mockResolvedValue({ handle: "someone_else" });
    mockFindByHandle.mockResolvedValue({ id: "c-portal", orgId: "org-portal" });
    googleAnswers();
    const res = await callback("plain-state", "portal_oauth_return=/portal/settings");

    expect(res.headers.get("location")).toContain("reason=creator");
    expect(mockRecordGrant).not.toHaveBeenCalled();
  });

  it("still connects when the grant cannot be recorded", async () => {
    mockRecordGrant.mockResolvedValue(false);
    googleAnswers();
    const res = await callback(connectState("tok-1")!, `portal_oauth_return=/connect/${TOKEN}`);
    expect(res.headers.get("location")).toContain("connected=youtube");
    expect(mockDb.creatorConnectToken.update).toHaveBeenCalled();
  });
});

describe("the non-production connect shortcut", () => {
  it("grants the link's org on the bound row", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    await startConnect(new NextRequest(`${BASE}/youtube/start?connect=${TOKEN}`), params("youtube"));
    expect(mockRecordGrant).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-link", creatorId: "c-bound", connectionId: "sa-new", source: "dev", scopes: [] }),
    );
  });
});
