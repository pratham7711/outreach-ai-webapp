/**
 * A refresh of a post with no creator finds the creator and reads the post
 * again under them, in the same refresh -- so the views arrive without anybody
 * picking a creator.
 */
const mockTransaction = jest.fn();

jest.mock("@/lib/db", () => ({
  db: {
    post: { update: jest.fn((args: any) => args) },
    postMetricSnapshot: { create: jest.fn((args: any) => args) },
    creator: { updateMany: jest.fn((args: any) => args) },
    $transaction: (...a: any[]) => mockTransaction(...a),
  },
}));
jest.mock("@/lib/creators/followerWriter", () => ({ protectedCreatorFollowers: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/platforms/fetchPostMetrics", () => ({
  ...jest.requireActual("@/lib/platforms/fetchPostMetrics"),
  fetchPostMetrics: jest.fn(),
}));
jest.mock("@/lib/platforms/instagramToken", () => ({ getInstagramAccountForCreator: jest.fn() }));
jest.mock("@/lib/platforms/tiktokToken", () => ({ getTikTokTokenForCreator: jest.fn() }));
jest.mock("@/lib/posts/detectCreator", () => ({ detectPostCreator: jest.fn() }));

import { fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";
import { getInstagramAccountForCreator } from "@/lib/platforms/instagramToken";
import { detectPostCreator } from "@/lib/posts/detectCreator";
import { syncPost } from "@/lib/sync/syncPost";

const fetchMetrics = fetchPostMetrics as jest.Mock;
const account = getInstagramAccountForCreator as jest.Mock;
const detect = detectPostCreator as jest.Mock;

const POST = {
  id: "p1",
  platform: "INSTAGRAM",
  creatorId: "unattr-ig",
  postUrl: "https://www.instagram.com/reel/ABC123/",
  thumbnailUrl: null,
  caption: null,
  platformMetrics: {},
};

beforeEach(() => {
  jest.clearAllMocks();
  mockTransaction.mockImplementation(async (ops: any[]) => [{ id: "p1", ...ops[0].data }]);
  account.mockImplementation(async (creatorId: string) => (creatorId === "c-jane" ? { handle: "jane" } : {}));
});

describe("syncPost on a post with no creator", () => {
  it("files it under the owner the read named, then reads it again under them", async () => {
    fetchMetrics
      .mockResolvedValueOnce({
        platform: "INSTAGRAM",
        platformPostId: "ABC123",
        thumbnailUrl: null,
        caption: null,
        authorHandle: "jane",
        fetchReason: "author-unknown",
      })
      .mockResolvedValueOnce({
        platform: "INSTAGRAM",
        platformPostId: "ABC123",
        thumbnailUrl: "https://cdn/t.jpg",
        caption: null,
        viewsCount: 12000,
        likesCount: 300,
      });
    detect.mockResolvedValue({ creatorId: "c-jane", handle: "jane", source: "post-read", created: false, movedPostIds: ["p1"] });

    const out = await syncPost(POST, "org-1");

    expect(detect).toHaveBeenCalledWith({ id: "p1", postUrl: POST.postUrl, authorHandle: "jane" }, "org-1");
    expect(account).toHaveBeenLastCalledWith("c-jane", "org-1", POST.postUrl);
    expect(fetchMetrics).toHaveBeenLastCalledWith(POST.postUrl, expect.objectContaining({ instagramHandle: "jane" }));
    expect(out.status).toBe("measured");
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("does not look for a creator when the post is read under a known account", async () => {
    account.mockResolvedValue({ handle: "jane" });
    fetchMetrics.mockResolvedValue({
      platform: "INSTAGRAM",
      platformPostId: "ABC123",
      thumbnailUrl: null,
      caption: null,
      viewsCount: 10,
    });
    await syncPost({ ...POST, creatorId: "c-jane" }, "org-1");
    expect(detect).not.toHaveBeenCalled();
  });

  it("reads once and stops when nobody can be found", async () => {
    fetchMetrics.mockResolvedValue({
      platform: "INSTAGRAM",
      platformPostId: "ABC123",
      thumbnailUrl: null,
      caption: null,
      fetchReason: "author-unknown",
    });
    detect.mockResolvedValue(null);
    await syncPost(POST, "org-1");
    expect(fetchMetrics).toHaveBeenCalledTimes(1);
  });
});

describe("syncPost on a Facebook post filed under nobody", () => {
  const FB = {
    ...POST,
    platform: "FACEBOOK",
    creatorId: "unattr-fb",
    platformPostId: "1234567890",
    postUrl: "https://www.facebook.com/100000000000077/posts/1234567890",
  };

  it("files it under the creator whose connected Page has it, then reads it there and keeps the Graph id", async () => {
    fetchMetrics
      .mockResolvedValueOnce({
        platform: "FACEBOOK",
        platformPostId: "1234567890",
        thumbnailUrl: null,
        caption: null,
        fetchReason: "page-not-connected",
      })
      .mockResolvedValueOnce({
        platform: "FACEBOOK",
        platformPostId: "1122334455_1234567890",
        thumbnailUrl: null,
        caption: null,
        viewsCount: 15,
      });
    detect.mockResolvedValue({ creatorId: "c-brand", handle: "boringbrand", source: "page", created: false, movedPostIds: ["p1"] });

    const out = await syncPost(FB, "org-1");

    expect(detect).toHaveBeenCalledWith({ id: "p1", postUrl: FB.postUrl }, "org-1");
    expect(fetchMetrics).toHaveBeenLastCalledWith(
      FB.postUrl,
      expect.objectContaining({ facebook: { orgId: "org-1", creatorId: "c-brand", knownPostId: "1234567890" } }),
    );
    const { db } = jest.requireMock("@/lib/db");
    expect(db.post.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { platformPostId: "1122334455_1234567890" } });
    expect(out.status).toBe("measured");
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("does not look for a creator when the post was read on its creator's Page", async () => {
    fetchMetrics.mockResolvedValue({
      platform: "FACEBOOK",
      platformPostId: "1122334455_1234567890",
      thumbnailUrl: null,
      caption: null,
      viewsCount: 15,
    });
    await syncPost({ ...FB, creatorId: "c-brand" }, "org-1");
    expect(detect).not.toHaveBeenCalled();
  });

  it("reads once and stops when no connected Page has it", async () => {
    fetchMetrics.mockResolvedValue({
      platform: "FACEBOOK",
      platformPostId: "1234567890",
      thumbnailUrl: null,
      caption: null,
      fetchReason: "page-not-connected",
    });
    detect.mockResolvedValue(null);
    await syncPost(FB, "org-1");
    expect(fetchMetrics).toHaveBeenCalledTimes(1);
  });
});
