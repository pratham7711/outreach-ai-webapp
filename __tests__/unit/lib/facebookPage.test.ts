import {
  fetchFacebookPage,
  fetchFacebookPagePosts,
} from "@/lib/platforms/facebookPage";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

const PAGE = {
  data: [
    {
      id: "1122334455",
      name: "Boring Brand",
      username: "boringbrand",
      link: "https://www.facebook.com/boringbrand",
      about: "we make boring things",
      fan_count: 4000,
      followers_count: 8421,
      verification_status: "blue_verified",
      picture: { data: { url: "https://cdn.example/p.jpg" } },
      access_token: "page-token-abc",
    },
  ],
};

describe("fetchFacebookPage", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("maps the Page identity behind the creator's user token", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(PAGE));
    await expect(fetchFacebookPage("user-token")).resolves.toEqual({
      pageId: "1122334455",
      username: "boringbrand",
      displayName: "Boring Brand",
      avatarUrl: "https://cdn.example/p.jpg",
      bio: "we make boring things",
      profileLink: "https://www.facebook.com/boringbrand",
      isVerified: true,
      // followers_count wins over the older fan_count when both are present.
      followerCount: 8421,
      mediaCount: null,
      pageAccessToken: "page-token-abc",
    });
  });

  it("falls back to fan_count, which is all an older Page answers with", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        data: [{ id: "1", name: "Old Page", fan_count: 1200, access_token: "t" }],
      }),
    );
    const page = await fetchFacebookPage("user-token");
    expect(page?.followerCount).toBe(1200);
  });

  it("reads not_verified as unverified rather than as a verified Page", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        data: [
          { id: "1", name: "P", verification_status: "not_verified", access_token: "t" },
        ],
      }),
    );
    const page = await fetchFacebookPage("user-token");
    expect(page?.isVerified).toBe(false);
  });

  it("returns null when the token administers no Page", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ data: [] }));
    await expect(fetchFacebookPage("user-token")).resolves.toBeNull();
  });

  it("refuses a Page that returned no page access token", async () => {
    // Without it nothing below the Page is readable, so storing the connection
    // would produce a card that is permanently empty rather than one that fails.
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ id: "1", name: "No Token" }] }));
    await expect(fetchFacebookPage("user-token")).resolves.toBeNull();
  });
});

describe("fetchFacebookPagePosts", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("maps the summaries and takes views from the insights edge", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "1122_9988",
              message: "First line\nsecond line",
              created_time: "2026-08-02T09:00:00+0000",
              permalink_url: "https://www.facebook.com/boringbrand/posts/9988",
              full_picture: "https://cdn.example/f.jpg",
              shares: { count: 33 },
              comments: { summary: { total_count: 14 } },
              likes: { summary: { total_count: 220 } },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ name: "post_media_view", values: [{ value: 9100 }] }],
        }),
      );

    const posts = await fetchFacebookPagePosts("1122334455", "page-token");
    expect(posts).toHaveLength(1);
    const p = posts![0];
    expect(p.viewsCount).toBe(9100);
    expect(p.likesCount).toBe(220);
    expect(p.commentsCount).toBe(14);
    expect(p.sharesCount).toBe(33);
    // Facebook posts carry no title, so the first line of the message stands in.
    expect(p.title).toBe("First line");
    expect(p.description).toBe("First line\nsecond line");
  });

  it("sends the PAGE token, never the user token, to the posts edge", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    global.fetch = fetchMock;
    await fetchFacebookPagePosts("1122334455", "page-token-abc");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("access_token=page-token-abc");
  });

  it("leaves an unreadable metric absent in `exact` rather than recording zero", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "p2",
              message: "no shares on this one",
              created_time: "2026-08-03T09:00:00+0000",
              likes: { summary: { total_count: 5 } },
            },
          ],
        }),
      )
      // read_insights not granted, or the metric is unavailable for this post
      .mockResolvedValueOnce(jsonResponse({}, false, 400));

    const posts = await fetchFacebookPagePosts("1", "page-token");
    const p = posts![0];
    expect(p.exact.views).toBeUndefined();
    expect(p.exact.shares).toBeUndefined();
    expect(p.exact.likes).toBe(5);
    // The display counter still coerces so the portal can render a number.
    expect(p.viewsCount).toBe(0);
  });

  it("returns an empty array for a Page that has published nothing", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({ data: [] }));
    await expect(fetchFacebookPagePosts("1", "t")).resolves.toEqual([]);
  });

  it("returns null when the posts edge itself fails, so the portal says reconnect", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(null, false, 500));
    await expect(fetchFacebookPagePosts("1", "t")).resolves.toBeNull();
  });
});
