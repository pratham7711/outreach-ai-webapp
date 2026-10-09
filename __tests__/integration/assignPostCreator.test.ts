/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { PUT } from "@/app/api/campaigns/[id]/posts/[postId]/creator/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    creator: { findFirst: jest.fn() },
    post: { findFirst: jest.fn(), update: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/sync/syncPost", () => ({ syncPost: jest.fn() }));
jest.mock("@/lib/platforms/tiktokEgress", () => ({ openTikTokPostFetcherForOne: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { syncPost } from "@/lib/sync/syncPost";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;
const mockSync = syncPost as jest.Mock;

const HOLDING = { id: "unattr-ig", name: "Unattributed Instagram posts", handle: "" };
const JANE = { id: "c-jane", name: "Jane", handle: "jane", platform: "INSTAGRAM" };
const POST = {
  id: "p1",
  campaignId: "camp-1",
  creatorId: HOLDING.id,
  platform: "INSTAGRAM",
  postUrl: "https://www.instagram.com/reel/ABC123/",
  creator: HOLDING,
};

function put(body: unknown) {
  return PUT(
    new NextRequest("http://localhost/api/campaigns/camp-1/posts/p1/creator", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "camp-1", postId: "p1" }) },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1", orgId: "org-1", role: "ADMIN" } });
  mockDb.campaign.findFirst.mockResolvedValue({ id: "camp-1" });
  mockDb.post.findFirst.mockResolvedValue(POST);
  mockDb.creator.findFirst.mockResolvedValue(JANE);
  mockDb.post.update.mockImplementation(({ data }: any) => {
    const { creator: _c, ...row } = POST;
    return Promise.resolve({ ...row, ...data });
  });
  mockSync.mockResolvedValue({ status: "measured", post: { id: "p1", creatorId: JANE.id, viewsCount: 1200 } });
});

describe("PUT /api/campaigns/[id]/posts/[postId]/creator", () => {
  it("files an unattributed post under the chosen creator and reads it under them", async () => {
    const res = await put({ creatorId: JANE.id });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockDb.post.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { creatorId: JANE.id } });
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", creatorId: JANE.id }), "org-1", expect.anything());
    expect(body).toMatchObject({ metricsFound: true, viewsCount: 1200, creator: { id: JANE.id, handle: "jane" } });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "post.creator_assigned",
        before: { creatorId: HOLDING.id },
        after: { creatorId: JANE.id },
      }),
    );
  });

  it("looks the creator up inside the session's org only", async () => {
    await put({ creatorId: JANE.id });
    expect(mockDb.creator.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: JANE.id, orgId: "org-1", deletedAt: null } }),
    );
    expect(mockDb.campaign.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "camp-1", orgId: "org-1", deletedAt: null }) }),
    );
  });

  it("refuses to move a post that already has a real creator", async () => {
    mockDb.post.findFirst.mockResolvedValue({ ...POST, creatorId: "c-other", creator: { id: "c-other", name: "Other", handle: "other" } });
    const res = await put({ creatorId: JANE.id });
    expect(res.status).toBe(409);
    expect(mockDb.post.update).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("refuses a creator from another org, a deleted one, or the holding row itself", async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);
    expect((await put({ creatorId: "c-elsewhere" })).status).toBe(404);

    mockDb.creator.findFirst.mockResolvedValue({ ...HOLDING, platform: "INSTAGRAM" });
    expect((await put({ creatorId: HOLDING.id })).status).toBe(404);
    expect(mockDb.post.update).not.toHaveBeenCalled();
  });

  it("keeps the assignment when the read after it comes back empty or throws", async () => {
    mockSync.mockResolvedValueOnce({ status: "no-metrics", post: { id: "p1", creatorId: JANE.id }, reason: "backing-off" });
    let res = await put({ creatorId: JANE.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ metricsFound: false, reason: "backing-off", creatorId: JANE.id });

    mockSync.mockRejectedValueOnce(new Error("graph down"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    res = await put({ creatorId: JANE.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ metricsFound: false, creatorId: JANE.id });
    expect(mockDb.post.update).toHaveBeenCalledTimes(2);
  });

  it("asks for a creator when none is sent, and checks the session first", async () => {
    expect((await put({})).status).toBe(400);
    mockAuth.mockResolvedValue(null);
    expect((await put({ creatorId: JANE.id })).status).toBe(401);
  });

  it("404s a post outside the campaign", async () => {
    mockDb.post.findFirst.mockResolvedValue(null);
    expect((await put({ creatorId: JANE.id })).status).toBe(404);
  });
});
