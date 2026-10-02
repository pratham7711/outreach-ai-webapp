/**
 * @jest-environment node
 *
 * The one-off grantor backfill (not run by anything on a schedule): asks Meta
 * who granted each stored token and records that beside the row, so the
 * deauthorize and data-deletion callbacks can find Facebook and
 * Instagram-via-Facebook rows. It writes only CreatorAccountState.
 */
import { randomBytes } from "crypto";

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

jest.mock("@/lib/db", () => ({
  db: {
    creatorSocialAccount: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  },
}));
jest.mock("@/lib/creators/connectTables", () => ({ connectTablesReady: jest.fn() }));
jest.mock("@/lib/platforms/accountState", () => ({
  accountStatesFor: jest.fn(),
  recordGrantor: jest.fn(),
}));

import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto/encrypt";
import { connectTablesReady } from "@/lib/creators/connectTables";
import { accountStatesFor, recordGrantor } from "@/lib/platforms/accountState";
import { backfillMetaGrantors, fetchMetaGrantorId } from "@/lib/platforms/metaGrantor";

const mockDb = db as unknown as {
  creatorSocialAccount: { findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock; delete: jest.Mock };
};
const mockReady = connectTablesReady as jest.Mock;
const mockStates = accountStatesFor as jest.Mock;
const mockRecord = recordGrantor as jest.Mock;
const originalFetch = global.fetch;

function row(id: string, platform: string, origin: string | null, token = `tok-${id}`) {
  return { id, platform, origin, accessToken: encrypt(token, "org-1"), creator: { orgId: "org-1" } };
}

function metaAnswers(ids: Record<string, string | null>) {
  global.fetch = jest.fn(async (url: string) => {
    const token = new URL(url).searchParams.get("access_token")!;
    const id = ids[token];
    return id ? { ok: true, json: async () => ({ id }) } : { ok: false, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReady.mockResolvedValue(true);
  mockStates.mockResolvedValue(new Map());
  mockRecord.mockResolvedValue(true);
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe("fetchMetaGrantorId", () => {
  it("asks graph.facebook.com for Facebook Login tokens and graph.instagram.com for Instagram Login", async () => {
    metaAnswers({ a: "fb-user", b: "ig-user" });
    expect(await fetchMetaGrantorId("instagram", "a")).toBe("fb-user");
    expect(await fetchMetaGrantorId("instagram-login", "b")).toBe("ig-user");
    const urls = (global.fetch as jest.Mock).mock.calls.map((c) => new URL(c[0]).hostname);
    expect(urls).toEqual(["graph.facebook.com", "graph.instagram.com"]);
  });

  it("answers null, never throws, when Meta refuses or the network fails", async () => {
    metaAnswers({});
    expect(await fetchMetaGrantorId("facebook", "dead")).toBeNull();
    global.fetch = jest.fn().mockRejectedValue(new Error("offline"));
    expect(await fetchMetaGrantorId("facebook", "x")).toBeNull();
  });
});

describe("backfillMetaGrantors", () => {
  it("does nothing while the table does not exist", async () => {
    mockReady.mockResolvedValue(false);
    const result = await backfillMetaGrantors();
    expect(result.ready).toBe(false);
    expect(mockDb.creatorSocialAccount.findMany).not.toHaveBeenCalled();
  });

  it("records who granted each working token, through the right host", async () => {
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([
      row("sa-fb", "FACEBOOK", "oauth"),
      row("sa-iglogin", "INSTAGRAM", "oauth_instagram_login"),
    ]);
    metaAnswers({ "tok-sa-fb": "fb-grantor", "tok-sa-iglogin": "ig-grantor" });

    const result = await backfillMetaGrantors();
    expect(result).toMatchObject({ ready: true, scanned: 2, filled: 2, unresolved: 0 });
    expect(mockRecord).toHaveBeenCalledWith("sa-fb", "fb-grantor");
    expect(mockRecord).toHaveBeenCalledWith("sa-iglogin", "ig-grantor");
  });

  it("skips rows already known and counts dead tokens as unresolved", async () => {
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([
      row("sa-known", "INSTAGRAM", "oauth"),
      row("sa-dead", "INSTAGRAM", null),
    ]);
    mockStates.mockResolvedValue(new Map([["sa-known", { grantorUserId: "already" }]]));
    metaAnswers({});

    const result = await backfillMetaGrantors();
    expect(result).toMatchObject({ alreadyKnown: 1, unresolved: 1, filled: 0 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("never writes, updates or deletes the account row itself", async () => {
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([row("sa-1", "FACEBOOK", "oauth")]);
    metaAnswers({ "tok-sa-1": "g" });
    await backfillMetaGrantors();
    expect(mockDb.creatorSocialAccount.update).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.updateMany).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.delete).not.toHaveBeenCalled();
  });

  it("reads only Meta rows holding a credential, and walks the table by cursor", async () => {
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([
      row("sa-1", "FACEBOOK", "oauth"),
      row("sa-2", "FACEBOOK", "oauth"),
    ]);
    metaAnswers({});
    const first = await backfillMetaGrantors({ limit: 2 });
    expect(first.nextAfterId).toBe("sa-2");

    const where = mockDb.creatorSocialAccount.findMany.mock.calls[0][0].where;
    expect(where.platform).toEqual({ in: ["INSTAGRAM", "FACEBOOK"] });
    expect(where.accessToken).toEqual({ not: "manual-entry" });
    expect(where.id).toBeUndefined();

    mockDb.creatorSocialAccount.findMany.mockResolvedValue([row("sa-3", "FACEBOOK", "oauth")]);
    const second = await backfillMetaGrantors({ limit: 2, afterId: first.nextAfterId });
    expect(mockDb.creatorSocialAccount.findMany.mock.calls[1][0].where.id).toEqual({ gt: "sa-2" });
    expect(second.nextAfterId).toBeNull();
  });
});
