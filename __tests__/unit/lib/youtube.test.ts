import {
  fetchYouTubeChannel,
  fetchYouTubeVideos,
  refreshYouTubeAccessToken,
} from "@/lib/platforms/youtube";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

const CHANNEL = {
  items: [
    {
      id: "UC_channel_1",
      snippet: {
        title: "Boring Channel",
        customUrl: "@boringchannel",
        description: "we make boring things",
        thumbnails: {
          default: { url: "https://i.example/d.jpg" },
          high: { url: "https://i.example/h.jpg" },
        },
      },
      // Every statistic arrives as a decimal STRING, not a number.
      statistics: { subscriberCount: "12300", videoCount: "48", viewCount: "998877" },
      contentDetails: { relatedPlaylists: { uploads: "UU_uploads_1" } },
    },
  ],
};

describe("fetchYouTubeChannel", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("maps identity and coerces the string statistics to numbers", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(CHANNEL));
    const info = await fetchYouTubeChannel("token");
    expect(info).toEqual({
      channelId: "UC_channel_1",
      username: "boringchannel",
      displayName: "Boring Channel",
      avatarUrl: "https://i.example/h.jpg",
      bio: "we make boring things",
      profileLink: "https://www.youtube.com/@boringchannel",
      isVerified: false,
      followerCount: 12300,
      followingCount: 0,
      mediaCount: 48,
      totalViews: 998877,
      uploadsPlaylistId: "UU_uploads_1",
    });
  });

  it("sends the token as a bearer header, never as a query parameter", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(CHANNEL));
    global.fetch = fetchMock;
    await fetchYouTubeChannel("secret-token");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("secret-token");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer secret-token",
    });
  });

  it("reports a hidden subscriber count as null, not as zero", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: "UC_2",
            snippet: { title: "Hidden", thumbnails: {} },
            statistics: { hiddenSubscriberCount: true, videoCount: "3" },
            contentDetails: { relatedPlaylists: { uploads: "UU_2" } },
          },
        ],
      }),
    );
    const info = await fetchYouTubeChannel("token");
    expect(info?.followerCount).toBeNull();
    expect(info?.mediaCount).toBe(3);
  });

  it("falls back to the channel title when no custom URL is claimed", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: "UC_3",
            snippet: { title: "No Handle Here", thumbnails: {} },
            statistics: {},
            contentDetails: { relatedPlaylists: { uploads: "UU_3" } },
          },
        ],
      }),
    );
    const info = await fetchYouTubeChannel("token");
    expect(info?.username).toBe("No Handle Here");
    expect(info?.profileLink).toBe("https://www.youtube.com/channel/UC_3");
  });

  it("returns null when the token is rejected", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, false, 401));
    await expect(fetchYouTubeChannel("expired")).resolves.toBeNull();
  });

  it("returns null when the request throws", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));
    await expect(fetchYouTubeChannel("token")).resolves.toBeNull();
  });
});

describe("fetchYouTubeVideos", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("maps the counters the portal reads and leaves shares unmeasured", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ contentDetails: { videoId: "vid1" } }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "vid1",
              snippet: {
                title: "A video",
                description: "about things",
                publishedAt: "2026-08-01T10:00:00Z",
                thumbnails: { high: { url: "https://i.example/v.jpg" } },
              },
              statistics: { viewCount: "5000", likeCount: "120", commentCount: "8" },
              status: { privacyStatus: "public" },
            },
          ],
        }),
      );

    const videos = await fetchYouTubeVideos("token", "UU_uploads_1");
    expect(videos).toHaveLength(1);
    const v = videos![0];
    expect(v.viewsCount).toBe(5000);
    expect(v.likesCount).toBe(120);
    expect(v.commentsCount).toBe(8);
    expect(v.shareUrl).toBe("https://www.youtube.com/watch?v=vid1");
    // The Data API has no share metric, so recording 0 in `exact` would invent
    // a measurement that fetchPostMetrics would then persist as fact.
    expect(v.exact).not.toHaveProperty("shares");
    expect(v.exact.views).toBe(5000);
    expect(v.exact.createdAt).toEqual(new Date("2026-08-01T10:00:00Z"));
  });

  it("drops unlisted and private uploads, which the uploads playlist includes", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            { contentDetails: { videoId: "pub" } },
            { contentDetails: { videoId: "unl" } },
            { contentDetails: { videoId: "prv" } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            { id: "pub", snippet: { title: "Public" }, statistics: {}, status: { privacyStatus: "public" } },
            { id: "unl", snippet: { title: "Unlisted" }, statistics: {}, status: { privacyStatus: "unlisted" } },
            { id: "prv", snippet: { title: "Private" }, statistics: {}, status: { privacyStatus: "private" } },
          ],
        }),
      );
    global.fetch = fetchMock;

    const videos = await fetchYouTubeVideos("token", "UU_1");
    expect(videos!.map((v) => v.id)).toEqual(["pub"]);
    // The status part is what makes the filter possible at all.
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("part")).toBe(
      "snippet,statistics,status",
    );
  });

  it("returns an empty array when the channel has no uploads", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({ items: [] }));
    await expect(fetchYouTubeVideos("token", "UU_empty")).resolves.toEqual([]);
  });

  it("omits createdAt rather than stamping today when publishedAt is missing", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ contentDetails: { videoId: "vid2" } }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "vid2",
              snippet: { title: "t", thumbnails: {} },
              statistics: {},
              status: { privacyStatus: "public" },
            },
          ],
        }),
      );
    const videos = await fetchYouTubeVideos("token", "UU_1");
    expect(videos![0].exact).not.toHaveProperty("createdAt");
  });

  it("returns null when the playlist call fails", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({}, false, 403));
    await expect(fetchYouTubeVideos("token", "UU_1")).resolves.toBeNull();
  });

  it("returns null when the statistics call fails", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ contentDetails: { videoId: "vid1" } }] }),
      )
      .mockResolvedValueOnce(jsonResponse({}, false, 401));
    await expect(fetchYouTubeVideos("token", "UU_1")).resolves.toBeNull();
  });
});

describe("refreshYouTubeAccessToken", () => {
  const realFetch = global.fetch;
  const realEnv = { ...process.env };
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "gid";
    process.env.GOOGLE_CLIENT_SECRET = "gsecret";
  });
  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...realEnv };
  });

  it("reports refreshToken as null when Google returns none, so the caller keeps its own", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "fresh", expires_in: 3600 }));
    const refreshed = await refreshYouTubeAccessToken("stored-refresh");
    expect(refreshed?.accessToken).toBe("fresh");
    // Google does not reissue refresh tokens; null here means "unchanged", and
    // overwriting the stored one with it would break every connection.
    expect(refreshed?.refreshToken).toBeNull();
    expect(refreshed?.expiresAt).toBeInstanceOf(Date);
  });

  it("returns null on invalid_grant, which is the unpublished-app 7-day expiry", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ error: "invalid_grant" }, false, 400));
    await expect(refreshYouTubeAccessToken("stale")).resolves.toBeNull();
  });

  it("refuses to call Google when no client credentials are configured", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    await expect(refreshYouTubeAccessToken("r")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
