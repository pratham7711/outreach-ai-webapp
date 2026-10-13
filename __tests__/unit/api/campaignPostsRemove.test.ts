/**
 * @jest-environment node
 *
 * Remove from campaign (DELETE /api/campaigns/[id]/posts): org- and
 * scope-checked like adding a post, all or nothing, refused when earnings are
 * recorded against a post, and one audit line per removed post.
 */
import { NextRequest } from "next/server";

const mockTx = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    post: { findMany: jest.fn(), deleteMany: jest.fn((args: unknown) => ({ op: "post.deleteMany", args })) },
    viewLedger: { findMany: jest.fn() },
    viewFraudFlag: { deleteMany: jest.fn((args: unknown) => ({ op: "viewFraudFlag.deleteMany", args })) },
    $transaction: (...args: unknown[]) => mockTx(...args),
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));

import { DELETE } from "@/app/api/campaigns/[id]/posts/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { MAX_BULK_ACTION_POSTS, removeConfirmText, removePostsSummary, removablePostIds } from "@/lib/posts/bulkActions";

const mdb = db as unknown as {
  campaign: { findFirst: jest.Mock };
  post: { findMany: jest.Mock; deleteMany: jest.Mock };
  viewLedger: { findMany: jest.Mock };
  viewFraudFlag: { deleteMany: jest.Mock };
};

const post = (id: string) => ({
  id,
  postUrl: `https://www.tiktok.com/@walk/video/${id}`,
  platform: "TIKTOK",
  platformPostId: id,
  creatorId: "cr-1",
  status: "PENDING_REVIEW",
  viewsCount: 10,
  creator: { handle: "@walk" },
});

function del(body: unknown, campaignId = "camp-9") {
  return DELETE(
    new NextRequest(`http://localhost/api/campaigns/${campaignId}/posts`, { method: "DELETE", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: campaignId }) },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (auth as jest.Mock).mockResolvedValue({ user: { id: "u-1", orgId: "org-1", role: "OWNER", email: "o@example.com" } });
  mdb.campaign.findFirst.mockResolvedValue({ id: "camp-9", title: "C" });
  mdb.post.findMany.mockResolvedValue([post("p1"), post("p2")]);
  mdb.viewLedger.findMany.mockResolvedValue([]);
  mockTx.mockResolvedValue([{ count: 0 }, { count: 2 }]);
});

describe("DELETE /api/campaigns/[id]/posts", () => {
  it("removes the posts and their fraud flags in one transaction, scoped to the campaign and org", async () => {
    const res = await del({ postIds: ["p1", "p2", "p1"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 2 });

    expect(mdb.campaign.findFirst.mock.calls[0][0].where).toMatchObject({ id: "camp-9", orgId: "org-1", deletedAt: null });
    expect(mdb.post.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["p1", "p2"] }, campaignId: "camp-9" });
    const [ops] = mockTx.mock.calls[0];
    expect(ops).toEqual([
      { op: "viewFraudFlag.deleteMany", args: { where: { orgId: "org-1", campaignId: "camp-9", postId: { in: ["p1", "p2"] } } } },
      { op: "post.deleteMany", args: { where: { id: { in: ["p1", "p2"] }, campaignId: "camp-9" } } },
    ]);
  });

  it("writes one post.delete audit line per post, keeping the URL", async () => {
    await del({ postIds: ["p1", "p2"] });
    expect(logAudit).toHaveBeenCalledTimes(2);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        action: "post.delete",
        entityType: "post",
        entityId: "p1",
        metadata: { campaignId: "camp-9", batch: 2 },
        before: expect.objectContaining({ postUrl: "https://www.tiktok.com/@walk/video/p1", viewsCount: 10 }),
      }),
    );
  });

  it("refuses a VIEWER and a signed-out caller, and deletes nothing", async () => {
    (auth as jest.Mock).mockResolvedValueOnce(null);
    expect((await del({ postIds: ["p1"] })).status).toBe(401);
    (auth as jest.Mock).mockResolvedValueOnce({ user: { id: "u-2", orgId: "org-1", role: "VIEWER" } });
    expect((await del({ postIds: ["p1"] })).status).toBe(403);
    expect(mockTx).not.toHaveBeenCalled();
  });

  it("answers 404 for a campaign outside the caller's org or scope", async () => {
    mdb.campaign.findFirst.mockResolvedValue(null);
    expect((await del({ postIds: ["p1"] })).status).toBe(404);
    expect(mockTx).not.toHaveBeenCalled();
  });

  it("is all or nothing when an id is not a post of this campaign", async () => {
    mdb.post.findMany.mockResolvedValue([post("p1")]);
    expect((await del({ postIds: ["p1", "elsewhere"] })).status).toBe(404);
    expect(mockTx).not.toHaveBeenCalled();
  });

  it("refuses to remove a post with earnings recorded, naming which", async () => {
    mdb.viewLedger.findMany.mockResolvedValue([{ postId: "p2" }]);
    const res = await del({ postIds: ["p1", "p2"] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "has_earnings", postIds: ["p2"] });
    expect(mdb.viewLedger.findMany.mock.calls[0][0].where).toEqual({ orgId: "org-1", campaignId: "camp-9", postId: { in: ["p1", "p2"] } });
    expect(mockTx).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses an empty, malformed or oversized selection", async () => {
    for (const body of [{}, { postIds: [] }, { postIds: "p1" }, { postIds: Array.from({ length: MAX_BULK_ACTION_POSTS + 1 }, (_, i) => `p${i}`) }]) {
      expect((await del(body)).status).toBe(400);
    }
    expect(mockTx).not.toHaveBeenCalled();
  });
});

describe("remove helpers", () => {
  it("de-duplicates and trims ids, and rejects what is not a list of ids", () => {
    expect(removablePostIds([" a ", "a", "b", 3, ""])).toEqual(["a", "b"]);
    expect(removablePostIds(null)).toBeNull();
    expect(removablePostIds(["x".repeat(101)])).toBeNull();
  });

  it("names the count in the confirmation and the summary", () => {
    expect(removeConfirmText(1)).toMatchObject({ title: "Remove 1 post from this campaign?", confirmLabel: "Remove 1 post" });
    expect(removeConfirmText(3).title).toBe("Remove 3 posts from this campaign?");
    expect(removeConfirmText(3).description).toMatch(/can't be undone/);
    expect(removePostsSummary(2)).toBe("Removed 2 posts from this campaign.");
  });
});
