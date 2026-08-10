import { fetchTikTokVideos } from "@/lib/platforms/tiktokDisplay";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("fetchTikTokVideos", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("returns an empty array when the account genuinely has no posts", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ data: { videos: [] } }));
    await expect(fetchTikTokVideos("token")).resolves.toEqual([]);
  });

  it("returns null when TikTok rejects the token", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, false, 401));
    await expect(fetchTikTokVideos("expired")).resolves.toBeNull();
  });

  it("returns null when the response carries no videos array", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "access_token_invalid" } }));
    await expect(fetchTikTokVideos("bogus")).resolves.toBeNull();
  });

  it("returns null when the request throws", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));
    await expect(fetchTikTokVideos("token")).resolves.toBeNull();
  });

  it("maps the fields the portal reads", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        data: {
          videos: [
            {
              id: "7672247264642993430",
              video_description: "demo clip",
              create_time: 1786000000,
              view_count: 28,
              like_count: 2,
              comment_count: 1,
              share_count: 0,
              share_url: "https://www.tiktok.com/@clipvault6260/video/7672247264642993430",
            },
          ],
        },
      }),
    );

    const videos = await fetchTikTokVideos("token");
    expect(videos).toHaveLength(1);
    expect(videos![0]).toMatchObject({
      id: "7672247264642993430",
      description: "demo clip",
      viewsCount: 28,
      likesCount: 2,
      commentsCount: 1,
      sharesCount: 0,
    });
  });
});
