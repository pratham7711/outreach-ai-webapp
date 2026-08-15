import {
  fetchPostMetrics,
  hasMetricCounts,
  detectPlatform,
  type PostMetrics,
} from "@/lib/platforms/fetchPostMetrics";

describe("detectPlatform", () => {
  it("detects TikTok video URLs", () => {
    expect(detectPlatform("https://www.tiktok.com/@user/video/123456")).toEqual({
      platform: "TIKTOK",
      id: "123456",
    });
  });

  it("detects YouTube watch, shorts and youtu.be URLs", () => {
    expect(detectPlatform("https://youtube.com/watch?v=abc123XYZ_1")?.platform).toBe("YOUTUBE");
    expect(detectPlatform("https://youtube.com/shorts/xyz789ABC-2")?.platform).toBe("YOUTUBE");
    expect(detectPlatform("https://youtu.be/def456GHI_3")?.platform).toBe("YOUTUBE");
  });

  it("detects Instagram reel and post URLs", () => {
    expect(detectPlatform("https://instagram.com/reel/Cabc")?.platform).toBe("INSTAGRAM");
    expect(detectPlatform("https://instagram.com/p/Cdef")?.platform).toBe("INSTAGRAM");
  });

  it("returns null for unrecognised URLs", () => {
    expect(detectPlatform("https://example.com/whatever")).toBeNull();
  });
});

describe("fetchPostMetrics — unknown vs known counts", () => {
  const realFetch = global.fetch;
  const realKey = process.env.YOUTUBE_API_KEY;

  afterEach(() => {
    global.fetch = realFetch;
    if (realKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = realKey;
    jest.restoreAllMocks();
  });

  it("returns null for an undetectable URL", async () => {
    expect(await fetchPostMetrics("https://example.com/foo")).toBeNull();
  });

  it("TikTok oembed success yields thumbnail/caption but NO counts", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ thumbnail_url: "thumb.jpg", title: "a caption" }),
    }) as unknown as typeof fetch;

    const m = (await fetchPostMetrics("https://www.tiktok.com/@u/video/1")) as PostMetrics;
    expect(m).not.toBeNull();
    expect(m.thumbnailUrl).toBe("thumb.jpg");
    expect(m.caption).toBe("a caption");
    expect(m.viewsCount).toBeUndefined();
    expect(m.likesCount).toBeUndefined();
    expect(hasMetricCounts(m)).toBe(false);
  });

  it("a failed platform fetch yields a stub with no counts", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    const m = (await fetchPostMetrics("https://instagram.com/reel/Cabc")) as PostMetrics;
    expect(m.thumbnailUrl).toBeNull();
    expect(m.viewsCount).toBeUndefined();
    expect(hasMetricCounts(m)).toBe(false);
  });

  it("YouTube with an API key returns real counts", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            statistics: { viewCount: "1000", likeCount: "50", commentCount: "5" },
            snippet: {
              title: "vid",
              thumbnails: { high: { url: "y.jpg" } },
              publishedAt: "2026-01-01T00:00:00Z",
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const m = (await fetchPostMetrics("https://youtu.be/abc123XYZ_1")) as PostMetrics;
    expect(hasMetricCounts(m)).toBe(true);
    expect(m.viewsCount).toBe(1000);
    expect(m.likesCount).toBe(50);
    expect(m.commentsCount).toBe(5);
  });

  it("YouTube without an API key falls back to a no-counts stub", async () => {
    delete process.env.YOUTUBE_API_KEY;
    const m = (await fetchPostMetrics("https://youtu.be/abc123XYZ_1")) as PostMetrics;
    expect(hasMetricCounts(m)).toBe(false);
  });

  it("TikTok with a creator token returns real counts from video.query", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          videos: [
            {
              id: "7672247264642993430",
              title: "t",
              video_description: "campaign clip",
              cover_image_url: "cover.jpg",
              create_time: 1786334308,
              view_count: 28,
              like_count: 4,
              comment_count: 1,
              share_count: 2,
            },
          ],
        },
      }),
    }) as unknown as typeof fetch;

    const m = (await fetchPostMetrics(
      "https://www.tiktok.com/@clipvault6260/video/7672247264642993430",
      { tiktokToken: "tok" },
    )) as PostMetrics;

    expect(hasMetricCounts(m)).toBe(true);
    expect(m.viewsCount).toBe(28);
    expect(m.likesCount).toBe(4);
    expect(m.commentsCount).toBe(1);
    expect(m.sharesCount).toBe(2);
    expect(m.caption).toBe("campaign clip");
  });

  it("TikTok falls back to oembed when video.query does not own the post", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { videos: [] } }) })
      .mockResolvedValueOnce({ ok: true, text: async () => "<html><body>no payload</body></html>" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ thumbnail_url: "thumb.jpg", title: "someone else" }),
      }) as unknown as typeof fetch;

    const m = (await fetchPostMetrics("https://www.tiktok.com/@other/video/999", {
      tiktokToken: "tok",
    })) as PostMetrics;

    expect(hasMetricCounts(m)).toBe(false);
    expect(m.caption).toBe("someone else");
  });
});
