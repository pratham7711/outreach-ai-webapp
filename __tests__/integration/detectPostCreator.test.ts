/**
 * @jest-environment node
 *
 * A post filed with no creator gets one without anybody being asked: from the
 * read that just ran, from another copy of the same post, from the post's own
 * public page, or from the campaign's own creators' media -- in that order.
 */
jest.mock("@/lib/db", () => ({
  db: {
    post: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    activation: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/posts/addPostChecks", () => ({
  ensureCreatorForHandle: jest.fn(),
  findExistingPosts: jest.fn(),
}));
jest.mock("@/lib/platforms/instagramBusinessDiscovery", () => ({ findInstagramPostOwner: jest.fn() }));
jest.mock("@/lib/platforms/instagramPostPage", () => ({ readInstagramPostPageOwner: jest.fn() }));
jest.mock("@/lib/platforms/instagramDiscoveryTokens", () => ({
  readWithDiscoveryToken: jest.fn(async (read: (c: unknown) => Promise<unknown>) => ({
    ok: true,
    value: await read({ slot: "A", token: "tok", graphOptions: {} }),
  })),
}));

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { ensureCreatorForHandle, findExistingPosts } from "@/lib/posts/addPostChecks";
import { findInstagramPostOwner } from "@/lib/platforms/instagramBusinessDiscovery";
import { readInstagramPostPageOwner } from "@/lib/platforms/instagramPostPage";
import { InstagramRateLimitError } from "@/lib/platforms/instagram";
import { detectPostCreator, MAX_OWNER_CANDIDATES } from "@/lib/posts/detectCreator";

const mockDb = db as any;
const ensure = ensureCreatorForHandle as jest.Mock;
const existing = findExistingPosts as jest.Mock;
const owner = findInstagramPostOwner as jest.Mock;
const postPage = readInstagramPostPageOwner as jest.Mock;

const URL = "https://www.instagram.com/reel/ABC123/";
const HOLDING = { name: "Unattributed Instagram posts", handle: "" };
const ROW = { id: "p1", campaignId: "camp-1", platform: "INSTAGRAM", creatorId: "unattr-ig", creator: HOLDING };

function creator(id: string, handle: string) {
  return { creator: { id, name: handle, handle, platform: "INSTAGRAM", profileLinks: [] } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.post.findFirst.mockResolvedValue(ROW);
  mockDb.post.updateMany.mockResolvedValue({ count: 1 });
  mockDb.post.findMany.mockResolvedValue([]);
  mockDb.activation.findMany.mockResolvedValue([]);
  existing.mockResolvedValue([]);
  owner.mockResolvedValue(null);
  postPage.mockResolvedValue(null);
});

describe("detectPostCreator", () => {
  it("leaves a post that already has a creator alone", async () => {
    mockDb.post.findFirst.mockResolvedValue({ ...ROW, creatorId: "c-jane", creator: { name: "Jane", handle: "jane" } });
    expect(await detectPostCreator({ id: "p1", postUrl: URL, authorHandle: "someone" }, "org-1")).toBeNull();
    expect(mockDb.post.updateMany).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  });

  it("looks only inside the caller's org", async () => {
    mockDb.post.findFirst.mockResolvedValue(null);
    expect(await detectPostCreator({ id: "p1", postUrl: URL, authorHandle: "jane" }, "org-1")).toBeNull();
    expect(mockDb.post.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1", campaign: { orgId: "org-1" } } }),
    );
  });

  it("files the post under the owner the read named, adding them to the roster if new", async () => {
    ensure.mockResolvedValue({ creator: { id: "c-new", name: "jane", handle: "jane" }, created: true });
    const out = await detectPostCreator({ id: "p1", postUrl: URL, authorHandle: "@jane" }, "org-1");

    expect(ensure).toHaveBeenCalledWith("org-1", "jane", "INSTAGRAM");
    expect(mockDb.post.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", creatorId: "unattr-ig" },
      data: { creatorId: "c-new" },
    });
    expect(out).toEqual({
      creatorId: "c-new",
      handle: "jane",
      source: "post-read",
      created: true,
      movedPostIds: ["p1"],
    });
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        actorType: "system:creator-detection",
        action: "post.creator_detected",
        entityId: "p1",
        metadata: expect.objectContaining({ source: "post-read", creatorCreated: true }),
        before: { creatorId: "unattr-ig" },
        after: { creatorId: "c-new" },
      }),
    );
  });

  it("sends no notification: nothing it writes is in the notification catalog", async () => {
    const { isNotifiableAction } = jest.requireActual("@/lib/notificationCatalog");
    ensure.mockResolvedValue({ creator: { id: "c-new", name: "jane", handle: "jane" }, created: true });
    await detectPostCreator({ id: "p1", postUrl: URL, authorHandle: "jane" }, "org-1");
    for (const [entry] of (logAudit as jest.Mock).mock.calls) expect(isNotifiableAction(entry.action)).toBe(false);
  });

  it("moves every other unattributed copy of the same post with it", async () => {
    ensure.mockResolvedValue({ creator: { id: "c-jane", name: "Jane", handle: "jane" }, created: false });
    existing.mockResolvedValue([
      { id: "p1", campaignId: "camp-1", creatorId: "unattr-ig", creatorName: HOLDING.name, creatorHandle: "" },
      { id: "p2", campaignId: "camp-2", creatorId: "unattr-ig", creatorName: HOLDING.name, creatorHandle: "" },
      { id: "p3", campaignId: "camp-3", creatorId: "c-other", creatorName: "Other", creatorHandle: "other" },
    ]);
    const out = await detectPostCreator({ id: "p1", postUrl: URL, authorHandle: "jane" }, "org-1");

    expect(out?.movedPostIds).toEqual(["p1", "p2"]);
    expect(mockDb.post.updateMany).toHaveBeenCalledTimes(2);
    expect(mockDb.post.updateMany).toHaveBeenLastCalledWith({
      where: { id: "p2", creatorId: "unattr-ig" },
      data: { creatorId: "c-jane" },
    });
    expect(logAudit).toHaveBeenCalledTimes(2);
  });

  it("takes the creator from another copy of the same post when the read named nobody", async () => {
    existing.mockResolvedValue([
      { id: "p9", campaignId: "camp-9", creatorId: "c-jane", creatorName: "Jane", creatorHandle: "@jane" },
    ]);
    const out = await detectPostCreator({ id: "p1", postUrl: URL }, "org-1");

    expect(ensure).not.toHaveBeenCalled();
    expect(owner).not.toHaveBeenCalled();
    expect(out).toMatchObject({ creatorId: "c-jane", handle: "jane", source: "same-post", created: false });
  });

  it("files the post under the owner its public page names, before spending a Graph call", async () => {
    postPage.mockResolvedValue("jane.doe");
    ensure.mockResolvedValue({ creator: { id: "c-jane", name: "jane.doe", handle: "jane.doe" }, created: false });
    mockDb.post.findMany.mockResolvedValue([creator("c-alice", "alice")]);

    const out = await detectPostCreator({ id: "p1", postUrl: URL }, "org-1");

    expect(postPage).toHaveBeenCalledWith(URL, expect.any(Number));
    expect(ensure).toHaveBeenCalledWith("org-1", "jane.doe", "INSTAGRAM");
    expect(owner).not.toHaveBeenCalled();
    expect(out).toMatchObject({ creatorId: "c-jane", handle: "jane.doe", source: "post-page", created: false });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ source: "post-page" }) }));
  });

  it("does not fetch the page when the read or another copy already named the owner", async () => {
    ensure.mockResolvedValue({ creator: { id: "c-jane", name: "jane", handle: "jane" }, created: false });
    await detectPostCreator({ id: "p1", postUrl: URL, authorHandle: "jane" }, "org-1");
    existing.mockResolvedValue([
      { id: "p9", campaignId: "camp-9", creatorId: "c-jane", creatorName: "Jane", creatorHandle: "jane" },
    ]);
    await detectPostCreator({ id: "p1", postUrl: URL }, "org-1");
    expect(postPage).not.toHaveBeenCalled();
  });

  it("finds the post in a campaign creator's own media when nothing else names anybody", async () => {
    mockDb.post.findMany.mockResolvedValue([creator("c-alice", "alice"), creator("c-bob", "@bob")]);
    mockDb.activation.findMany.mockResolvedValue([creator("c-alice", "alice"), creator("c-cara", "cara")]);
    owner.mockResolvedValue({ handle: "bob", post: { id: "m1" } });

    const out = await detectPostCreator({ id: "p1", postUrl: URL }, "org-1");

    expect(owner).toHaveBeenCalledWith(["alice", "bob", "cara"], URL, "tok", expect.anything(), expect.objectContaining({ rateLimitThrows: true }));
    expect(out).toMatchObject({ creatorId: "c-bob", handle: "bob", source: "creator-media" });
    expect(mockDb.post.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", creatorId: "unattr-ig" },
      data: { creatorId: "c-bob" },
    });
  });

  it("asks only the campaign's own creators, and a bounded number of them", async () => {
    mockDb.post.findMany.mockResolvedValue(
      Array.from({ length: MAX_OWNER_CANDIDATES + 4 }, (_, i) => creator(`c-${i}`, `creator${i}`)),
    );
    await detectPostCreator({ id: "p1", postUrl: URL }, "org-1");

    expect(owner.mock.calls[0][0]).toHaveLength(MAX_OWNER_CANDIDATES);
    expect(mockDb.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ campaignId: "camp-1", campaign: { orgId: "org-1" } }) }),
    );
  });

  it("treats a throttled lookup as a miss for this read, not an error", async () => {
    mockDb.post.findMany.mockResolvedValue([creator("c-alice", "alice")]);
    owner.mockRejectedValue(new InstagramRateLimitError(4));

    await expect(detectPostCreator({ id: "p1", postUrl: URL }, "org-1")).resolves.toBeNull();
    expect(mockDb.post.updateMany).not.toHaveBeenCalled();
  });

  it("does not search creators' Instagram media for a post on another platform", async () => {
    mockDb.post.findFirst.mockResolvedValue({
      ...ROW,
      platform: "YOUTUBE",
      creator: { name: "Unattributed YouTube posts", handle: "" },
    });
    expect(await detectPostCreator({ id: "p1", postUrl: "https://youtu.be/abc" }, "org-1")).toBeNull();
    expect(owner).not.toHaveBeenCalled();
    expect(postPage).not.toHaveBeenCalled();
  });

  it("never fails the read it rides on: an error is a miss", async () => {
    mockDb.post.findFirst.mockRejectedValue(new Error("Can't reach database server"));
    await expect(detectPostCreator({ id: "p1", postUrl: URL, authorHandle: "jane" }, "org-1")).resolves.toBeNull();
    ensure.mockRejectedValue(new Error("profile read failed"));
    mockDb.post.findFirst.mockResolvedValue(ROW);
    await expect(detectPostCreator({ id: "p1", postUrl: URL, authorHandle: "jane" }, "org-1")).resolves.toBeNull();
    expect(mockDb.post.updateMany).not.toHaveBeenCalled();
  });

  it("stands back when another read filed the post first", async () => {
    ensure.mockResolvedValue({ creator: { id: "c-jane", name: "Jane", handle: "jane" }, created: false });
    mockDb.post.updateMany.mockResolvedValue({ count: 0 });

    expect(await detectPostCreator({ id: "p1", postUrl: URL, authorHandle: "jane" }, "org-1")).toBeNull();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
