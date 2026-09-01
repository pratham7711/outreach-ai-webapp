import { fetchTikTokProfile } from "@/lib/platforms/tiktokProfile";

function pageWith(userInfo: unknown): string {
  const blob = JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.user-detail": { userInfo } } });
  return `<html><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${blob}</script></body></html>`;
}

function mockHtml(html: string, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => html,
  }) as unknown as typeof fetch;
}

describe("fetchTikTokProfile", () => {
  afterEach(() => jest.restoreAllMocks());

  it("prefers the exact statsV2 figure over the rounded stats one", async () => {
    // TikTok ships both: stats is rounded for display, statsV2 is exact. A
    // tracker built on the rounded value reports zero change until the creator
    // crosses a 100k boundary, which is why this preference is load-bearing.
    mockHtml(
      pageWith({
        stats: { followerCount: 2600000, videoCount: 3553 },
        statsV2: { followerCount: "2631012", videoCount: "3553" },
      })
    );
    const res = await fetchTikTokProfile("sonheii");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.profile.followersCount).toBe(2631012);
      expect(res.profile.postsCount).toBe(3553);
    }
  });

  it("falls back to stats when statsV2 is absent", async () => {
    mockHtml(pageWith({ stats: { followerCount: 1234, videoCount: 7 } }));
    const res = await fetchTikTokProfile("someone");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.profile.followersCount).toBe(1234);
  });

  it("reports sampledPosts 0 so the caller does not overwrite avgViews", async () => {
    // The profile page carries no per-post view counts, so avgViews is not
    // measured here. 0 sampled posts means "unknown", not "averaged to zero".
    mockHtml(pageWith({ statsV2: { followerCount: "10", videoCount: "2" } }));
    const res = await fetchTikTokProfile("someone");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.profile.sampledPosts).toBe(0);
      expect(res.profile.avgViews).toBe(0);
    }
  });

  it("distinguishes a stripped shell from a parse failure", async () => {
    mockHtml("<html><body>nothing here</body></html>");
    const res = await fetchTikTokProfile("someone");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("unreadable");
      expect(res.detail).toMatch(/no rehydration blob/);
    }
  });

  it("maps 429 to rate-limited rather than unreadable", async () => {
    mockHtml("", 429);
    const res = await fetchTikTokProfile("someone");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("rate-limited");
  });

  it("treats a 404 as a missing account", async () => {
    mockHtml("", 404);
    const res = await fetchTikTokProfile("nope");
    expect(res.ok).toBe(false);
    /* The claim used to live in the free-text detail, which nothing shows the
       operator -- the UI maps the reason to copy. It is now the reason. */
    if (!res.ok) expect(res.reason).toBe("no-such-account");
  });
});
