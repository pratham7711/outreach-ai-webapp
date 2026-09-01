/**
 * lib/creators/topPosts — the one copy of the top-posts recording rules, now
 * shared by the HTTP ingest (VPS worker) and the daily sandbox cron. The rules
 * that matter are the refusals: an unread grid must never erase stored posts,
 * and a creator that vanished since the work list must not throw.
 */

const mockFindFirst = jest.fn();
const mockUpdate = jest.fn();
const mockFindMany = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    creator: {
      findFirst: (...a: any[]) => mockFindFirst(...a),
      update: (...a: any[]) => mockUpdate(...a),
      findMany: (...a: any[]) => mockFindMany(...a),
    },
  },
}));

import { recordTopPosts, tikTokCreatorsNeedingTopPosts } from "@/lib/creators/topPosts";
import { TOP_POSTS_LIMIT } from "@/lib/platforms/creatorProfile";

const post = (postId: string, views: number | null) => ({
  postId,
  url: `https://www.tiktok.com/@h/video/${postId}`,
  caption: null,
  coverUrl: null,
  views,
  likes: 1,
  comments: 0,
  postedAt: null,
});

beforeEach(() => {
  mockFindFirst.mockReset().mockResolvedValue({ id: "c1" });
  mockUpdate.mockReset().mockResolvedValue({});
  mockFindMany.mockReset().mockResolvedValue([]);
});

describe("recordTopPosts", () => {
  it("ranks by views, caps at the limit, and stamps topPostsAt", async () => {
    const posts = Array.from({ length: 12 }, (_, i) => post(String(i), i * 10));
    const result = await recordTopPosts([{ creatorId: "c1", posts }]);

    expect(result).toEqual({ recorded: 1, unknown: 0, empty: 0 });
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.topPosts).toHaveLength(TOP_POSTS_LIMIT);
    expect(data.topPosts[0].postId).toBe("11");
    expect(data.topPostsAt).toBeInstanceOf(Date);
  });

  it("never writes for an empty read — stored posts survive a failed grid", async () => {
    const result = await recordTopPosts([{ creatorId: "c1", posts: [] }]);
    expect(result).toEqual({ recorded: 0, unknown: 0, empty: 1 });
    expect(mockUpdate).not.toHaveBeenCalled();
    /* And it does not even look the creator up: an empty read is decided
       before touching the row. */
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("counts a creator that vanished since the work list as unknown", async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await recordTopPosts([{ creatorId: "gone", posts: [post("1", 5)] }]);
    expect(result).toEqual({ recorded: 0, unknown: 1, empty: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("only ever matches undeleted TikTok creators", async () => {
    await recordTopPosts([{ creatorId: "c1", posts: [post("1", 5)] }]);
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1", platform: "TIKTOK", deletedAt: null },
      })
    );
  });

  it("dryRun reports what it would do and writes nothing", async () => {
    const result = await recordTopPosts([{ creatorId: "c1", posts: [post("1", 5)] }], {
      dryRun: true,
    });
    expect(result).toEqual({ recorded: 1, unknown: 0, empty: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("processes a mixed batch independently", async () => {
    mockFindFirst
      .mockResolvedValueOnce({ id: "c1" })
      .mockResolvedValueOnce(null);
    const result = await recordTopPosts([
      { creatorId: "c1", posts: [post("1", 5)] },
      { creatorId: "gone", posts: [post("2", 5)] },
      { creatorId: "c3", posts: [] },
    ]);
    expect(result).toEqual({ recorded: 1, unknown: 1, empty: 1 });
  });
});

describe("tikTokCreatorsNeedingTopPosts", () => {
  it("asks for tracked, undeleted TikTok rows, oldest-read first", async () => {
    await tikTokCreatorsNeedingTopPosts(3);
    const args = mockFindMany.mock.calls[0][0];
    expect(args.where).toEqual({ platform: "TIKTOK", trackedSince: { not: null }, deletedAt: null });
    expect(args.orderBy[0]).toEqual({ topPostsAt: { sort: "asc", nulls: "first" } });
    expect(args.take).toBe(3);
  });

  it("omits take when no limit is given", async () => {
    await tikTokCreatorsNeedingTopPosts();
    expect(mockFindMany.mock.calls[0][0].take).toBeUndefined();
  });

  it("splits readRecently on the 30-day window", async () => {
    mockFindMany.mockResolvedValue([
      { id: "a", handle: "fresh", name: "F", topPostsAt: new Date() },
      { id: "b", handle: "old", name: "O", topPostsAt: new Date(Date.now() - 40 * 864e5) },
      { id: "c", handle: "never", name: "N", topPostsAt: null },
    ]);
    const rows = await tikTokCreatorsNeedingTopPosts();
    expect(rows.map((r) => r.readRecently)).toEqual([true, false, false]);
  });
});
