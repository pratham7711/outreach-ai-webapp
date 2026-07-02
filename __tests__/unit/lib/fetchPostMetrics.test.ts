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
    expect(detectPlatform("https://youtube.com/watch?v=abc123")?.platform).toBe("YOUTUBE");
    expect(detectPlatform("https://youtube.com/shorts/xyz789")?.platform).toBe("YOUTUBE");
    expect(detectPlatform("https://youtu.be/def456")?.platform).toBe("YOUTUBE");
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

    const m = (await fetchPostMetrics("https://youtu.be/abc123")) as PostMetrics;
    expect(hasMetricCounts(m)).toBe(true);
    expect(m.viewsCount).toBe(1000);
    expect(m.likesCount).toBe(50);
    expect(m.commentsCount).toBe(5);
  });

  it("YouTube without an API key falls back to a no-counts stub", async () => {
    delete process.env.YOUTUBE_API_KEY;
    const m = (await fetchPostMetrics("https://youtu.be/abc123")) as PostMetrics;
    expect(hasMetricCounts(m)).toBe(false);
  });
});
