/**
 * @jest-environment node
 *
 * TikTok's authorization.removed ends a connection the same way the creator
 * pressing Disconnect does (lib/portal/disconnect.ts): the row and its tokens
 * are deleted. The grant is already dead at TikTok, so no revoke call goes out.
 */
import { NextRequest } from "next/server";
import { POST as tiktokWebhook } from "@/app/api/webhooks/tiktok/route";
import { signTikTokWebhook } from "@/lib/oauth/tiktokWebhook";

jest.mock("@/lib/db", () => ({
  db: {
    creatorSocialAccount: {
      findMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

import { db } from "@/lib/db";

const mockDb = db as unknown as {
  creatorSocialAccount: {
    findMany: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
    count: jest.Mock;
  };
};

const URL = "https://campaign.madeboring.com/api/webhooks/tiktok";
const saved = {
  secret: process.env.TIKTOK_CLIENT_SECRET,
  sandbox: process.env.TIKTOK_SANDBOX_CLIENT_SECRET,
};
const originalFetch = global.fetch;

function event(name: string, openId = "open-id-fake-1") {
  return JSON.stringify({
    client_key: "ck",
    event: name,
    create_time: Math.floor(Date.now() / 1000),
    user_openid: openId,
    content: JSON.stringify({ reason: 1 }),
  });
}

function post(body: string, secret = "tt-secret") {
  return new NextRequest(URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "tiktok-signature": signTikTokWebhook(body, secret, Math.floor(Date.now() / 1000)),
    },
    body,
  });
}

const row = (id: string, orgId: string) => ({
  id,
  creatorId: `c-${id}`,
  platform: "TIKTOK",
  accessToken: "enc",
  origin: "oauth",
  creator: { orgId },
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TIKTOK_CLIENT_SECRET = "tt-secret";
  delete process.env.TIKTOK_SANDBOX_CLIENT_SECRET;
  mockDb.creatorSocialAccount.findMany.mockResolvedValue([row("sa-1", "org-1"), row("sa-2", "org-2")]);
  mockDb.creatorSocialAccount.delete.mockResolvedValue({});
  global.fetch = jest.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
  if (saved.secret === undefined) delete process.env.TIKTOK_CLIENT_SECRET;
  else process.env.TIKTOK_CLIENT_SECRET = saved.secret;
  if (saved.sandbox !== undefined) process.env.TIKTOK_SANDBOX_CLIENT_SECRET = saved.sandbox;
});

describe("POST /api/webhooks/tiktok", () => {
  it("disconnects every row for that open_id, in every org, without calling TikTok", async () => {
    const res = await tiktokWebhook(post(event("authorization.removed")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: 2 });

    const where = mockDb.creatorSocialAccount.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ platform: "TIKTOK", platformUserId: "open-id-fake-1" });
    expect(mockDb.creatorSocialAccount.delete.mock.calls.map((c) => c[0].where.id)).toEqual([
      "sa-1",
      "sa-2",
    ]);
    // Already revoked at TikTok: no revoke request.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a bad signature and touches nothing", async () => {
    const res = await tiktokWebhook(post(event("authorization.removed"), "not-our-secret"));
    expect(res.status).toBe(400);
    expect(mockDb.creatorSocialAccount.findMany).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.delete).not.toHaveBeenCalled();
  });

  it("rejects a request with no signature header", async () => {
    const res = await tiktokWebhook(
      new NextRequest(URL, { method: "POST", body: event("authorization.removed") }),
    );
    expect(res.status).toBe(400);
    expect(mockDb.creatorSocialAccount.delete).not.toHaveBeenCalled();
  });

  it("acknowledges other events with 200 and deletes nothing", async () => {
    const res = await tiktokWebhook(post(event("video.publish.complete")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: "video.publish.complete" });
    expect(mockDb.creatorSocialAccount.findMany).not.toHaveBeenCalled();
  });

  it("answers 500 when a row could not be removed, so TikTok retries", async () => {
    mockDb.creatorSocialAccount.delete
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("db down"));
    const res = await tiktokWebhook(post(event("authorization.removed")));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, removed: 1, failed: 1 });
  });

  it("removes nothing, and says so, when no row holds that open_id", async () => {
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([]);
    const res = await tiktokWebhook(post(event("authorization.removed", "open-id-unknown")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: 0 });
  });
});
