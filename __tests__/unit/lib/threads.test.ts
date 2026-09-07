import {
  fetchThreadsProfile,
  fetchThreadsPosts,
  exchangeThreadsToken,
  refreshThreadsToken,
} from "@/lib/platforms/threads";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

const PROFILE = {
  id: "77881122",
  username: "boringbrand",
  name: "Boring Brand",
  threads_profile_picture_url: "https://cdn.example/t.jpg",
  threads_biography: "we make boring things",
};

describe("fetchThreadsProfile", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("maps identity and takes the follower count from the insights edge", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(PROFILE))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ name: "followers_count", total_value: { value: 5300 } }],
        }),
      );

    await expect(fetchThreadsProfile("token")).resolves.toEqual({
      threadsUserId: "77881122",
      username: "boringbrand",
      displayName: "Boring Brand",
      avatarUrl: "https://cdn.example/t.jpg",
      bio: "we make boring things",
      profileLink: "https://www.threads.net/@boringbrand",
      // The Threads API exposes no verified flag at all.
      isVerified: false,
      followerCount: 5300,
      mediaCount: null,
    });
  });

  it("reports a follower count it could not read as null, not as zero", async () => {
    // A brand-new account genuinely has 0 followers; the two must stay apart.
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(PROFILE))
      .mockResolvedValueOnce(jsonResponse({}, false, 403));
    const profile = await fetchThreadsProfile("token");
    expect(profile?.followerCount).toBeNull();
  });

  it("does not reach the Facebook Graph host", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(PROFILE))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    global.fetch = fetchMock;
    await fetchThreadsProfile("token");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("graph.threads.net");
    expect(url).not.toContain("graph.facebook.com");
  });

  it("returns null when the token carries no Threads profile", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, false, 401));
    await expect(fetchThreadsProfile("token")).resolves.toBeNull();
  });
});

describe("fetchThreadsPosts", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("maps replies to comments and sums reposts and quotes into shares", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "th_1",
              text: "First line\nsecond line",
              permalink: "https://www.threads.net/@boringbrand/post/abc",
              timestamp: "2026-08-02T09:00:00+0000",
              thumbnail_url: "https://cdn.example/th.jpg",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { name: "views", total_value: { value: 9100 } },
            { name: "likes", total_value: { value: 220 } },
            { name: "replies", total_value: { value: 14 } },
            { name: "reposts", total_value: { value: 20 } },
            { name: "quotes", total_value: { value: 13 } },
          ],
        }),
      );

    const posts = await fetchThreadsPosts("token");
    expect(posts).toHaveLength(1);
    const p = posts![0];
    expect(p.viewsCount).toBe(9100);
    expect(p.likesCount).toBe(220);
    expect(p.commentsCount).toBe(14);
    // Two distinct ways to share a thread, so the share count is their sum.
    expect(p.sharesCount).toBe(33);
    expect(p.title).toBe("First line");
    expect(p.shareUrl).toBe("https://www.threads.net/@boringbrand/post/abc");
  });

  it("leaves shares absent when neither reposts nor quotes came back", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "th_2", text: "t", timestamp: "2026-08-03T09:00:00+0000" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ name: "views", total_value: { value: 40 } }] }),
      );
    const p = (await fetchThreadsPosts("token"))![0];
    expect(p.exact.views).toBe(40);
    expect(p.exact.shares).toBeUndefined();
    expect(p.sharesCount).toBe(0);
  });

  it("counts a repost with no quotes rather than discarding it", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "th_3", text: "t", timestamp: "2026-08-03T09:00:00+0000" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ name: "reposts", total_value: { value: 7 } }] }),
      );
    const p = (await fetchThreadsPosts("token"))![0];
    expect(p.exact.shares).toBe(7);
  });

  it("returns an empty array when the creator has posted nothing", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({ data: [] }));
    await expect(fetchThreadsPosts("token")).resolves.toEqual([]);
  });

  it("returns null when the post edge itself fails", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({}, false, 500));
    await expect(fetchThreadsPosts("token")).resolves.toBeNull();
  });
});

describe("Threads token lifecycle", () => {
  const realFetch = global.fetch;
  const realEnv = { ...process.env };
  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...realEnv };
  });

  it("exchanges a short-lived token for a long-lived one with an expiry", async () => {
    process.env.THREADS_CLIENT_SECRET = "th-secret";
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "long", expires_in: 5184000 }));
    const result = await exchangeThreadsToken("short");
    expect(result?.accessToken).toBe("long");
    expect(result?.expiresAt).toBeInstanceOf(Date);
  });

  it("refuses to exchange when no client secret is configured", async () => {
    delete process.env.THREADS_CLIENT_SECRET;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    await expect(exchangeThreadsToken("short")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes in place, presenting the current token as the credential", async () => {
    // Threads has no refresh token: the access token refreshes itself, which is
    // why an expired one cannot be recovered at all.
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "extended", expires_in: 5184000 }));
    global.fetch = fetchMock;
    const result = await refreshThreadsToken("current-token");
    expect(result?.accessToken).toBe("extended");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("grant_type=th_refresh_token");
    expect(url).toContain("access_token=current-token");
  });

  it("returns null when the refresh is rejected", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, false, 400));
    await expect(refreshThreadsToken("dead")).resolves.toBeNull();
  });
});
