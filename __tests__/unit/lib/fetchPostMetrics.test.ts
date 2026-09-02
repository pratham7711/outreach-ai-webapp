import {
  fetchPostMetrics,
  hasMetricCounts,
  detectPlatform,
  type PostMetrics,
} from "@/lib/platforms/fetchPostMetrics";

describe("detectPlatform", () => {
  it("detects TikTok video URLs", () => {
    // The return also carries what the URL says about kind and author now, so
    // the Add Post form can stop asking for both. Asserted in full rather than
    // loosened to toMatchObject: the whole point is that these fields are there.
    expect(detectPlatform("https://www.tiktok.com/@user/video/123456")).toEqual({
      platform: "TIKTOK",
      id: "123456",
      mediaType: "VIDEO",
      handle: "user",
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
    // The Data API has no share statistic, so there is nothing to report.
    expect(m.sharesCount).toBeUndefined();
    expect(m.postedAt).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("YouTube omits a like count the channel hides, rather than reading it as none", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            statistics: { viewCount: "1000", commentCount: "5" },
            snippet: { title: "vid", thumbnails: { high: { url: "y.jpg" } } },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const m = (await fetchPostMetrics("https://youtu.be/abc123XYZ_1")) as PostMetrics;
    expect(m.viewsCount).toBe(1000);
    expect(m.likesCount).toBeUndefined();
    // And no publish date was sent, so none is invented.
    expect(m.postedAt).toBeUndefined();
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
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "<html><body>no rehydration payload</body></html>",
      })
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

  it("rejects counts where likes exceed views", () => {
    const base: PostMetrics = {
      platform: "TIKTOK",
      platformPostId: "7674509912013311253",
      thumbnailUrl: null,
      caption: null,
      viewsCount: 406,
      likesCount: 1092,
      commentsCount: 18,
      sharesCount: 161,
      postedAt: new Date(0),
    };
    expect(hasMetricCounts(base)).toBe(false);
    expect(hasMetricCounts({ ...base, likesCount: 406 })).toBe(true);
  });
});

/**
 * Instagram has to say WHY it came back empty.
 *
 * It used to return a bare stub carrying no fetchReason at all, and syncPost's
 * `?? "no-counts-published"` fallback then filed it as a post that publishes no
 * counters -- a verdict about the POST, and one refreshCampaign treats as
 * settled and never retries. So every Instagram post in a campaign reported
 * zero engagement and was never asked about again, whether the deployment held
 * no credential or the Graph call had failed. Those are different problems with
 * different fixes and they were indistinguishable in the run record.
 */
describe("fetchPostMetrics — Instagram names its own failure", () => {
  const realFetch = global.fetch;
  const realBizToken = process.env.INSTAGRAM_BUSINESS_TOKEN;

  afterEach(() => {
    global.fetch = realFetch;
    if (realBizToken === undefined) delete process.env.INSTAGRAM_BUSINESS_TOKEN;
    else process.env.INSTAGRAM_BUSINESS_TOKEN = realBizToken;
    jest.restoreAllMocks();
  });

  it("reports not-configured when it held no credential to try", async () => {
    delete process.env.INSTAGRAM_BUSINESS_TOKEN;
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

    const m = (await fetchPostMetrics("https://instagram.com/reel/Cabc")) as PostMetrics;
    expect(m.fetchReason).toBe("not-configured");
  });

  /* The bug in one assertion: this is the value that used to be undefined. */
  it("never comes back without a reason", async () => {
    delete process.env.INSTAGRAM_BUSINESS_TOKEN;
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

    const m = (await fetchPostMetrics("https://instagram.com/reel/Cabc")) as PostMetrics;
    expect(m.fetchReason).toBeDefined();
    expect(m.fetchReason).not.toBe("no-counts-published");
  });

  /* oEmbed answering is a title and a picture, not the post's numbers -- the
     same reasoning the TikTok path already applies to its own oEmbed call. */
  it("keeps the reason even when oEmbed supplies metadata", async () => {
    delete process.env.INSTAGRAM_BUSINESS_TOKEN;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ thumbnail_url: "ig.jpg", title: "cap" }),
    }) as unknown as typeof fetch;

    const m = (await fetchPostMetrics("https://instagram.com/reel/Cabc")) as PostMetrics;
    expect(m.thumbnailUrl).toBe("ig.jpg");
    expect(hasMetricCounts(m)).toBe(false);
    expect(m.fetchReason).toBe("not-configured");
  });

  it("distinguishes a credential that was tried and came back empty", async () => {
    process.env.INSTAGRAM_BUSINESS_TOKEN = "biz-token";
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

    const m = (await fetchPostMetrics("https://instagram.com/reel/Cabc", {
      instagramHandle: "someone",
    })) as PostMetrics;
    /* Retryable, unlike the settled verdict this used to inherit -- an expired
       token and a walled request look the same from here, and neither is a
       statement that the post has no engagement. */
    expect(m.fetchReason).toBe("platform-refused");
  });
});
