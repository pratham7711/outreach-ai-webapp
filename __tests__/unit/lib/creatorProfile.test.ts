import {
  READ_FAILURE_COPY,
  readCreatorProfile,
  type CreatorReadFailure,
} from "@/lib/platforms/creatorProfile";

describe("readCreatorProfile dispatch", () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env };
  });
  afterAll(() => {
    process.env = env;
  });

  it("does not claim to read platforms it has no reader for", async () => {
    // TikTok used to be listed here, back when it needed a browser the caller
    // had to inject. Profile pages turned out to be server-rendered, so it is
    // now dispatched from here like the rest and no longer belongs in this set.
    for (const platform of ["TWITTER", "TWITCH", "THREADS"]) {
      await expect(readCreatorProfile(platform, "someone")).resolves.toEqual({
        ok: false,
        reason: "unsupported-platform",
      });
    }
  });

  it("reports a missing token as missing credentials, not as an unreadable creator", async () => {
    // These are entirely different problems: one is our configuration, the other
    // is the creator's account. Collapsing them would send someone to check a
    // creator's privacy settings over an env var we never set.
    delete process.env.INSTAGRAM_BUSINESS_TOKEN;
    await expect(readCreatorProfile("INSTAGRAM", "someone")).resolves.toEqual({
      ok: false,
      reason: "no-credentials",
    });

    delete process.env.YOUTUBE_API_KEY;
    await expect(readCreatorProfile("YOUTUBE", "someone")).resolves.toEqual({
      ok: false,
      reason: "no-credentials",
    });
  });

  it("rejects an empty YouTube handle before spending a quota unit on it", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    const result = await readCreatorProfile("YOUTUBE", "  @  ");
    expect(result.ok).toBe(false);
  });

  it("is case-insensitive about the platform, which arrives from a Prisma enum", async () => {
    delete process.env.YOUTUBE_API_KEY;
    await expect(readCreatorProfile("youtube", "x")).resolves.toEqual({
      ok: false,
      reason: "no-credentials",
    });
  });
});

describe("READ_FAILURE_COPY", () => {
  it("has reader-facing copy for every failure the reader can produce", () => {
    // A missing entry renders as undefined in the UI, which is worse than the
    // blank cell this whole change set out to remove.
    const all: CreatorReadFailure[] = [
      "no-credentials",
      "unsupported-platform",
      "not-a-professional-account",
      "unreadable",
      "rate-limited",
    ];
    for (const reason of all) {
      expect(typeof READ_FAILURE_COPY[reason]).toBe("string");
      expect(READ_FAILURE_COPY[reason].length).toBeGreaterThan(10);
    }
  });

  it("explains the Instagram case specifically, since it is permanent", () => {
    expect(READ_FAILURE_COPY["not-a-professional-account"]).toMatch(/Business and Creator/i);
  });
});

describe("rankTopPosts", () => {
  const { rankTopPosts, TOP_POSTS_LIMIT } = jest.requireActual("@/lib/platforms/creatorProfile");
  const post = (postId: string, views: number | null, likes: number | null = null) => ({
    postId, url: null, caption: null, coverUrl: null,
    views, likes, comments: null, postedAt: null,
  });

  it("ranks by views and caps at the limit", () => {
    const posts = Array.from({ length: TOP_POSTS_LIMIT + 4 }, (_, i) => post(`p${i}`, i * 100));
    const ranked = rankTopPosts(posts);
    expect(ranked).toHaveLength(TOP_POSTS_LIMIT);
    expect(ranked[0].postId).toBe(`p${TOP_POSTS_LIMIT + 3}`);
  });

  it("lets a still with only likes compete instead of excluding it", () => {
    // Instagram omits view_count on stills rather than sending zero. A still
    // with real engagement should rank above a reel nobody watched.
    const ranked = rankTopPosts([post("reel", 5), post("still", null, 900)]);
    expect(ranked[0].postId).toBe("still");
  });

  it("does not mutate the caller's array", () => {
    const posts = [post("a", 1), post("b", 2)];
    rankTopPosts(posts);
    expect(posts[0].postId).toBe("a");
  });
});
