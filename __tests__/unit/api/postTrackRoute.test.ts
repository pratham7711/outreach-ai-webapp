/**
 * @jest-environment node
 *
 * Switching tracking on must bring a dead-lettered post back.
 *
 * syncDisabledAt takes a post out of the sweep's own query, whatever the
 * tracker columns say. Before this route cleared it, a person could turn
 * tracking on, see "tracked", and the post would never be read again.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    post: { findFirst: jest.fn(), update: jest.fn() },
    organization: { findUnique: jest.fn() },
    postMetricSnapshot: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/authz", () => ({
  requirePermission: jest.fn(async () => ({ ok: true, auth: { orgId: "org-1", role: "OWNER" } })),
}));
jest.mock("@/lib/platforms/fetchPostMetrics", () => ({ fetchPostMetrics: jest.fn(async () => null) }));
jest.mock("@/lib/sync/syncPost", () => ({ applyPostMetrics: jest.fn() }));
jest.mock("@/lib/platforms/instagramToken", () => ({ getInstagramAccountForCreator: jest.fn() }));
jest.mock("@/lib/platforms/tiktokToken", () => ({ getTikTokTokenForCreator: jest.fn() }));

import { POST } from "@/app/api/campaigns/[id]/posts/[postId]/track/route";
import { db } from "@/lib/db";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>> & { $transaction: jest.Mock };
const params = { params: Promise.resolve({ id: "camp-1", postId: "post-1" }) };
const call = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/campaigns/camp-1/posts/post-1/track", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    params,
  );

const DEAD = new Date("2026-10-01T00:00:00Z");

beforeEach(() => {
  jest.clearAllMocks();
  mdb.campaign.findFirst.mockResolvedValue({ id: "camp-1", status: "IN_PROGRESS", archived: false, deletedAt: null });
  mdb.post.findFirst.mockResolvedValue({
    id: "post-1",
    platform: "YOUTUBE",
    creatorId: "cr-1",
    postUrl: "https://youtube.com/watch?v=x",
    syncFailCount: 5,
    syncDisabledAt: DEAD,
  });
  mdb.organization.findUnique.mockResolvedValue({ uiConfig: null });
  // The route hands the update to $transaction (enable) or awaits it (disable);
  // either way the row the client sees is the one the write produced.
  mdb.post.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "post-1",
    lastSyncedAt: null,
    postedAt: new Date(),
    syncDisabledAt: "syncDisabledAt" in data ? data.syncDisabledAt : DEAD,
    trackingEnabled: data.trackingEnabled,
    trackingStartedAt: data.trackingStartedAt,
    trackingTtlDays: data.trackingTtlDays,
    trackingExpiresAt: data.trackingExpiresAt,
  }));
  mdb.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
});

describe("POST /api/campaigns/[id]/posts/[postId]/track", () => {
  it("clears the dead letter and the fail streak when tracking is turned on", async () => {
    const res = await call({ enabled: true });
    expect(res.status).toBe(200);
    const data = mdb.post.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ trackingEnabled: true, syncDisabledAt: null, syncFailCount: 0 });
    // And the badge it answers with is the live one, not "dead-letter".
    expect((await res.json()).trackingEnabled).toBe(true);
  });

  it("does not touch the dead letter when tracking is turned off", async () => {
    const res = await call({ enabled: false });
    expect(res.status).toBe(200);
    const data = mdb.post.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("syncDisabledAt");
    expect(data).not.toHaveProperty("syncFailCount");
  });
});
