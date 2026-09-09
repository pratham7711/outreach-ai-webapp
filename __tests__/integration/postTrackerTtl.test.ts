/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST as trackPost } from "@/app/api/campaigns/[id]/posts/[postId]/track/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    post: { findFirst: jest.fn(), update: jest.fn() },
    organization: { findUnique: jest.fn() },
  },
}));

jest.mock("@/lib/authenticate", () => ({ authenticateRequest: jest.fn() }));
jest.mock("@/lib/platforms/fetchPostMetrics", () => ({ fetchPostMetrics: jest.fn() }));
jest.mock("@/lib/sync/syncPost", () => ({ applyPostMetrics: jest.fn() }));
jest.mock("@/lib/platforms/instagramToken", () => ({
  getInstagramAccountForCreator: jest.fn(),
}));
jest.mock("@/lib/platforms/tiktokToken", () => ({ getTikTokTokenForCreator: jest.fn() }));

import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";

const mockDb = db as any;
const mockAuth = authenticateRequest as jest.Mock;

const params = { params: Promise.resolve({ id: "camp-1", postId: "post-1" }) };

function req(body: unknown) {
  return new NextRequest("http://localhost/api/campaigns/camp-1/posts/post-1/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The data object the route handed to post.update. */
function updateData() {
  return mockDb.post.update.mock.calls[0][0].data;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockAuth.mockResolvedValue({ orgId: "org-1" });
  mockDb.campaign.findFirst.mockResolvedValue({ id: "camp-1" });
  mockDb.post.findFirst.mockResolvedValue({
    id: "post-1",
    platform: "INSTAGRAM",
    postUrl: "https://www.instagram.com/reel/AAA1/",
    creatorId: "creator-1",
  });
  mockDb.organization.findUnique.mockResolvedValue({ uiConfig: null });
  mockDb.post.update.mockResolvedValue({
    id: "post-1",
    trackingEnabled: true,
    trackingStartedAt: new Date(),
    trackingTtlDays: 30,
    trackingExpiresAt: new Date(),
  });
  (fetchPostMetrics as jest.Mock).mockResolvedValue(null);
});

describe("post tracker TTL — the expiry is not optional", () => {
  it("always writes an expiry, even when the caller names no TTL", async () => {
    const res = await trackPost(req({ enabled: true }), params);
    expect(res.status).toBe(200);

    const data = updateData();
    expect(data.trackingEnabled).toBe(true);
    expect(data.trackingExpiresAt).toBeInstanceOf(Date);
    // The org stored nothing, so the product default (the 30-day ceiling) lands.
    expect(data.trackingTtlDays).toBe(30);
  });

  it("honours a TTL the user chose", async () => {
    await trackPost(req({ enabled: true, ttlDays: 7 }), params);

    const data = updateData();
    expect(data.trackingTtlDays).toBe(7);
    const days =
      (data.trackingExpiresAt.getTime() - data.trackingStartedAt.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(7, 5);
  });

  it("refuses a TTL above the 30-day ceiling rather than silently clamping it", async () => {
    const res = await trackPost(req({ enabled: true, ttlDays: 90 }), params);
    expect(res.status).toBe(400);
    expect(mockDb.post.update).not.toHaveBeenCalled();
  });

  it("refuses a TTL below one day", async () => {
    const res = await trackPost(req({ enabled: true, ttlDays: 0 }), params);
    expect(res.status).toBe(400);
    expect(mockDb.post.update).not.toHaveBeenCalled();
  });

  it("takes the org's default when it has set one", async () => {
    mockDb.organization.findUnique.mockResolvedValue({
      uiConfig: { postTracking: { defaultTtlDays: 3 } },
    });

    await trackPost(req({ enabled: true }), params);
    expect(updateData().trackingTtlDays).toBe(3);
  });

  it("clears the window on untrack rather than leaving a stale expiry behind", async () => {
    await trackPost(req({ enabled: false }), params);

    const data = updateData();
    expect(data).toEqual({
      trackingEnabled: false,
      trackingStartedAt: null,
      trackingTtlDays: null,
      trackingExpiresAt: null,
    });
  });

  it("restarts the window when tracking is turned back on", async () => {
    await trackPost(req({ enabled: true, ttlDays: 1 }), params);

    const data = updateData();
    // Not resumed from an older start: a tracker turned back on is a new
    // instruction, and inheriting a stale expiry could end it before its first read.
    expect(data.trackingStartedAt.getTime()).toBeGreaterThan(Date.now() - 5000);
    expect(data.trackingExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
