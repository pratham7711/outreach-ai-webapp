/**
 * The one rule the whole metrics pipeline rests on.
 *
 * Every counter column is a non-nullable Float defaulting to 0, so
 * `lastSyncedAt` is the ONLY thing separating "this post got no likes" from
 * "nobody has looked". Stamp it on a fetch that returned nothing and a
 * screenful of unknowns silently becomes a screenful of measured zeros, which
 * no later sync can tell apart again.
 *
 * This suite exists because three different callers each kept their own copy of
 * that rule and one of them -- the hourly cron -- had it backwards, writing
 * `{ lastSyncedAt: now, syncFailCount: 0 }` on both branches. It ran in
 * production once an hour and re-poisoned whatever the on-demand refresh
 * repaired. All three now share applyPostMetrics, so this is where the rule is
 * asserted.
 */

const mockUpdate = jest.fn();
const mockTransaction = jest.fn();
const mockSnapshotCreate = jest.fn();
const mockCreatorUpdate = jest.fn();
const mockCreatorUpdateMany = jest.fn();

jest.mock("@/lib/db", () => ({
  db: {
    post: { update: (...a: any[]) => mockUpdate(...a) },
    postMetricSnapshot: { create: (...a: any[]) => mockSnapshotCreate(...a) },
    creator: {
      update: (...a: any[]) => mockCreatorUpdate(...a),
      updateMany: (...a: any[]) => mockCreatorUpdateMany(...a),
    },
    $transaction: (...a: any[]) => mockTransaction(...a),
  },
}));

import { applyPostMetrics, keepPrecise } from "@/lib/sync/syncPost";
import { EXACT, TIKTOK_DISPLAY, YOUTUBE_SUBSCRIBERS } from "@/lib/platforms/precision";
import type { PostMetrics } from "@/lib/platforms/fetchPostMetrics";

const post = {
  id: "post_1",
  platform: "INSTAGRAM",
  creatorId: "creator_1",
  postUrl: "https://instagram.com/p/Cabc",
  thumbnailUrl: "old.jpg",
  caption: "old caption",
};

const metrics = (over: Partial<PostMetrics> = {}): PostMetrics =>
  ({
    platform: "INSTAGRAM",
    platformPostId: "Cabc",
    thumbnailUrl: null,
    caption: null,
    ...over,
  }) as PostMetrics;

/** The write that lands on the post row, whichever branch produced it. */
function postWriteData() {
  if (mockTransaction.mock.calls.length > 0) return mockUpdate.mock.calls[0][0].data;
  return mockUpdate.mock.calls[0][0].data;
}

beforeEach(() => {
  mockUpdate.mockReset().mockResolvedValue({ id: "post_1" });
  mockSnapshotCreate.mockReset().mockResolvedValue({});
  mockCreatorUpdate.mockReset().mockResolvedValue({});
  mockCreatorUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  // The real $transaction resolves the array it is handed; the calls inside it
  // have already been made by the time it runs, which is what we assert on.
  mockTransaction.mockReset().mockImplementation(async (ops: unknown[]) => {
    await Promise.all(ops as Promise<unknown>[]);
    return [{ id: "post_1" }];
  });
});

describe("applyPostMetrics — lastSyncedAt means measured", () => {
  it("does NOT stamp lastSyncedAt when nothing countable came back", async () => {
    const outcome = await applyPostMetrics(post, metrics({ fetchReason: "platform-challenged" }));

    expect(outcome.status).toBe("no-metrics");
    const data = postWriteData();
    expect(data).not.toHaveProperty("lastSyncedAt");
    // And it writes no counters either -- an absent counter must not become 0.
    expect(data).not.toHaveProperty("viewsCount");
    expect(data).not.toHaveProperty("likesCount");
    expect(mockSnapshotCreate).not.toHaveBeenCalled();
  });

  it("keeps the existing thumbnail and caption rather than nulling them", async () => {
    await applyPostMetrics(post, metrics({ fetchReason: "backing-off" }));
    const data = postWriteData();
    expect(data.thumbnailUrl).toBe("old.jpg");
    expect(data.caption).toBe("old caption");
  });

  it("reports the reason the fetcher gave, so a caller can decide to retry", async () => {
    const outcome = await applyPostMetrics(post, metrics({ fetchReason: "platform-refused" }));
    expect(outcome).toMatchObject({ status: "no-metrics", reason: "platform-refused" });
  });

  it('falls back to "unknown", never to "no-counts-published"', async () => {
    // A fetcher that named no reason has told us nothing about the POST.
    // "no-counts-published" is a positive claim and is treated as settled, so
    // defaulting to it is how silence became a permanent verdict.
    const outcome = await applyPostMetrics(post, metrics());
    expect(outcome).toMatchObject({ status: "no-metrics", reason: "unknown" });
  });

  it("stamps lastSyncedAt once real counts arrive", async () => {
    const outcome = await applyPostMetrics(post, metrics({ likesCount: 4100, commentsCount: 87 }));

    expect(outcome.status).toBe("measured");
    const data = postWriteData();
    expect(data.lastSyncedAt).toBeInstanceOf(Date);
    expect(data.fetchState).toBe("LIVE");
  });
});

describe("applyPostMetrics — writes only what the platform reported", () => {
  it("stores an Instagram photo's likes and comments without inventing views", async () => {
    await applyPostMetrics(post, metrics({ likesCount: 4100, commentsCount: 87 }));

    const data = postWriteData();
    expect(data.likesCount).toBe(4100);
    expect(data.commentsCount).toBe(87);
    /* The column stays at whatever it held. Writing 0 here is the bug: it is
       indistinguishable from a post nobody watched, and an image post has no
       play count to report in the first place. */
    expect(data).not.toHaveProperty("viewsCount");
    expect(data).not.toHaveProperty("sharesCount");
  });

  it("records which counters were measured, so the UI can tell 0 from unknown", async () => {
    await applyPostMetrics(post, metrics({ likesCount: 10, commentsCount: 2 }));
    const measured = postWriteData().platformMetrics;
    expect(Object.values(measured)[0]).toEqual(["likes", "comments"]);
  });

  it("does not touch postedAt unless the platform stated one", async () => {
    await applyPostMetrics(post, metrics({ likesCount: 10 }));
    expect(postWriteData()).not.toHaveProperty("postedAt");
  });
});

describe("applyPostMetrics — snapshot provenance", () => {
  it('signs the snapshot "api" by default', async () => {
    await applyPostMetrics(post, metrics({ viewsCount: 100, likesCount: 5 }));
    expect(mockSnapshotCreate.mock.calls[0][0].data.syncSource).toBe("api");
  });

  it("lets a caller sign its own work", async () => {
    /* /settings/ingestion groups snapshots by this and the post detail page
       shows it as a badge, so the cron adopting the shared writer must not
       relabel every one of its snapshots as "api". */
    await applyPostMetrics(post, metrics({ viewsCount: 100, likesCount: 5 }), {
      syncSource: "cron",
    });
    expect(mockSnapshotCreate.mock.calls[0][0].data.syncSource).toBe("cron");
  });
});

/**
 * The cause of a failed read, kept on the post.
 *
 * The aggregate on CampaignRefreshRun says how many posts went unmeasured and
 * never which, and the platform log lines age out of the retention window -- so
 * an hour after a run, "41 of 62 updated" could not be turned back into "these
 * 21, for this reason". These assertions are what make the post itself answer
 * that.
 */
describe("applyPostMetrics — the post records why a read came back empty", () => {
  beforeEach(() => jest.clearAllMocks());

  it("writes the reason, the time and the caller onto the post", async () => {
    mockUpdate.mockResolvedValue({ id: "post_1" });

    await applyPostMetrics(
      // platformMetrics present -- i.e. the caller selected it, as all of them do.
      { ...post, platformMetrics: {} } as any,
      metrics({ viewsCount: undefined, likesCount: undefined, commentsCount: undefined,
                sharesCount: undefined, fetchReason: "credentials-rejected" }),
      { syncSource: "cron" },
    );

    const bag = mockUpdate.mock.calls[0][0].data.platformMetrics;
    expect(bag.__lastFetch).toMatchObject({ reason: "credentials-rejected", via: "cron" });
    expect(typeof bag.__lastFetch.at).toBe("string");
    // No lastSyncedAt on this branch -- the rule this whole suite exists for.
    expect(mockUpdate.mock.calls[0][0].data.lastSyncedAt).toBeUndefined();
  });

  it("keeps the importer's own record in the bag rather than replacing it", async () => {
    mockUpdate.mockResolvedValue({ id: "post_1" });

    await applyPostMetrics(
      { ...post, platformMetrics: { ccRaw: { id: 9 } } } as any,
      metrics({ viewsCount: undefined, likesCount: undefined, commentsCount: undefined,
                sharesCount: undefined, fetchReason: "platform-challenged" }),
    );

    const bag = mockUpdate.mock.calls[0][0].data.platformMetrics;
    expect(bag.ccRaw).toEqual({ id: 9 });
    expect(bag.__lastFetch.reason).toBe("platform-challenged");
  });

  it("clears the reason once the post reads successfully again", async () => {
    mockTransaction.mockResolvedValue([{ id: "post_1" }, {}]);

    await applyPostMetrics(
      { ...post, platformMetrics: { __lastFetch: { reason: "platform-challenged", at: "x", via: "cron" } } } as any,
      metrics({ viewsCount: 10, likesCount: 2, commentsCount: 1 }),
    );

    /* A stale cause is worse than none: it sends someone to reconnect an
       account that is already working.

       Read straight off the post.update call -- it is recorded even though the
       success path wraps it in $transaction, because db.post.update is what is
       mocked. Asserted without a fallback on purpose: an `undefined ?? null`
       here would pass whether or not the field was ever written. */
    expect(mockUpdate).toHaveBeenCalled();
    const bag = mockUpdate.mock.calls[0][0].data.platformMetrics;
    expect(bag).toHaveProperty("__lastFetch", null);
    expect(bag.__measured).toEqual(expect.arrayContaining(["views"]));
  });
});

describe("applyPostMetrics — recording the cause never costs the bag", () => {
  beforeEach(() => jest.clearAllMocks());

  it("leaves platformMetrics untouched when the caller did not load it", async () => {
    mockUpdate.mockResolvedValue({ id: "post_1" });

    /* `post` here has no platformMetrics property at all -- what Prisma returns
       for a select that omits the column. Merging into {} and writing it back
       would replace the real bag with just the failure note, discarding
       __measured and the importer's record. */
    await applyPostMetrics(
      post as any,
      metrics({ viewsCount: undefined, likesCount: undefined, commentsCount: undefined,
                sharesCount: undefined, fetchReason: "platform-refused" }),
    );

    expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty("platformMetrics");
  });

  it("still records the cause when the column is loaded but empty", async () => {
    mockUpdate.mockResolvedValue({ id: "post_1" });

    // Selected and genuinely NULL is a different thing from not selected, and
    // Prisma reports them differently -- so this one is safe to write.
    await applyPostMetrics(
      { ...post, platformMetrics: null } as any,
      metrics({ viewsCount: undefined, likesCount: undefined, commentsCount: undefined,
                sharesCount: undefined, fetchReason: "platform-refused" }),
    );

    expect(mockUpdate.mock.calls[0][0].data.platformMetrics.__lastFetch.reason)
      .toBe("platform-refused");
  });
});

describe("a rounded read never destroys an exact figure", () => {
  /* TikTok's page serves counters at display precision above 10,000 -- 11.1K,
     563.3K, 15.5M -- while the CreatorCore import holds the platform's exact
     ones. 29 posts had the exact figure replaced by the rounded one, once an
     hour, for good. */

  it("keeps the stored exact count when the read only rounds to it", async () => {
    /* The shape actually measured on 2026-09-15: the page abbreviated views and
       likes and printed the comment count in full, in one payload. */
    await applyPostMetrics(
      { ...post, platform: "TIKTOK", viewsCount: 15_512_345, likesCount: 1_911_223 } as any,
      metrics({ viewsCount: 15_500_000, likesCount: 1_900_000, commentsCount: 5595 }),
    );

    const data = postWriteData();
    expect(data.viewsCount).toBe(15_512_345);
    expect(data.likesCount).toBe(1_911_223);
    // Exact on the wire, so it passes straight through.
    expect(data.commentsCount).toBe(5595);
  });

  it("takes the new figure once the count has grown past the rounding", async () => {
    await applyPostMetrics(
      { ...post, platform: "TIKTOK", viewsCount: 11094 } as any,
      metrics({ viewsCount: 24500 }),
    );

    expect(postWriteData().viewsCount).toBe(24500);
  });

  it("does not apply when the caller did not select the counters", async () => {
    await applyPostMetrics({ ...post, platform: "TIKTOK" } as any, metrics({ viewsCount: 11100 }));
    expect(postWriteData().viewsCount).toBe(11100);
  });

  describe("keepPrecise", () => {
    it("leaves a counter below TikTok's abbreviation threshold alone", () => {
      expect(keepPrecise(9319, 9000, TIKTOK_DISPLAY)).toBe(9319);
    });

    it("leaves a figure that is not on the display grid alone", () => {
      expect(keepPrecise(235138, 235000, TIKTOK_DISPLAY)).toBe(235138);
    });

    it("prefers neither when the stored figure is itself rounded", () => {
      expect(keepPrecise(11100, 11000, TIKTOK_DISPLAY)).toBe(11100);
    });

    it("keeps the exact figure inside the rounding window, either direction", () => {
      // Truncation would put the true count in [11100, 11200); round-to-nearest
      // in [11050, 11150). Both are honoured, because a platform that rounds the
      // other way must not lose the guard.
      expect(keepPrecise(11100, 11094, TIKTOK_DISPLAY)).toBe(11094);
      expect(keepPrecise(11100, 11163, TIKTOK_DISPLAY)).toBe(11163);
    });

    it("steps by 100k in the millions", () => {
      expect(keepPrecise(15_500_000, 15_512_345, TIKTOK_DISPLAY)).toBe(15_512_345);
      expect(keepPrecise(15_500_000, 12_000_001, TIKTOK_DISPLAY)).toBe(15_500_000);
    });

    it("ignores an absent or zero stored figure", () => {
      expect(keepPrecise(11100, undefined, TIKTOK_DISPLAY)).toBe(11100);
      expect(keepPrecise(11100, 0, TIKTOK_DISPLAY)).toBe(11100);
    });

    it("passes an absent incoming counter through untouched", () => {
      expect(keepPrecise(undefined, 11094, TIKTOK_DISPLAY)).toBeUndefined();
    });

    /* The ladder is the whole reason this takes a third argument: the same pair
       of numbers is a lossy overwrite on one platform and an ordinary update on
       another. */
    it("never fires for a platform that publishes the digits", () => {
      expect(keepPrecise(11100, 11094, EXACT)).toBe(11100);
      expect(keepPrecise(2_400_000, 2_412_345, EXACT)).toBe(2_400_000);
    });

    it("protects a YouTube subscriber count at three significant figures", () => {
      // YouTube renders 1,234,567 subscribers as 1.23M and the Data API answers
      // 1230000 -- a step of 10,000, which TikTok's ladder would not see at all.
      expect(keepPrecise(1_230_000, 1_234_567, YOUTUBE_SUBSCRIBERS)).toBe(1_234_567);
      expect(keepPrecise(1_230_000, 1_234_567, TIKTOK_DISPLAY)).toBe(1_230_000);
    });

    it("lets a YouTube channel that genuinely grew past the window through", () => {
      expect(keepPrecise(1_240_000, 1_234_567, YOUTUBE_SUBSCRIBERS)).toBe(1_240_000);
    });

    it("leaves a YouTube figure below the rounding threshold alone", () => {
      expect(keepPrecise(900, 894, YOUTUBE_SUBSCRIBERS)).toBe(900);
    });
  });

  describe("the follower write refuses a lossy overwrite", () => {
    it("scopes a rounded TikTok figure to rows outside its window", async () => {
      await applyPostMetrics(
        { ...post, platform: "TIKTOK" } as any,
        metrics({ viewsCount: 100, authorFollowers: 1_600_000 }),
      );
      const call = mockCreatorUpdateMany.mock.calls[0][0];
      expect(call.where.id).toBe(post.creatorId);
      expect(call.where.OR).toEqual([
        { followersCount: { lt: 1_550_000 } },
        { followersCount: { gte: 1_700_000 } },
      ]);
      expect(call.data).toEqual({ followersCount: 1_600_000 });
    });

    it("writes an exact figure unconditionally", async () => {
      await applyPostMetrics(
        { ...post, platform: "INSTAGRAM" } as any,
        metrics({ viewsCount: 100, authorFollowers: 215_293 }),
      );
      const call = mockCreatorUpdateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: post.creatorId });
    });
  });
});
