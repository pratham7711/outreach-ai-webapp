/**
 * @jest-environment node
 *
 * Restore (POST /api/campaigns/[id]/posts/restore): the other half of the soft
 * remove, behind the toast's Undo and the Removed view's Restore. Gated and
 * scoped exactly like the remove, all or nothing, idempotent, and refused when
 * the campaign already holds a live copy of the same post.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    post: { findMany: jest.fn(), updateMany: jest.fn() },
    /* The exclusion reason, cleared on restore (lib/posts/annotations). */
    postAnnotation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    /* View checks the exclusion marked reviewed, reopened on restore. */
    viewFraudFlag: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));

import { POST } from "@/app/api/campaigns/[id]/posts/restore/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { MAX_BULK_ACTION_POSTS } from "@/lib/posts/bulkActions";
import { duplicateLiveCopies } from "@/lib/posts/restoreChecks";

const mdb = db as unknown as {
  campaign: { findFirst: jest.Mock };
  post: { findMany: jest.Mock; updateMany: jest.Mock };
  postAnnotation: { updateMany: jest.Mock };
  viewFraudFlag: { updateMany: jest.Mock };
};

const REMOVED_AT = new Date("2026-10-13T10:00:00.000Z");
const post = (id: string, removedAt: Date | null = REMOVED_AT) => ({
  id,
  postUrl: `https://www.tiktok.com/@walk/video/7${id.replace(/\D/g, "").padStart(18, "0")}`,
  platform: "TIKTOK",
  platformPostId: id,
  creatorId: "cr-1",
  removedAt,
  removedById: removedAt ? "u-0" : null,
  creator: { handle: "@walk" },
});

/* The route reads twice: the selection (by id), then the campaign's live posts
   for the duplicate check (by removedAt null). Answer each by its where. */
function table(selected: ReturnType<typeof post>[], live: ReturnType<typeof post>[] = []) {
  mdb.post.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve("id" in where ? selected : live),
  );
}

function restore(body: unknown, campaignId = "camp-9") {
  return POST(
    new NextRequest(`http://localhost/api/campaigns/${campaignId}/posts/restore`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: campaignId }) },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (auth as jest.Mock).mockResolvedValue({ user: { id: "u-1", orgId: "org-1", role: "OWNER", email: "o@example.com" } });
  mdb.campaign.findFirst.mockResolvedValue({ id: "camp-9" });
  table([post("p1"), post("p2")]);
  mdb.post.updateMany.mockResolvedValue({ count: 2 });
});

describe("POST /api/campaigns/[id]/posts/restore", () => {
  it("clears removedAt on the removed posts, inside this campaign of the session's org", async () => {
    const res = await restore({ postIds: ["p1", "p2", "p1"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ restored: 2, postIds: ["p1", "p2"], reopenedChecks: 0 });

    expect(mdb.campaign.findFirst.mock.calls[0][0].where).toMatchObject({ id: "camp-9", orgId: "org-1", deletedAt: null });
    expect(mdb.post.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["p1", "p2"] }, campaignId: "camp-9" });
    expect(mdb.post.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2"] }, campaignId: "camp-9", removedAt: { not: null } },
      data: { removedAt: null, removedById: null },
    });
  });

  it("clears the exclusion reason of the posts it restored, in the session's org", async () => {
    await restore({ postIds: ["p1", "p2"] });
    expect(mdb.postAnnotation.updateMany).toHaveBeenCalledWith({
      where: { postId: { in: ["p1", "p2"] }, orgId: "org-1" },
      data: { exclusionReason: null },
    });
  });

  it("still answers 200 when clearing the reason fails, because the restore has landed", async () => {
    mdb.postAnnotation.updateMany.mockRejectedValueOnce(new Error("connection reset"));
    const res = await restore({ postIds: ["p1", "p2"] });
    expect(res.status).toBe(200);
  });

  it("reopens the view checks the exclusion marked reviewed, and only those", async () => {
    mdb.viewFraudFlag.updateMany.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 0 });
    const res = await restore({ postIds: ["p1", "p2"] });
    expect((await res.json()).reopenedChecks).toBe(2);

    expect(mdb.viewFraudFlag.updateMany).toHaveBeenCalledTimes(2);
    expect(mdb.viewFraudFlag.updateMany.mock.calls[0][0]).toEqual({
      where: {
        orgId: "org-1",
        campaignId: "camp-9",
        postId: "p1",
        isResolved: true,
        resolvedAt: { gte: REMOVED_AT, lte: new Date(REMOVED_AT.getTime() + 10 * 60 * 1000) },
      },
      data: { isResolved: false, resolvedAt: null, resolvedBy: null },
    });
    expect(mdb.viewFraudFlag.updateMany.mock.calls[1][0].where.postId).toBe("p2");
  });

  it("reopens nothing for a post that was not removed", async () => {
    table([post("p1", null)]);
    await restore({ postIds: ["p1"] });
    expect(mdb.viewFraudFlag.updateMany).not.toHaveBeenCalled();
  });

  it("still answers 200 when reopening the checks fails, because the restore has landed", async () => {
    mdb.viewFraudFlag.updateMany.mockRejectedValueOnce(new Error("connection reset"));
    const res = await restore({ postIds: ["p1", "p2"] });
    expect(res.status).toBe(200);
  });

  it("takes the org from the session, never from the body", async () => {
    await restore({ postIds: ["p1", "p2"], orgId: "org-other", campaignId: "camp-other" });
    expect(mdb.campaign.findFirst.mock.calls[0][0].where).toMatchObject({ id: "camp-9", orgId: "org-1" });
    expect(mdb.post.updateMany.mock.calls[0][0].where.campaignId).toBe("camp-9");
  });

  it("writes one post.restore audit line per restored post", async () => {
    await restore({ postIds: ["p1", "p2"] });
    expect(logAudit).toHaveBeenCalledTimes(2);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        userId: "u-1",
        action: "post.restore",
        entityType: "post",
        entityId: "p1",
        metadata: { campaignId: "camp-9", batch: 2 },
        before: { removedAt: REMOVED_AT.toISOString(), removedById: "u-0" },
        after: { removedAt: null },
      }),
    );
  });

  it("is idempotent: a post that is not removed is left alone and not counted", async () => {
    table([post("p1"), post("p2", null)]);
    mdb.post.updateMany.mockResolvedValue({ count: 1 });
    const res = await restore({ postIds: ["p1", "p2"] });
    expect(await res.json()).toEqual({ restored: 1, postIds: ["p1"], reopenedChecks: 0 });
    expect(mdb.post.updateMany.mock.calls[0][0].where.id).toEqual({ in: ["p1"] });
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when nothing in the selection is removed -- an Undo pressed twice", async () => {
    table([post("p1", null)]);
    const res = await restore({ postIds: ["p1"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ restored: 0, postIds: [], reopenedChecks: 0 });
    expect(mdb.post.updateMany).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses a VIEWER and a signed-out caller, and restores nothing", async () => {
    (auth as jest.Mock).mockResolvedValueOnce(null);
    expect((await restore({ postIds: ["p1"] })).status).toBe(401);
    (auth as jest.Mock).mockResolvedValueOnce({ user: { id: "u-2", orgId: "org-1", role: "VIEWER" } });
    expect((await restore({ postIds: ["p1"] })).status).toBe(403);
    expect(mdb.post.updateMany).not.toHaveBeenCalled();
  });

  it("answers 404 for a campaign outside the caller's org or scope", async () => {
    mdb.campaign.findFirst.mockResolvedValue(null);
    expect((await restore({ postIds: ["p1"] })).status).toBe(404);
    expect(mdb.post.findMany).not.toHaveBeenCalled();
    expect(mdb.post.updateMany).not.toHaveBeenCalled();
  });

  it("is all or nothing when an id is not a post of this campaign", async () => {
    table([post("p1")]);
    expect((await restore({ postIds: ["p1", "elsewhere"] })).status).toBe(404);
    expect(mdb.post.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an empty, malformed or oversized selection", async () => {
    for (const body of [{}, { postIds: [] }, { postIds: "p1" }, { postIds: Array.from({ length: MAX_BULK_ACTION_POSTS + 1 }, (_, i) => `p${i}`) }]) {
      expect((await restore(body)).status).toBe(400);
    }
    expect(mdb.post.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to restore a post the campaign already has a live copy of, naming which", async () => {
    const live = { ...post("p9", null), postUrl: `${post("p2").postUrl}?is_from_webapp=1` };
    table([post("p1"), post("p2")], [live]);
    const res = await restore({ postIds: ["p1", "p2"] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "duplicate_post", postIds: ["p2"] });
    expect(mdb.post.findMany.mock.calls[1][0].where).toEqual({ campaignId: "camp-9", removedAt: null });
    expect(mdb.post.updateMany).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("duplicateLiveCopies", () => {
  it("asks nothing when there is nothing to restore", async () => {
    expect(await duplicateLiveCopies("camp-9", [])).toEqual([]);
    expect(mdb.post.findMany).not.toHaveBeenCalled();
  });

  it("matches by the platform's video id, not the URL string", async () => {
    const a = post("p1");
    mdb.post.findMany.mockResolvedValue([{ platform: "TIKTOK", postUrl: `${a.postUrl}?sender_device=pc` }]);
    expect(await duplicateLiveCopies("camp-9", [a, post("p2")])).toEqual(["p1"]);
  });

  it("lets only one of two removed copies of the same video back", async () => {
    mdb.post.findMany.mockResolvedValue([]);
    const a = post("p1");
    const b = { ...post("p1"), id: "p1-copy" };
    expect(await duplicateLiveCopies("camp-9", [a, b])).toEqual(["p1-copy"]);
  });
});
