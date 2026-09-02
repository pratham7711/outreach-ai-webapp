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

/**
 * The display fields are coerced; `exact` is not.
 *
 * num() turns an absent counter into 0, which is right for the creator page
 * and portal insights -- they want something to render. It is wrong for
 * lib/platforms/fetchPostMetrics, which WRITES what it is handed: a coerced 0
 * arrives at applyPostMetrics indistinguishable from a real zero, gets
 * lastSyncedAt stamped beside it, and becomes a measured fact no later sync can
 * correct. `exact` is what the metrics path reads instead.
 */
describe("fetchTikTokVideos — exact keeps absent counters absent", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const videoWith = (extra: Record<string, unknown>) =>
    jsonResponse({ data: { videos: [{ id: "7123", ...extra }] } });

  it("omits a counter TikTok did not report, while the flat field still reads 0", async () => {
    global.fetch = jest.fn().mockResolvedValue(videoWith({ like_count: 12 }));
    const [v] = (await fetchTikTokVideos("token"))!;

    // Display half: something to render.
    expect(v.viewsCount).toBe(0);
    // Metrics half: nothing to write.
    expect(v.exact.views).toBeUndefined();
    expect(v.exact.likes).toBe(12);
    expect(v.exact.comments).toBeUndefined();
    expect(v.exact.shares).toBeUndefined();
  });

  it("keeps a genuine zero, which is a real measurement", async () => {
    global.fetch = jest.fn().mockResolvedValue(videoWith({ view_count: 0, like_count: 0 }));
    const [v] = (await fetchTikTokVideos("token"))!;
    expect(v.exact.views).toBe(0);
    expect(v.exact.likes).toBe(0);
  });

  it("does not invent a publish date when create_time is missing", async () => {
    global.fetch = jest.fn().mockResolvedValue(videoWith({ view_count: 5 }));
    const [v] = (await fetchTikTokVideos("token"))!;
    /* postedAt falls back to now for display; exact.createdAt does not exist,
       so the metrics path leaves the column alone rather than stamping today
       onto a post published months ago. */
    expect(v.exact.createdAt).toBeUndefined();
  });

  it("carries the real publish date through when TikTok states one", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(videoWith({ create_time: 1767225600, view_count: 5 }));
    const [v] = (await fetchTikTokVideos("token"))!;
    expect(v.exact.createdAt).toEqual(new Date(1767225600 * 1000));
  });
});
