/**
 * @jest-environment node
 *
 * PUT /api/portal/campaigns/[slug]/submissions/[postId]/boost-code -- a creator
 * adds or changes the ad-authorization code on one of their own live posts.
 */
import { NextRequest } from "next/server";
import { PUT } from "@/app/api/portal/campaigns/[slug]/submissions/[postId]/boost-code/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findUnique: jest.fn() },
    creator: { findFirst: jest.fn(), findMany: jest.fn() },
    activation: { findFirst: jest.fn() },
    post: { findFirst: jest.fn() },
    postAnnotation: { upsert: jest.fn() },
    campaignRules: { findFirst: jest.fn() },
  },
}));
jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));

import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";

const mockDb = db as any;
const mockSession = getCreatorSession as jest.Mock;

const put = (body: Record<string, unknown>, postId = "post-1") =>
  PUT(
    new NextRequest(`http://localhost/api/portal/campaigns/summer-drop/submissions/${postId}/boost-code`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: "summer-drop", postId }) }
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue({ creatorUserId: "cu-1", handle: "awxyken" });
  mockDb.campaign.findUnique.mockResolvedValue({ id: "camp-1", orgId: "org-1", deletedAt: null, marketplaceVisibility: "GLOBAL" });
  mockDb.creator.findMany.mockResolvedValue([]);
  mockDb.creator.findFirst.mockResolvedValue({ id: "cr-1" });
  mockDb.activation.findFirst.mockResolvedValue({ id: "act-1", creatorId: "cr-1", status: "ACCEPTED" });
  mockDb.post.findFirst.mockResolvedValue({ id: "post-1" });
  mockDb.postAnnotation.upsert.mockResolvedValue({});
  mockDb.campaignRules.findFirst.mockResolvedValue({ allowBoostCodes: true, allowExclusions: false });
});

it("403s while the campaign has boost codes off, writing nothing", async () => {
  mockDb.campaignRules.findFirst.mockResolvedValue({ allowBoostCodes: false, allowExclusions: false });
  const res = await put({ boostCode: "SPARK-1" });
  expect(res.status).toBe(403);
  expect((await res.json()).code).toBe("boost_codes_off");
  expect(mockDb.postAnnotation.upsert).not.toHaveBeenCalled();
});

it("403s while the rules table is missing (boost codes are off)", async () => {
  mockDb.campaignRules.findFirst.mockRejectedValue(Object.assign(new Error("missing"), { code: "P2021" }));
  expect((await put({ boostCode: "SPARK-1" })).status).toBe(403);
});

it("401s without a creator session", async () => {
  mockSession.mockResolvedValue(null);
  expect((await put({ boostCode: "X" })).status).toBe(401);
});

it("saves a trimmed code with its expiry on the creator's own live post", async () => {
  const res = await put({ boostCode: "  SPARK-1 ", boostCodeExpiresAt: "2026-12-01" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ boostCode: "SPARK-1", boostCodeExpiresAt: "2026-12-01T00:00:00.000Z" });
  expect(mockDb.post.findFirst.mock.calls[0][0].where).toEqual({
    id: "post-1",
    campaignId: "camp-1",
    activationId: "act-1",
    removedAt: null,
  });
  expect(mockDb.postAnnotation.upsert.mock.calls[0][0].update).toEqual({
    boostCode: "SPARK-1",
    boostCodeExpiresAt: new Date("2026-12-01"),
  });
});

it("clears the code, and its expiry with it, when sent empty", async () => {
  await put({ boostCode: "", boostCodeExpiresAt: "2026-12-01" });
  expect(mockDb.postAnnotation.upsert.mock.calls[0][0].update).toEqual({ boostCode: null, boostCodeExpiresAt: null });
});

it("404s a post that is not this creator's live submission on this campaign", async () => {
  mockDb.post.findFirst.mockResolvedValue(null);
  expect((await put({ boostCode: "X" }, "someone-elses")).status).toBe(404);
  expect(mockDb.postAnnotation.upsert).not.toHaveBeenCalled();
});

it("404s a creator who is not on the campaign", async () => {
  mockDb.creator.findFirst.mockResolvedValue(null);
  mockDb.activation.findFirst.mockResolvedValue(null);
  expect((await put({ boostCode: "X" })).status).toBe(404);
  expect(mockDb.post.findFirst).not.toHaveBeenCalled();
});

it("400s a code that is too long or an expiry that is not a date", async () => {
  expect((await put({ boostCode: "x".repeat(301) })).status).toBe(400);
  expect((await put({ boostCode: "X", boostCodeExpiresAt: "next week-ish" })).status).toBe(400);
  expect(mockDb.postAnnotation.upsert).not.toHaveBeenCalled();
});

it("503s while the table does not exist yet", async () => {
  mockDb.postAnnotation.upsert.mockRejectedValue(Object.assign(new Error("missing"), { code: "P2021" }));
  expect((await put({ boostCode: "X" })).status).toBe(503);
});
