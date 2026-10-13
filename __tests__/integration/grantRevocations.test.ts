/**
 * @jest-environment node
 *
 * Every way a connection ends also ends its grants, with the reason on the
 * record (plan K4): Disconnect, the agency removing it, TikTok's
 * authorization.removed, Meta's deauthorize and data-deletion callbacks, a
 * deleted creator login, and Google's invalid_grant -- the last of which keeps
 * the connection and deletes nothing.
 */
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { POST as tiktokWebhook } from "@/app/api/webhooks/tiktok/route";
import { POST as deauthorize } from "@/app/api/webhooks/meta/deauthorize/route";
import { POST as dataDeletion } from "@/app/api/webhooks/meta/data-deletion/route";
import { DELETE as removeSocialAccount } from "@/app/api/creators/[id]/social-accounts/route";
import { signTikTokWebhook } from "@/lib/oauth/tiktokWebhook";
import { signRequest } from "@/lib/oauth/metaSignedRequest";
import { disconnectSocialAccount } from "@/lib/portal/disconnect";
import { deleteCreatorLogin } from "@/lib/portal/deleteCreatorLogin";
import { ensureFreshYouTubeToken } from "@/lib/platforms/youtubeToken";
import { encrypt } from "@/lib/crypto/encrypt";
import { resetGrantTablesCache } from "@/lib/creators/grantTables";

jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: jest.fn(),
    $transaction: jest.fn(),
    creator: { findFirst: jest.fn(), updateMany: jest.fn() },
    creatorSocialAccount: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    creatorGrant: { updateMany: jest.fn() },
    conversation: { findMany: jest.fn(), deleteMany: jest.fn() },
    negotiationOffer: { updateMany: jest.fn() },
    message: { deleteMany: jest.fn() },
    creatorTestimonial: { deleteMany: jest.fn() },
    campaignProposal: { deleteMany: jest.fn() },
    payoutRequest: { updateMany: jest.fn() },
    creatorSession: { deleteMany: jest.fn() },
    creatorUser: { delete: jest.fn() },
  },
}));
jest.mock("@/lib/platforms/accountState", () => ({
  accountIdsForGrantor: jest.fn(),
  isReconnectNeeded: jest.fn(),
  markReconnectNeeded: jest.fn(),
}));
jest.mock("@/lib/authenticate", () => ({
  authenticateRequest: jest.fn(),
  getAuditActor: jest.fn(),
}));

import { db } from "@/lib/db";
import { accountIdsForGrantor, isReconnectNeeded, markReconnectNeeded } from "@/lib/platforms/accountState";
import { authenticateRequest } from "@/lib/authenticate";

const mockDb = db as unknown as {
  $queryRawUnsafe: jest.Mock;
  $transaction: jest.Mock;
  creator: { findFirst: jest.Mock; updateMany: jest.Mock };
  creatorSocialAccount: Record<"findFirst" | "findMany" | "delete" | "deleteMany" | "count" | "update", jest.Mock>;
  creatorGrant: { updateMany: jest.Mock };
  conversation: { findMany: jest.Mock };
};

const ENV_KEYS = [
  "TIKTOK_CLIENT_SECRET",
  "TIKTOK_SANDBOX_CLIENT_SECRET",
  "INSTAGRAM_CLIENT_ID",
  "INSTAGRAM_CLIENT_SECRET",
  "APP_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
const originalFetch = global.fetch;

function tableExists(yes: boolean) {
  mockDb.$queryRawUnsafe.mockResolvedValue([{ n: yes ? 1 : 0 }]);
}

function revokedWith() {
  return mockDb.creatorGrant.updateMany.mock.calls.map((c) => ({
    ids: c[0].where.connectionId.in,
    reason: c[0].data.revokeReason,
  }));
}

function firstCall(m: jest.Mock) {
  return m.mock.invocationCallOrder[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  resetGrantTablesCache();
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.TIKTOK_CLIENT_SECRET = "tt-secret";
  delete process.env.TIKTOK_SANDBOX_CLIENT_SECRET;
  process.env.INSTAGRAM_CLIENT_ID = "ig-id";
  process.env.INSTAGRAM_CLIENT_SECRET = "meta-secret";
  process.env.APP_URL = "https://campaign.madeboring.com";
  process.env.GOOGLE_CLIENT_ID = "g-id";
  process.env.GOOGLE_CLIENT_SECRET = "g-secret";
  tableExists(true);
  mockDb.$transaction.mockResolvedValue([]);
  mockDb.creatorGrant.updateMany.mockResolvedValue({ count: 1 });
  mockDb.creatorSocialAccount.delete.mockResolvedValue({});
  mockDb.creatorSocialAccount.deleteMany.mockResolvedValue({ count: 1 });
  mockDb.creatorSocialAccount.count.mockResolvedValue(0);
  mockDb.conversation.findMany.mockResolvedValue([]);
  (accountIdsForGrantor as jest.Mock).mockResolvedValue([]);
  global.fetch = jest.fn();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe("Disconnect", () => {
  const account = { id: "conn-1", creatorId: "creator-1", platform: "TIKTOK", accessToken: "enc", origin: "oauth" };

  it("revokes with reason disconnect, before the row is deleted", async () => {
    await disconnectSocialAccount(account, "org-1", { alreadyRevoked: true });
    expect(revokedWith()).toEqual([{ ids: ["conn-1"], reason: "disconnect" }]);
    expect(firstCall(mockDb.creatorGrant.updateMany)).toBeLessThan(firstCall(mockDb.creatorSocialAccount.delete));
  });

  it("still deletes the row when the grant table is absent", async () => {
    tableExists(false);
    await disconnectSocialAccount(account, "org-1", { alreadyRevoked: true });
    expect(mockDb.creatorGrant.updateMany).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.delete).toHaveBeenCalledWith({ where: { id: "conn-1" } });
  });
});

describe("TikTok authorization.removed", () => {
  it("revokes every org's grant on that account with TikTok's reason", async () => {
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([
      { id: "conn-1", creatorId: "c-1", platform: "TIKTOK", accessToken: "enc", origin: "oauth", creator: { orgId: "org-1" } },
      { id: "conn-2", creatorId: "c-2", platform: "TIKTOK", accessToken: "enc", origin: "oauth", creator: { orgId: "org-2" } },
    ]);
    const body = JSON.stringify({
      client_key: "ck",
      event: "authorization.removed",
      create_time: Math.floor(Date.now() / 1000),
      user_openid: "open-id-fake-1",
      content: JSON.stringify({ reason: 1 }),
    });
    const res = await tiktokWebhook(
      new NextRequest("https://campaign.madeboring.com/api/webhooks/tiktok", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "tiktok-signature": signTikTokWebhook(body, "tt-secret", Math.floor(Date.now() / 1000)),
        },
        body,
      }),
    );
    expect(res.status).toBe(200);
    expect(revokedWith()).toEqual([
      { ids: ["conn-1"], reason: "tiktok_authorization_removed" },
      { ids: ["conn-2"], reason: "tiktok_authorization_removed" },
    ]);
  });
});

describe("Meta callbacks", () => {
  function formPost(url: string, signed: string) {
    return new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ signed_request: signed }).toString(),
    });
  }

  it("deauthorize revokes the rows it is about to delete, with Meta's reason", async () => {
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([{ id: "conn-ig" }]);
    await deauthorize(
      formPost(
        "https://campaign.madeboring.com/api/webhooks/meta/deauthorize",
        signRequest({ user_id: "17841400000000000" }, "meta-secret"),
      ),
    );
    expect(revokedWith()).toEqual([{ ids: ["conn-ig"], reason: "meta_deauthorize" }]);
    /* The same rows: the lookup and the delete use one where clause. */
    expect(mockDb.creatorSocialAccount.findMany.mock.calls[0][0].where).toEqual(
      mockDb.creatorSocialAccount.deleteMany.mock.calls[0][0].where,
    );
    expect(firstCall(mockDb.creatorGrant.updateMany)).toBeLessThan(firstCall(mockDb.creatorSocialAccount.deleteMany));
  });

  it("data deletion records its own reason", async () => {
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([{ id: "conn-ig" }]);
    await dataDeletion(
      formPost(
        "https://campaign.madeboring.com/api/webhooks/meta/data-deletion",
        signRequest({ user_id: "17841400000000000" }, "meta-secret"),
      ),
    );
    expect(revokedWith()).toEqual([{ ids: ["conn-ig"], reason: "meta_data_deletion" }]);
  });

  it("is the single deleteMany it always was while the table is absent", async () => {
    tableExists(false);
    await deauthorize(
      formPost(
        "https://campaign.madeboring.com/api/webhooks/meta/deauthorize",
        signRequest({ user_id: "17841400000000000" }, "meta-secret"),
      ),
    );
    expect(mockDb.creatorSocialAccount.findMany).not.toHaveBeenCalled();
    expect(mockDb.creatorGrant.updateMany).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.deleteMany).toHaveBeenCalledTimes(1);
  });
});

describe("the agency removing a connection", () => {
  it("revokes with reason agency_removed, scoped to its own roster row", async () => {
    (authenticateRequest as jest.Mock).mockResolvedValue({ orgId: "org-1", actorType: "user", role: "OWNER" });
    mockDb.creator.findFirst.mockResolvedValue({ id: "creator-1" });
    mockDb.creatorSocialAccount.findFirst.mockResolvedValue({ id: "conn-1" });
    const res = await removeSocialAccount(
      new NextRequest("http://localhost:3009/api/creators/creator-1/social-accounts?accountId=conn-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "creator-1" }) },
    );
    expect(res.status).toBe(200);
    expect(revokedWith()).toEqual([{ ids: ["conn-1"], reason: "agency_removed" }]);
  });
});

describe("a creator deleting their login", () => {
  it("revokes the connections still stamped with it, then deletes as before", async () => {
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([{ id: "conn-stamped" }]);
    await deleteCreatorLogin("cu-1");
    expect(mockDb.creatorSocialAccount.findMany.mock.calls[0][0].where).toEqual({ creatorUserId: "cu-1" });
    expect(revokedWith()).toEqual([{ ids: ["conn-stamped"], reason: "account_deleted" }]);
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("Google invalid_grant", () => {
  it("revokes the grant with reason invalid_grant and deletes nothing", async () => {
    (isReconnectNeeded as jest.Mock).mockResolvedValue(false);
    (markReconnectNeeded as jest.Mock).mockResolvedValue(true);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant", error_description: "Token has been expired or revoked." }),
    });
    const token = await ensureFreshYouTubeToken(
      {
        id: "conn-yt",
        accessToken: encrypt("old-access", "org-1"),
        refreshToken: encrypt("dead-refresh", "org-1"),
        tokenExpiry: new Date(Date.now() - 60_000),
      },
      "org-1",
    );
    expect(token).toBeUndefined();
    expect(revokedWith()).toEqual([{ ids: ["conn-yt"], reason: "invalid_grant" }]);
    expect(mockDb.creatorSocialAccount.delete).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.deleteMany).not.toHaveBeenCalled();
  });
});
