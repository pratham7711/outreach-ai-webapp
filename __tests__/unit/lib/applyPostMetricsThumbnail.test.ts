/**
 * @jest-environment node
 *
 * The sync keeps a copy of each cover it writes (lib/posts/thumbnailStore).
 * That copy is a side effect of the reading, never a condition of it: it runs
 * after the post's own write has landed, only when a cover arrived, and a
 * picture that will not download cannot cost the post its reading.
 */
const mockUpdate = jest.fn();
const mockTransaction = jest.fn();
const mockSnapshotCreate = jest.fn();
const mockCapture = jest.fn();

jest.mock("@/lib/db", () => ({
  db: {
    post: { update: (...a: any[]) => mockUpdate(...a) },
    postMetricSnapshot: { create: (...a: any[]) => mockSnapshotCreate(...a) },
    creator: { update: jest.fn(async () => ({})), updateMany: jest.fn(async () => ({ count: 1 })) },
    $transaction: (...a: any[]) => mockTransaction(...a),
  },
}));
jest.mock("@/lib/creators/followerWriter", () => ({ protectedCreatorFollowers: jest.fn(async () => null) }));
jest.mock("@/lib/posts/thumbnailStore", () => ({ capturePostThumbnail: (...a: any[]) => mockCapture(...a) }));

import { applyPostMetrics } from "@/lib/sync/syncPost";
import type { PostMetrics } from "@/lib/platforms/fetchPostMetrics";

const post = {
  id: "post_1",
  platform: "INSTAGRAM",
  creatorId: "creator_1",
  postUrl: "https://instagram.com/p/Cabc",
  thumbnailUrl: "old.jpg",
  caption: "old caption",
};
const cover = "https://scontent.cdninstagram.com/v/t51/1_n.jpg?oe=6A000000";
const metrics = (over: Partial<PostMetrics> = {}): PostMetrics =>
  ({ platform: "INSTAGRAM", platformPostId: "Cabc", thumbnailUrl: null, caption: null, ...over }) as PostMetrics;
const measured = (over: Partial<PostMetrics> = {}) => metrics({ likesCount: 4100, commentsCount: 87, ...over });

const order: string[] = [];
beforeEach(() => {
  order.length = 0;
  mockUpdate.mockReset().mockImplementation(async () => {
    order.push("write");
    return { id: "post_1" };
  });
  mockSnapshotCreate.mockReset().mockResolvedValue({});
  mockTransaction.mockReset().mockImplementation(async (ops: unknown[]) => {
    await Promise.all(ops as Promise<unknown>[]);
    return [{ id: "post_1" }];
  });
  mockCapture.mockReset().mockImplementation(async () => {
    order.push("capture");
    return true;
  });
});

describe("applyPostMetrics keeps a copy of the cover", () => {
  it("captures the cover the reading carried, after the post's write", async () => {
    await applyPostMetrics(post, measured({ thumbnailUrl: cover }));
    expect(mockCapture).toHaveBeenCalledWith(post, cover);
    expect(order).toEqual(["write", "capture"]);
  });

  it("captures nothing when no cover arrived", async () => {
    await applyPostMetrics(post, measured());
    await applyPostMetrics(post, metrics({ fetchReason: "platform-challenged" }));
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("returns the same outcome with or without the copy", async () => {
    const without = await applyPostMetrics(post, measured());
    const withCover = await applyPostMetrics(post, measured({ thumbnailUrl: cover }));
    expect(without.status).toBe("measured");
    expect(withCover).toEqual(without);
  });
});
