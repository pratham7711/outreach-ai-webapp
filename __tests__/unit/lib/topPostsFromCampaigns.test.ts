/**
 * The last rung of the Top Posts ladder: the posts this workspace already
 * tracks for a creator.
 *
 * What matters here is the difference between "we looked and there is nothing"
 * and "we have nothing to show" -- the first must leave stored posts alone --
 * and that a zero count never renders as a measured zero, because Post columns
 * default to 0 for a post that has simply never been synced.
 */

const mockFindMany = jest.fn();
jest.mock("@/lib/db", () => ({
  db: { post: { findMany: (...a: any[]) => mockFindMany(...a) } },
}));

import { readTopPostsFromCampaigns } from "@/lib/creators/topPostsFromCampaigns";
import { TOP_POSTS_LIMIT } from "@/lib/platforms/creatorProfile";

const row = (id: string, views: number, extra: Record<string, unknown> = {}) => ({
  platformPostId: id,
  postUrl: `https://www.tiktok.com/@who/video/${id}`,
  caption: `c${id}`,
  thumbnailUrl: `https://cdn/${id}.jpg`,
  viewsCount: views,
  likesCount: 5,
  commentsCount: 1,
  postedAt: new Date("2026-08-01T00:00:00.000Z"),
  ...extra,
});

beforeEach(() => {
  mockFindMany.mockReset().mockResolvedValue([]);
});

it("returns null when the workspace tracks no posts for the creator", async () => {
  expect(await readTopPostsFromCampaigns("c1")).toBeNull();
});

it("scopes the read to the creator and orders by views", async () => {
  await readTopPostsFromCampaigns("c1");
  const arg = mockFindMany.mock.calls[0][0];
  expect(arg.where).toEqual({ creatorId: "c1" });
  expect(arg.orderBy).toEqual({ viewsCount: "desc" });
  expect(arg.take).toBeGreaterThanOrEqual(TOP_POSTS_LIMIT);
});

it("ranks by views and caps at the display limit", async () => {
  mockFindMany.mockResolvedValue(
    Array.from({ length: 12 }, (_, i) => row(String(i), i * 100))
  );
  const read = await readTopPostsFromCampaigns("c1");
  expect(read!.topPosts).toHaveLength(TOP_POSTS_LIMIT);
  expect(read!.topPosts[0].postId).toBe("11");
});

it("maps the fields the panel renders", async () => {
  mockFindMany.mockResolvedValue([row("42", 7)]);
  const read = await readTopPostsFromCampaigns("c1");
  expect(read!.topPosts[0]).toEqual({
    postId: "42",
    url: "https://www.tiktok.com/@who/video/42",
    caption: "c42",
    coverUrl: "https://cdn/42.jpg",
    views: 7,
    likes: 5,
    comments: 1,
    postedAt: "2026-08-01T00:00:00.000Z",
  });
});

it("reports a never-synced zero as unknown rather than a measured zero", async () => {
  mockFindMany.mockResolvedValue([row("1", 0, { likesCount: 0, commentsCount: 0 })]);
  const read = await readTopPostsFromCampaigns("c1");
  expect(read!.topPosts[0].views).toBeNull();
  expect(read!.topPosts[0].likes).toBeNull();
  expect(read!.topPosts[0].comments).toBeNull();
});

it("averages only the posts that carry a view count", async () => {
  mockFindMany.mockResolvedValue([row("a", 100), row("b", 300), row("c", 0)]);
  const read = await readTopPostsFromCampaigns("c1");
  expect(read!.avgViews).toBe(200);
  expect(read!.sampledPosts).toBe(2);
});

it("still answers when no post has ever been synced", async () => {
  mockFindMany.mockResolvedValue([row("1", 0), row("2", 0)]);
  const read = await readTopPostsFromCampaigns("c1");
  expect(read!.topPosts).toHaveLength(2);
  expect(read!.avgViews).toBe(0);
  expect(read!.sampledPosts).toBe(0);
});

it("keeps a missing caption, cover or date null rather than inventing one", async () => {
  mockFindMany.mockResolvedValue([
    row("1", 5, { caption: null, thumbnailUrl: null, postedAt: null }),
  ]);
  const read = await readTopPostsFromCampaigns("c1");
  expect(read!.topPosts[0].caption).toBeNull();
  expect(read!.topPosts[0].coverUrl).toBeNull();
  expect(read!.topPosts[0].postedAt).toBeNull();
});
