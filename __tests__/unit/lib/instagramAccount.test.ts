import {
  fetchInstagramAccount,
  fetchInstagramMedia,
} from "@/lib/platforms/instagramAccount";
import { fetchInstagramLoginProfile } from "@/lib/platforms/instagramLogin";

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
      },
    },
  ],
};

/** me/accounts answers `accounts`; the IG User's own media_count read answers `mediaCount`. */
function routeFetch(accounts: unknown, mediaCount: (() => Promise<Response>) | unknown = { id: "17841400000000000", media_count: 214 }) {
  return jest.fn((url: string) => {
    if (new URL(url).pathname.endsWith("/me/accounts")) return Promise.resolve(jsonResponse(accounts));
    return typeof mediaCount === "function"
      ? (mediaCount as () => Promise<Response>)()
      : Promise.resolve(jsonResponse(mediaCount));
  });
}

describe("fetchInstagramAccount", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it("maps the identity behind the creator's token", async () => {
    global.fetch = routeFetch(IG_ACCOUNT) as unknown as typeof fetch;
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

  it("keeps media_count out of me/accounts and reads it from the IG User with a longer budget", async () => {
    const signalCtor = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
    const hadTimeout = Object.prototype.hasOwnProperty.call(signalCtor, "timeout");
    const realTimeout = signalCtor.timeout;
    const timeouts = jest.fn((_ms: number) => new AbortController().signal);
    signalCtor.timeout = timeouts;
    const fetchMock = routeFetch(IG_ACCOUNT);
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      await fetchInstagramAccount("token");
    } finally {
      if (hadTimeout) signalCtor.timeout = realTimeout;
      else delete signalCtor.timeout;
    }

    const urls = fetchMock.mock.calls.map(([u]) => new URL(u as string));
    expect(urls).toHaveLength(2);
    expect(urls[0].pathname).toMatch(/\/me\/accounts$/);
    expect(urls[0].searchParams.get("fields")).not.toContain("media_count");
    expect(urls[0].searchParams.get("fields")).toContain("followers_count");
    expect(urls[1].pathname).toMatch(/\/17841400000000000$/);
    expect(urls[1].searchParams.get("fields")).toBe("media_count");
    expect(timeouts.mock.calls.map(([ms]) => ms)).toEqual([5000, 15000]);
  });

  it("a media_count that times out costs the count, not the connection", async () => {
    global.fetch = routeFetch(IG_ACCOUNT, () =>
      Promise.reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })),
    ) as unknown as typeof fetch;
    await expect(fetchInstagramAccount("token")).resolves.toMatchObject({
      igUserId: "17841400000000000",
      username: "boringbrand",
      followerCount: 8421,
      mediaCount: null,
    });
  });

  it("still surfaces an auth failure on the media_count read", async () => {
    global.fetch = routeFetch(IG_ACCOUNT, () =>
      Promise.resolve(jsonResponse({ error: { code: 190, message: "Session has expired" } }, false, 400)),
    ) as unknown as typeof fetch;
    await expect(fetchInstagramAccount("token")).rejects.toMatchObject({ name: "InstagramAuthError" });
  });

  it("skips pages with no Instagram Business account and uses the first that has one", async () => {
    global.fetch = routeFetch({ data: [{ id: "page-no-ig" }, ...IG_ACCOUNT.data] }) as unknown as typeof fetch;
    const info = await fetchInstagramAccount("token");
    expect(info?.igUserId).toBe("17841400000000000");
  });

  it("reports a count the Graph response omitted as null, never 0 (plan A9)", async () => {
    const rest: Record<string, unknown> = { ...IG_ACCOUNT.data[0].instagram_business_account };
    delete rest.followers_count;
    global.fetch = routeFetch(
      { data: [{ instagram_business_account: rest }] },
      { id: "17841400000000000" },
    ) as unknown as typeof fetch;
    const info = await fetchInstagramAccount("token");
    expect(info).toMatchObject({ followerCount: null, followingCount: 310, mediaCount: null });
  });

  it("keeps a measured 0 (a brand-new account with no posts)", async () => {
    global.fetch = routeFetch(IG_ACCOUNT, { id: "17841400000000000", media_count: 0 }) as unknown as typeof fetch;
    expect((await fetchInstagramAccount("token"))?.mediaCount).toBe(0);
  });

  it("returns null when the token carries no Instagram Business account at all", async () => {
    const fetchMock = routeFetch({ data: [{ id: "p1" }] });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(fetchInstagramAccount("token")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(fetchMock.mock.calls[1][0]).pathname).toMatch(/\/me\/assigned_instagram_accounts$/);
  });

  it("reads a Unified login token's account through assigned_instagram_accounts when the Pages edge refuses it", async () => {
    const account = IG_ACCOUNT.data[0].instagram_business_account;
    const fetchMock = jest.fn((url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/me/accounts"))
        return Promise.resolve(jsonResponse({ error: { code: 200, message: "Requires pages_show_list" } }, false, 403));
      if (path.endsWith("/me/assigned_instagram_accounts"))
        return Promise.resolve(jsonResponse({ data: [{ id: account.id }] }));
      if (new URL(url).searchParams.get("fields") === "media_count")
        return Promise.resolve(jsonResponse({ id: account.id, media_count: 12 }));
      return Promise.resolve(jsonResponse(account));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(fetchInstagramAccount("token")).resolves.toMatchObject({
      igUserId: account.id,
      username: "boringbrand",
      followerCount: 8421,
      mediaCount: 12,
    });
  });

  it("still fails as an auth error when both edges refuse the token", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(jsonResponse({ error: { code: 190, message: "expired" } }, false, 401)),
    ) as unknown as typeof fetch;
    await expect(fetchInstagramAccount("token")).rejects.toThrow("expired");
  });
});

describe("fetchInstagramMedia", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("maps the four counters, taking views, reach and shares from the insights edge", async () => {
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
            { name: "reach", values: [{ value: 6400 }] },
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
    expect(m.exact.reach).toBe(6400);
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

  it("narrows the metric set when Instagram rejects the combined one", async () => {
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
    expect(metrics).toEqual(["views,reach,shares", "views,reach", "views"]);
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
      // Every narrowed retry fails — the shape of a post published before the
      // account became a Business account.
      .mockResolvedValueOnce(jsonResponse({}, false, 400))
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

describe("fetchInstagramLoginProfile", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("reports an omitted follower or media count as null, never 0 (plan A9)", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({ user_id: "17841400000000000", username: "boringbrand", follows_count: 12 }),
    );
    await expect(fetchInstagramLoginProfile("token", new AbortController().signal)).resolves.toMatchObject({
      igUserId: "17841400000000000",
      followerCount: null,
      followingCount: 12,
      mediaCount: null,
    });
  });

  it("passes measured counts through, 0 included", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({ user_id: "17841400000000000", username: "boringbrand", followers_count: 8421, follows_count: 0, media_count: 214 }),
    );
    await expect(fetchInstagramLoginProfile("token", new AbortController().signal)).resolves.toMatchObject({
      followerCount: 8421,
      followingCount: 0,
      mediaCount: 214,
    });
  });
});
