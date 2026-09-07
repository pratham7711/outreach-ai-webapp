import {
  fetchInstagramAccount,
  fetchInstagramMedia,
} from "@/lib/platforms/instagramAccount";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

const IG_ACCOUNT = {
  data: [
    {
      instagram_business_account: {
        id: "17841400000000000",
        username: "boringbrand",
        name: "Boring Brand",
        biography: "we make boring things",
        profile_picture_url: "https://cdn.example/a.jpg",
        followers_count: 8421,
        follows_count: 310,
        media_count: 214,
      },
    },
  ],
};

describe("fetchInstagramAccount", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("maps the identity behind the creator's token", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(IG_ACCOUNT));
    await expect(fetchInstagramAccount("token")).resolves.toEqual({
      igUserId: "17841400000000000",
      username: "boringbrand",
      displayName: "Boring Brand",
      avatarUrl: "https://cdn.example/a.jpg",
      bio: "we make boring things",
      profileLink: "https://www.instagram.com/boringbrand/",
      // The Graph API exposes no is_verified for an IG User, so this is a
      // limit of the API rather than a claim about the account.
      isVerified: false,
      followerCount: 8421,
      followingCount: 310,
      mediaCount: 214,
    });
  });

  it("skips pages with no Instagram Business account and uses the first that has one", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        data: [{ id: "page-no-ig" }, ...IG_ACCOUNT.data],
      }),
    );
    const info = await fetchInstagramAccount("token");
    expect(info?.igUserId).toBe("17841400000000000");
  });

  it("returns null when the token carries no Instagram Business account at all", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ data: [{ id: "p1" }] }));
    await expect(fetchInstagramAccount("token")).resolves.toBeNull();
  });
});

describe("fetchInstagramMedia", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("maps the four counters, taking views and shares from the insights edge", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "media1",
              caption: "First line\nsecond line",
              media_type: "VIDEO",
              permalink: "https://www.instagram.com/p/abc/",
              thumbnail_url: "https://cdn.example/t.jpg",
              timestamp: "2026-08-02T09:00:00+0000",
              like_count: 220,
              comments_count: 14,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { name: "views", values: [{ value: 9100 }] },
            { name: "shares", values: [{ value: 33 }] },
          ],
        }),
      );

    const media = await fetchInstagramMedia("token", "17841400000000000");
    expect(media).toHaveLength(1);
    const m = media![0];
    expect(m.viewsCount).toBe(9100);
    expect(m.likesCount).toBe(220);
    expect(m.commentsCount).toBe(14);
    expect(m.sharesCount).toBe(33);
    // Instagram has no title field, so the first caption line stands in.
    expect(m.title).toBe("First line");
    expect(m.description).toBe("First line\nsecond line");
    expect(m.shareUrl).toBe("https://www.instagram.com/p/abc/");
  });

  it("leaves a metric absent in `exact` when Instagram does not support it for that media type", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "media2",
              caption: "an image",
              media_type: "IMAGE",
              permalink: "https://www.instagram.com/p/def/",
              timestamp: "2026-08-03T09:00:00+0000",
              like_count: 12,
              comments_count: 1,
            },
          ],
        }),
      )
      // `shares` is reels-only; the edge answers with views alone.
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ name: "views", values: [{ value: 400 }] }] }),
      );

    const media = await fetchInstagramMedia("token", "ig1");
    const m = media![0];
    expect(m.exact.views).toBe(400);
    // Absent as a NUMBER, which is what fetchPostMetrics tests before writing.
    // The key itself stays present, matching TikTokVideo.exact.
    expect(m.exact.shares).toBeUndefined();
    // The display counter still coerces to 0 so the portal can render it.
    expect(m.sharesCount).toBe(0);
    expect(m.exact.likes).toBe(12);
  });

  it("retries with views alone when Instagram rejects the combined metric set", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "media4",
              caption: "a carousel",
              media_type: "CAROUSEL_ALBUM",
              permalink: "https://www.instagram.com/p/jkl/",
              timestamp: "2026-08-05T09:00:00+0000",
              like_count: 40,
              comments_count: 3,
            },
          ],
        }),
      )
      // Instagram answers 400 code 100 for the WHOLE request when one metric
      // is unsupported for the media — it does not omit just that metric.
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 100, message: "Invalid parameter" } }, false, 400),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ name: "views", values: [{ value: 777 }] }] }),
      );
    global.fetch = fetchMock;

    const media = await fetchInstagramMedia("token", "ig1");
    expect(media![0].exact.views).toBe(777);
    expect(media![0].exact.shares).toBeUndefined();
    const metrics = fetchMock.mock.calls
      .map(([url]) => new URL(String(url)).searchParams.get("metric"))
      .filter(Boolean);
    expect(metrics).toEqual(["views,shares", "views"]);
  });

  it("survives an insights call that fails for one media, leaving views unmeasured", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "media3",
              caption: "c",
              permalink: "https://www.instagram.com/p/ghi/",
              timestamp: "2026-08-04T09:00:00+0000",
              like_count: 5,
              comments_count: 0,
            },
          ],
        }),
      )
      // Both the combined call and the views-only retry fail — the shape of a
      // post published before the account became a Business account.
      .mockResolvedValueOnce(jsonResponse({}, false, 400))
      .mockResolvedValueOnce(jsonResponse({}, false, 400));

    const media = await fetchInstagramMedia("token", "ig1");
    expect(media).toHaveLength(1);
    expect(media![0].exact.views).toBeUndefined();
    expect(media![0].likesCount).toBe(5);
  });

  it("returns an empty array when the account has posted nothing", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({ data: [] }));
    await expect(fetchInstagramMedia("token", "ig1")).resolves.toEqual([]);
  });

  it("returns null when the media edge itself fails, so the portal can say reconnect", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(null, false, 500));
    await expect(fetchInstagramMedia("token", "ig1")).resolves.toBeNull();
  });
});
