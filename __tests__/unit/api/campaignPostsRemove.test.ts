/**
 * @jest-environment node
 *
 * Remove from campaign (DELETE /api/campaigns/[id]/posts): org- and
 * scope-checked like adding a post, all or nothing, refused when earnings are
 * recorded against a post, and one audit line per removed post.
 *
 * The remove is soft: it stamps removedAt/removedById and deletes nothing --
 * not the row, not its fraud flags, not its readings -- so the toast's Undo and
 * the Removed view's Restore can bring the post back whole.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    post: { findMany: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
    viewLedger: { findMany: jest.fn() },
    viewFraudFlag: { deleteMany: jest.fn() },
    postAnnotation: { upsert: jest.fn() },
    campaignRules: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));

import { DELETE } from "@/app/api/campaigns/[id]/posts/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import {
  MAX_BULK_ACTION_POSTS,
  removeConfirmText,
  removePostsSummary,
  removePostsUndoHint,
  removablePostIds,
  restorePostsSummary,
} from "@/lib/posts/bulkActions";

const mdb = db as unknown as {
  campaign: { findFirst: jest.Mock };
  post: { findMany: jest.Mock; updateMany: jest.Mock; deleteMany: jest.Mock };
  viewLedger: { findMany: jest.Mock };
  viewFraudFlag: { deleteMany: jest.Mock };
  postAnnotation: { upsert: jest.Mock };
  campaignRules: { findFirst: jest.Mock };
  $transaction: jest.Mock;
};

const post = (id: string, removedAt: Date | null = null) => ({
  id,
  postUrl: `https://www.tiktok.com/@walk/video/${id}`,
  platform: "TIKTOK",
  platformPostId: id,
  creatorId: "cr-1",
  status: "PENDING_REVIEW",
  viewsCount: 10,
  removedAt,
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
  mdb.post.updateMany.mockResolvedValue({ count: 2 });
  mdb.postAnnotation.upsert.mockImplementation((args: unknown) => args);
  mdb.$transaction.mockImplementation(async (ops: unknown[]) => ops);
  // The campaign has exclusions switched on unless a test says otherwise.
  mdb.campaignRules.findFirst.mockResolvedValue({ allowExclusions: true });
});

describe("DELETE /api/campaigns/[id]/posts", () => {
  it("stamps the posts removed, scoped to the campaign and org, and deletes nothing", async () => {
    const res = await del({ postIds: ["p1", "p2", "p1"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 2, postIds: ["p1", "p2"] });

    expect(mdb.campaign.findFirst.mock.calls[0][0].where).toMatchObject({ id: "camp-9", orgId: "org-1", deletedAt: null });
    expect(mdb.post.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["p1", "p2"] }, campaignId: "camp-9" });
    expect(mdb.post.updateMany).toHaveBeenCalledTimes(1);
    const { where, data } = mdb.post.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: { in: ["p1", "p2"] }, campaignId: "camp-9", removedAt: null });
    expect(data).toEqual({ removedAt: expect.any(Date), removedById: "u-1" });

    // The readings, flags and row all stay, for the Undo.
    expect(mdb.post.deleteMany).not.toHaveBeenCalled();
    expect(mdb.viewFraudFlag.deleteMany).not.toHaveBeenCalled();
    expect(mdb.$transaction).not.toHaveBeenCalled();
  });

  it("is idempotent: an already-removed post is neither restamped, counted nor handed to Undo", async () => {
    const earlier = new Date("2026-10-01T00:00:00.000Z");
    mdb.post.findMany.mockResolvedValue([post("p1", earlier), post("p2")]);
    mdb.post.updateMany.mockResolvedValue({ count: 1 });
    const res = await del({ postIds: ["p1", "p2"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 1, postIds: ["p2"] });
    expect(mdb.post.updateMany.mock.calls[0][0].where.id).toEqual({ in: ["p2"] });
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ entityId: "p2" }));
  });

  it("writes nothing when every post was already removed", async () => {
    mdb.post.findMany.mockResolvedValue([post("p1", new Date())]);
    const res = await del({ postIds: ["p1"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 0, postIds: [] });
    expect(mdb.post.updateMany).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("writes one post.remove audit line per post, keeping the URL", async () => {
    await del({ postIds: ["p1", "p2"] });
    expect(logAudit).toHaveBeenCalledTimes(2);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        action: "post.remove",
        entityType: "post",
        entityId: "p1",
        metadata: { campaignId: "camp-9", batch: 2 },
        before: expect.objectContaining({ postUrl: "https://www.tiktok.com/@walk/video/p1", viewsCount: 10 }),
      }),
    );
  });

  it("keeps the reason given, on each removed post and in the audit line", async () => {
    const res = await del({ postIds: ["p1", "p2"], reason: "  Views bought;   engagement flat " });
    expect(res.status).toBe(200);
    const upserts = mdb.postAnnotation.upsert.mock.calls.map((c) => c[0]);
    expect(upserts).toEqual([
      expect.objectContaining({ where: { postId: "p1" }, create: { postId: "p1", orgId: "org-1", exclusionReason: "Views bought; engagement flat" } }),
      expect.objectContaining({ where: { postId: "p2" }, update: { exclusionReason: "Views bought; engagement flat" } }),
    ]);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "post.remove", metadata: expect.objectContaining({ reason: "Views bought; engagement flat" }) })
    );
  });

  it("refuses a reason while the campaign has exclusions off, and removes nothing", async () => {
    mdb.campaignRules.findFirst.mockResolvedValueOnce({ allowExclusions: false });
    const res = await del({ postIds: ["p1"], reason: "Views bought" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("exclusions_off");
    expect(mdb.post.updateMany).not.toHaveBeenCalled();
    expect(mdb.postAnnotation.upsert).not.toHaveBeenCalled();
    expect(mdb.campaignRules.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: "camp-9", orgId: "org-1" } })
    );
  });

  it("treats a campaign with no settings row, or no table yet, as exclusions off", async () => {
    mdb.campaignRules.findFirst.mockResolvedValueOnce(null);
    expect((await del({ postIds: ["p1"], reason: "Views bought" })).status).toBe(403);
    mdb.campaignRules.findFirst.mockRejectedValueOnce(Object.assign(new Error("The table `public.CampaignRules` does not exist"), { code: "P2021" }));
    expect((await del({ postIds: ["p1"], reason: "Views bought" })).status).toBe(403);
    expect(mdb.post.updateMany).not.toHaveBeenCalled();
  });

  it("still removes without a reason when exclusions are off: the plain remove is unchanged", async () => {
    mdb.campaignRules.findFirst.mockResolvedValue({ allowExclusions: false });
    expect((await del({ postIds: ["p1", "p2"] })).status).toBe(200);
    expect(mdb.post.updateMany).toHaveBeenCalled();
    expect(mdb.campaignRules.findFirst).not.toHaveBeenCalled();
  });

  it("stores no reason when none is given", async () => {
    await del({ postIds: ["p1", "p2"] });
    expect(mdb.postAnnotation.upsert).not.toHaveBeenCalled();
  });

  it("refuses a reason over 200 characters, and removes nothing", async () => {
    const res = await del({ postIds: ["p1"], reason: "x".repeat(201) });
    expect(res.status).toBe(400);
    expect(mdb.post.updateMany).not.toHaveBeenCalled();
  });

  it("still answers 200 when the reason fails to save, because the posts are removed", async () => {
    mdb.$transaction.mockRejectedValueOnce(new Error("connection reset"));
    expect((await del({ postIds: ["p1", "p2"], reason: "dupe" })).status).toBe(200);
  });

  it("refuses a VIEWER and a signed-out caller, and deletes nothing", async () => {
    (auth as jest.Mock).mockResolvedValueOnce(null);
    expect((await del({ postIds: ["p1"] })).status).toBe(401);
    (auth as jest.Mock).mockResolvedValueOnce({ user: { id: "u-2", orgId: "org-1", role: "VIEWER" } });
    expect((await del({ postIds: ["p1"] })).status).toBe(403);
    expect(mdb.post.updateMany).not.toHaveBeenCalled();
  });

  it("answers 404 for a campaign outside the caller's org or scope", async () => {
    mdb.campaign.findFirst.mockResolvedValue(null);
    expect((await del({ postIds: ["p1"] })).status).toBe(404);
    expect(mdb.post.updateMany).not.toHaveBeenCalled();
  });

  it("is all or nothing when an id is not a post of this campaign", async () => {
    mdb.post.findMany.mockResolvedValue([post("p1")]);
    expect((await del({ postIds: ["p1", "elsewhere"] })).status).toBe(404);
    expect(mdb.post.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to remove a post with earnings recorded, naming which", async () => {
    mdb.viewLedger.findMany.mockResolvedValue([{ postId: "p2" }]);
    const res = await del({ postIds: ["p1", "p2"] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "has_earnings", postIds: ["p2"] });
    expect(mdb.viewLedger.findMany.mock.calls[0][0].where).toEqual({ orgId: "org-1", campaignId: "camp-9", postId: { in: ["p1", "p2"] } });
    expect(mdb.post.updateMany).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses an empty, malformed or oversized selection", async () => {
    for (const body of [{}, { postIds: [] }, { postIds: "p1" }, { postIds: Array.from({ length: MAX_BULK_ACTION_POSTS + 1 }, (_, i) => `p${i}`) }]) {
      expect((await del(body)).status).toBe(400);
    }
    expect(mdb.post.updateMany).not.toHaveBeenCalled();
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
    expect(removePostsSummary(2)).toBe("Removed 2 posts from this campaign.");
  });

  it("no longer calls the removal permanent, and says where to get it back", () => {
    for (const n of [1, 3]) {
      const { description } = removeConfirmText(n);
      expect(description).not.toMatch(/can't be undone|cannot be undone|permanent|delete/i);
      expect(description).toMatch(/undo/i);
      expect(description).toMatch(/Removed/);
    }
    expect(removePostsUndoHint(1)).toBe("Undo now, or restore it later from Removed.");
    expect(removePostsUndoHint(3)).toBe("Undo now, or restore them later from Removed.");
    expect(restorePostsSummary(1)).toBe("Restored 1 post to this campaign.");
    expect(restorePostsSummary(3)).toBe("Restored 3 posts to this campaign.");
  });
});
