/**
 * @jest-environment node
 *
 * The connected-data readers, routed through the grant gate (plan K4): with
 * the grant table in place, a connection this org holds no live grant for is
 * read exactly like no connection at all -- the public read instead, or the
 * "not connected" answer -- and a granted one is read as before.
 */
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { GET as cronSync } from "@/app/api/cron/sync-posts/route";

/* Instagram belongs to the hourly paced pass by default (lib/sync/instagramPacing).
   These tests are about the shared sweep through the 6-hourly route, reading
   every platform, which is what it does with that pass switched off. */
const realInstagramHourly = process.env.SYNC_INSTAGRAM_HOURLY;
beforeAll(() => {
  process.env.SYNC_INSTAGRAM_HOURLY = "off";
});
afterAll(() => {
  if (realInstagramHourly === undefined) delete process.env.SYNC_INSTAGRAM_HOURLY;
  else process.env.SYNC_INSTAGRAM_HOURLY = realInstagramHourly;
});
import { GET as tiktokVideos } from "@/app/api/creators/[id]/tiktok-videos/route";
import { getTikTokTokenForCreator } from "@/lib/platforms/tiktokToken";
import { getInstagramAccountForCreator } from "@/lib/platforms/instagramToken";
import { encrypt } from "@/lib/crypto/encrypt";
import { resetGrantTablesCache } from "@/lib/creators/grantTables";

jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: jest.fn(),
    $transaction: jest.fn(),
    post: { findMany: jest.fn(), update: jest.fn() },
    organization: { findUnique: jest.fn(), findMany: jest.fn() },
    campaign: { findMany: jest.fn(), updateMany: jest.fn() },
    postMetricSnapshot: { create: jest.fn() },
    creator: { findFirst: jest.fn(), findUnique: jest.fn() },
    creatorSocialAccount: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    creatorGrant: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/platforms/fetchPostMetrics", () => ({
  ...jest.requireActual("@/lib/platforms/fetchPostMetrics"),
  fetchPostMetrics: jest.fn(),
  fetchYouTubeMetricsBatch: jest.fn().mockResolvedValue(new Map()),
}));
jest.mock("@/lib/alerts", () => ({
  ...jest.requireActual("@/lib/alerts"),
  alertOps: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/platforms/tiktokDisplay", () => ({
  ...jest.requireActual("@/lib/platforms/tiktokDisplay"),
  fetchTikTokVideos: jest.fn(),
}));
jest.mock("@/lib/authenticate", () => ({ authenticateRequest: jest.fn() }));

import { db } from "@/lib/db";
import { fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";
import { fetchTikTokVideos } from "@/lib/platforms/tiktokDisplay";
import { authenticateRequest } from "@/lib/authenticate";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as any;
const mockFetch = fetchPostMetrics as jest.Mock;
const HOUR_MS = 60 * 60 * 1000;
const FAR = new Date(Date.now() + 40 * 24 * HOUR_MS);

function account(id: string, platform: string, token: string, orgId = "org-1") {
  return {
    id,
    creatorId: "creator-1",
    platform,
    handle: "fake_connected_handle",
    origin: "oauth",
    accessToken: encrypt(token, orgId),
    refreshToken: null,
    tokenExpiry: FAR,
    platformUserId: "fake-account-id",
    followersCount: 10,
    statsSyncedAt: null,
  };
}

function grants(...connectionIds: string[]) {
  mockDb.creatorGrant.findMany.mockResolvedValue(
    connectionIds.map((connectionId, i) => ({ id: `g-${i}`, orgId: "org-1", connectionId })),
  );
}

const realSecret = process.env.CRON_SECRET;

beforeEach(() => {
  jest.clearAllMocks();
  resetGrantTablesCache();
  jest.spyOn(console, "error").mockImplementation(() => {});
  process.env.CRON_SECRET = "secret";
  mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 1 }]);
  mockDb.campaign.findMany.mockResolvedValue([]);
  mockDb.campaign.updateMany.mockResolvedValue({ count: 0 });
  mockDb.organization.findMany.mockResolvedValue([{ id: "org-1", uiConfig: null }]);
  mockDb.post.update.mockResolvedValue({});
  grants();
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
  if (realSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = realSecret;
});

describe("the post sync cron", () => {
  function instagramPost() {
    return {
      id: "post-1",
      campaignId: "campaign-1",
      platform: "INSTAGRAM",
      postUrl: "https://www.instagram.com/reel/AAA1/",
      postedAt: new Date(Date.now() - HOUR_MS),
      lastSyncedAt: null,
      viewsCount: 100,
      likesCount: 10,
      commentsCount: 2,
      sharesCount: 1,
      engagementRate: 12,
      syncFailCount: 0,
      syncDisabledAt: null,
      snapshots: [],
      trackingEnabled: true,
      trackingStartedAt: new Date(Date.now() - HOUR_MS),
      trackingTtlDays: 30,
      trackingExpiresAt: new Date(Date.now() + 29 * 24 * HOUR_MS),
      creator: {
        orgId: "org-1",
        handle: null,
        platform: null,
        profileLinks: [],
        socialAccounts: [account("conn-ig", "INSTAGRAM", "ig-access-fake")],
      },
    };
  }

  async function runCron() {
    mockDb.post.findMany.mockImplementation(async (args: { where?: { platform?: string } }) =>
      args?.where?.platform === "INSTAGRAM" ? [instagramPost()] : [],
    );
    mockFetch.mockRejectedValue(new Error("stop after the call"));
    await cronSync(new NextRequest("http://localhost/api/cron/sync-posts", { headers: { authorization: "Bearer secret" } }));
    return mockFetch.mock.calls[0]?.[1];
  }

  it("does not hand over a token the post's org holds no grant for, but keeps the handle hint", async () => {
    const options = await runCron();
    expect(options.instagramToken).toBeUndefined();
    expect(options.instagramHandle).toBe("fake_connected_handle");
    expect(mockDb.creatorGrant.findMany.mock.calls[0][0].where).toEqual({
      revokedAt: null,
      OR: [{ orgId: "org-1", connectionId: { in: ["conn-ig"] } }],
    });
  });

  it("uses a granted connection exactly as before", async () => {
    grants("conn-ig");
    const options = await runCron();
    expect(options.instagramToken).toBe("ig-access-fake");
  });

  it("uses every connection, unasked, while the grant table does not exist", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 0 }]);
    const options = await runCron();
    expect(options.instagramToken).toBe("ig-access-fake");
    expect(mockDb.creatorGrant.findMany).not.toHaveBeenCalled();
  });

  /* The cron reads two Instagram posts at once now. Two posts by one creator
     would each find the same token inside its refresh window and trade it in
     -- two exchanges, two writes, and the second replacing a token the first
     read was still holding. */
  it("trades an expiring token in once per run, however many of the creator's posts are read", async () => {
    grants("conn-ig");
    const realGlobalFetch = global.fetch;
    const realClientId = process.env.INSTAGRAM_CLIENT_ID;
    const realClientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
    process.env.INSTAGRAM_CLIENT_ID = "fake-client-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "fake-client-secret";
    const exchange = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return new Response(JSON.stringify({ access_token: "ig-access-renewed", expires_in: 5_184_000 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    global.fetch = exchange as unknown as typeof fetch;
    mockDb.creatorSocialAccount.update.mockResolvedValue({});

    const expiring = { ...account("conn-ig", "INSTAGRAM", "ig-access-fake"), tokenExpiry: new Date(Date.now() + 2 * 24 * HOUR_MS) };
    const post = (id: string) => {
      const p = instagramPost();
      return { ...p, id, postUrl: `https://www.instagram.com/reel/${id}/`, creator: { ...p.creator, socialAccounts: [expiring] } };
    };
    try {
      mockDb.post.findMany.mockImplementation(async (args: { where?: { platform?: string } }) =>
        args?.where?.platform === "INSTAGRAM" ? [post("AAA1"), post("AAA2")] : [],
      );
      mockFetch.mockRejectedValue(new Error("stop after the call"));
      await cronSync(new NextRequest("http://localhost/api/cron/sync-posts", { headers: { authorization: "Bearer secret" } }));
    } finally {
      global.fetch = realGlobalFetch;
      if (realClientId === undefined) delete process.env.INSTAGRAM_CLIENT_ID;
      else process.env.INSTAGRAM_CLIENT_ID = realClientId;
      if (realClientSecret === undefined) delete process.env.INSTAGRAM_CLIENT_SECRET;
      else process.env.INSTAGRAM_CLIENT_SECRET = realClientSecret;
    }

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls.map((c) => c[1].instagramToken)).toEqual(["ig-access-renewed", "ig-access-renewed"]);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(mockDb.creatorSocialAccount.update).toHaveBeenCalledTimes(1);
  });
});

describe("token helpers", () => {
  it("TikTok: no grant, no token", async () => {
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([account("conn-tt", "TIKTOK", "tt-access-fake")]);
    expect(await getTikTokTokenForCreator("creator-1", "org-1")).toBeUndefined();
    expect(mockDb.creatorSocialAccount.findMany.mock.calls[0][0].where).toMatchObject({ creator: { orgId: "org-1" } });

    grants("conn-tt");
    expect(await getTikTokTokenForCreator("creator-1", "org-1")).toBe("tt-access-fake");
  });

  it("Instagram: no grant, no token, but the connected handle still names whom to look up", async () => {
    mockDb.creator.findUnique.mockResolvedValue({
      handle: "fake_roster_handle",
      platform: "INSTAGRAM",
      profileLinks: [],
      socialAccounts: [{ handle: "fake_connected_handle" }],
    });
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([account("conn-ig", "INSTAGRAM", "ig-access-fake")]);

    const read = await getInstagramAccountForCreator("creator-1", "org-1", "https://www.instagram.com/reel/AAA1/");
    expect(read.token).toBeUndefined();
    expect(read.handle).toBe("fake_connected_handle");

    grants("conn-ig");
    expect((await getInstagramAccountForCreator("creator-1", "org-1", "https://www.instagram.com/reel/AAA1/")).token).toBe(
      "ig-access-fake",
    );
  });
});

describe("GET /api/creators/[id]/tiktok-videos", () => {
  beforeEach(() => {
    (authenticateRequest as jest.Mock).mockResolvedValue({ orgId: "org-1" });
    mockDb.creator.findFirst.mockResolvedValue({ id: "creator-1" });
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([account("conn-tt", "TIKTOK", "tt-access-fake")]);
    (fetchTikTokVideos as jest.Mock).mockResolvedValue([]);
  });

  function get() {
    return tiktokVideos(new NextRequest("http://localhost:3009/api/creators/creator-1/tiktok-videos"), {
      params: Promise.resolve({ id: "creator-1" }),
    });
  }

  it("answers 'not connected' for a connection this org holds no grant for", async () => {
    const res = await get();
    expect(res.status).toBe(409);
    expect(fetchTikTokVideos).not.toHaveBeenCalled();
  });

  it("reads the oldest granted connection", async () => {
    grants("conn-tt");
    const res = await get();
    expect(res.status).toBe(200);
    expect(fetchTikTokVideos).toHaveBeenCalledWith("tt-access-fake");
    expect(mockDb.creatorSocialAccount.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });
});
