/**
 * The official-API Top Posts reader — the path that actually works after every
 * scraping route was measured and refused.
 *
 * The distinctions that matter here are all about what counts as "no answer":
 * an unconnected creator and an expired authorisation must both come back as
 * null so the caller leaves stored posts alone, while a creator who genuinely
 * has no videos is a real, empty answer.
 */

const mockGetToken = jest.fn();
jest.mock("@/lib/platforms/tiktokToken", () => ({
  getTikTokTokenForCreator: (...a: any[]) => mockGetToken(...a),
}));

const mockFetchVideos = jest.fn();
jest.mock("@/lib/platforms/tiktokDisplay", () => ({
  fetchTikTokVideos: (...a: any[]) => mockFetchVideos(...a),
}));

import { readTikTokTopPostsOfficial } from "@/lib/platforms/tiktokTopPostsOfficial";
import { TOP_POSTS_LIMIT } from "@/lib/platforms/creatorProfile";

const video = (id: string, views: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `t${id}`,
  description: `d${id}`,
  durationSeconds: 10,
  coverImageUrl: `https://cdn/${id}.jpg`,
  shareUrl: `https://www.tiktok.com/@who/video/${id}`,
  embedLink: null,
  postedAt: "2026-08-01T00:00:00.000Z",
  viewsCount: views,
  likesCount: 5,
  commentsCount: 1,
  sharesCount: 0,
  ...extra,
});

beforeEach(() => {
  mockGetToken.mockReset().mockResolvedValue("token");
  mockFetchVideos.mockReset().mockResolvedValue([]);
});

describe("no usable connection", () => {
  it("returns null when the creator never connected TikTok", async () => {
    mockGetToken.mockResolvedValue(undefined);
    expect(await readTikTokTopPostsOfficial("c1", "o1", "who")).toBeNull();
    expect(mockFetchVideos).not.toHaveBeenCalled();
  });

  it("returns null when the authorisation has expired", async () => {
    mockFetchVideos.mockResolvedValue(null);
    expect(await readTikTokTopPostsOfficial("c1", "o1", "who")).toBeNull();
  });

  it("passes the creator and org through to the token lookup", async () => {
    await readTikTokTopPostsOfficial("c1", "o1", "who");
    expect(mockGetToken).toHaveBeenCalledWith("c1", "o1");
  });
});

describe("reading posts", () => {
  it("ranks by views and caps at the limit", async () => {
    mockFetchVideos.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => video(String(i), i * 100))
    );
    const read = await readTikTokTopPostsOfficial("c1", "o1", "who");
    expect(read!.topPosts).toHaveLength(TOP_POSTS_LIMIT);
    expect(read!.topPosts[0].postId).toBe("9");
  });

  it("averages views across every video, not just the ranked ones", async () => {
    mockFetchVideos.mockResolvedValue([video("a", 100), video("b", 200), video("c", 300)]);
    const read = await readTikTokTopPostsOfficial("c1", "o1", "who");
    expect(read!.avgViews).toBe(200);
    expect(read!.sampledPosts).toBe(3);
  });

  it("maps the fields Top Posts renders", async () => {
    mockFetchVideos.mockResolvedValue([video("42", 7)]);
    const read = await readTikTokTopPostsOfficial("c1", "o1", "who");
    expect(read!.topPosts[0]).toEqual({
      postId: "42",
      url: "https://www.tiktok.com/@who/video/42",
      caption: "d42",
      coverUrl: "https://cdn/42.jpg",
      views: 7,
      likes: 5,
      comments: 1,
      postedAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("falls back to a handle URL when TikTok gives no share link", async () => {
    mockFetchVideos.mockResolvedValue([video("42", 7, { shareUrl: null })]);
    const read = await readTikTokTopPostsOfficial("c1", "o1", "@who");
    expect(read!.topPosts[0].url).toBe("https://www.tiktok.com/@who/video/42");
  });

  it("prefers the description, then the title, then null for the caption", async () => {
    mockFetchVideos.mockResolvedValue([
      video("1", 1, { description: "", title: "just a title" }),
      video("2", 1, { description: "", title: "" }),
    ]);
    const read = await readTikTokTopPostsOfficial("c1", "o1", "who");
    const byId = new Map(read!.topPosts.map((p) => [p.postId, p.caption]));
    expect(byId.get("1")).toBe("just a title");
    expect(byId.get("2")).toBeNull();
  });

  it("a creator with no videos is a real empty answer, not null", async () => {
    mockFetchVideos.mockResolvedValue([]);
    const read = await readTikTokTopPostsOfficial("c1", "o1", "who");
    expect(read).not.toBeNull();
    expect(read!.topPosts).toEqual([]);
    expect(read!.avgViews).toBe(0);
    expect(read!.sampledPosts).toBe(0);
  });
});
