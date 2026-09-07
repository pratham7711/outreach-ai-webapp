import { buildPlatformInsights, type InsightsAccount } from "@/lib/portal/creatorInsights";

jest.mock("@/lib/platforms/instagramToken", () => ({
  ensureFreshInstagramToken: jest.fn().mockResolvedValue("ig-token"),
}));
jest.mock("@/lib/platforms/tiktokToken", () => ({ ensureFreshTikTokToken: jest.fn() }));
jest.mock("@/lib/platforms/youtubeToken", () => ({ ensureFreshYouTubeToken: jest.fn() }));
jest.mock("@/lib/platforms/threadsToken", () => ({ ensureFreshThreadsToken: jest.fn() }));
jest.mock("@/lib/platforms/tiktokDisplay", () => ({ fetchTikTokVideos: jest.fn() }));
jest.mock("@/lib/platforms/youtube", () => ({
  fetchYouTubeChannel: jest.fn(),
  fetchYouTubeVideos: jest.fn(),
}));
jest.mock("@/lib/platforms/facebookPage", () => ({
  fetchFacebookPage: jest.fn(),
  fetchFacebookPagePosts: jest.fn(),
}));
jest.mock("@/lib/platforms/threads", () => ({ fetchThreadsPosts: jest.fn() }));
jest.mock("@/lib/platforms/instagramAccount", () => ({
  fetchInstagramAccount: jest.fn(),
  fetchInstagramMedia: jest.fn(),
}));

import { fetchInstagramMedia } from "@/lib/platforms/instagramAccount";

const account: InsightsAccount = {
  id: "sa-ig",
  platform: "INSTAGRAM",
  handle: "prathams7711",
  accessToken: "enc",
  refreshToken: null,
  tokenExpiry: null,
  platformUserId: "17841400000000000",
  avatarUrl: null,
  bio: "Developer",
  profileUrl: "https://www.instagram.com/prathams7711/",
  isVerified: false,
  followersCount: 395,
  followingCount: 611,
  totalLikes: null,
  mediaCount: 10,
};

function media(
  id: string,
  likes: number,
  views: number | undefined,
): Record<string, unknown> {
  return {
    id,
    title: id,
    description: id,
    coverImageUrl: null,
    shareUrl: `https://www.instagram.com/p/${id}/`,
    postedAt: "2024-02-24T05:14:33+0000",
    viewsCount: views ?? 0,
    likesCount: likes,
    commentsCount: 1,
    sharesCount: 0,
    exact: { views, likes, comments: 1 },
  };
}

describe("buildPlatformInsights — views the platform did not measure", () => {
  it("reports null views, total and median when no post was measured, and ranks the best post by likes", async () => {
    /* The shape of every Instagram account converted to Business after its
       posts went up: the media edge returns likes and comments, the insights
       edge answers 400 for each media. This used to render "0 views" on every
       row and "Views (recent posts) 0" in the header. */
    (fetchInstagramMedia as jest.Mock).mockResolvedValueOnce([
      media("m1", 223, undefined),
      media("m2", 147, undefined),
      media("m3", 91, undefined),
    ]);

    const block = await buildPlatformInsights(account, "org1");
    expect(block).not.toBeNull();
    expect(block!.needsReconnect).toBe(false);
    expect(block!.sampleSize).toBe(3);
    expect(block!.totalViews).toBeNull();
    expect(block!.medianViews).toBeNull();
    expect(block!.posts.map((p) => p.views)).toEqual([null, null, null]);
    expect(block!.posts.map((p) => p.likes)).toEqual([223, 147, 91]);
    expect(block!.bestPost?.id).toBe("m1");
    expect(block!.bestPost?.views).toBeNull();
  });

  it("computes total and median over measured posts only and ranks the best post by views", async () => {
    (fetchInstagramMedia as jest.Mock).mockResolvedValueOnce([
      media("old", 500, undefined),
      media("reel", 40, 9100),
      media("photo", 60, 400),
    ]);

    const block = await buildPlatformInsights(account, "org1");
    expect(block!.totalViews).toBe(9500);
    expect(block!.medianViews).toBe(4750);
    expect(block!.bestPost?.id).toBe("reel");
    expect(block!.posts.find((p) => p.id === "old")?.views).toBeNull();
    expect(block!.posts.find((p) => p.id === "photo")?.views).toBe(400);
  });

  it("captions a post with its title, falling back to the description", async () => {
    (fetchInstagramMedia as jest.Mock).mockResolvedValueOnce([
      { ...media("m1", 10, 100), title: "First line of caption", description: "First line of caption\nmore" },
      { ...media("m2", 5, 50), title: "", description: "only a description" },
    ]);
    const block = await buildPlatformInsights(account, "org1");
    expect(block!.posts.map((p) => p.caption)).toEqual([
      "First line of caption",
      "only a description",
    ]);
  });

  it("never reports fewer posts published than it just fetched", async () => {
    /* YouTube's channel statistics lag uploads, and mediaCount is stored at
       connect time — a creator who connected an empty channel and uploaded
       twice must not read "Posts published 0 · last 2 public posts". */
    (fetchInstagramMedia as jest.Mock).mockResolvedValueOnce([
      media("a", 1, 10),
      media("b", 1, 10),
    ]);
    const block = await buildPlatformInsights({ ...account, mediaCount: 0 }, "org1");
    expect(block!.mediaCount).toBe(2);

    (fetchInstagramMedia as jest.Mock).mockResolvedValueOnce([media("a", 1, 10)]);
    const kept = await buildPlatformInsights({ ...account, mediaCount: 10 }, "org1");
    expect(kept!.mediaCount).toBe(10);

    (fetchInstagramMedia as jest.Mock).mockResolvedValueOnce([media("a", 1, 10)]);
    const unknown = await buildPlatformInsights({ ...account, mediaCount: null }, "org1");
    expect(unknown!.mediaCount).toBeNull();
  });

  it("still treats a failed media fetch as a reconnect, with zeroed aggregates", async () => {
    (fetchInstagramMedia as jest.Mock).mockResolvedValueOnce(null);
    const block = await buildPlatformInsights(account, "org1");
    expect(block!.needsReconnect).toBe(true);
    expect(block!.posts).toEqual([]);
  });
});
