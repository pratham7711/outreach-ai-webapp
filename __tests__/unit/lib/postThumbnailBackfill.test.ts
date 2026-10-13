/**
 * @jest-environment node
 *
 * The one-off copy of covers the sync never saw (lib/posts/thumbnailBackfill).
 *
 * Pinned: a dry run only counts; a batch copies a still-valid link with no
 * platform call; an expired link is re-read through the public routes the
 * caller hands in; every failure is recorded so the next batch moves on; and
 * a database without the table is reported, not crashed on.
 */
jest.mock("@/lib/db", () => ({ db: { $queryRawUnsafe: jest.fn() } }));
jest.mock("@/lib/platforms/fetchPostMetrics", () => ({ refreshTikTokCover: jest.fn() }));
jest.mock("@/lib/platforms/instagramPostPage", () => ({ readInstagramPostPage: jest.fn() }));
jest.mock("@/lib/media/loadImage", () => ({ loadImage: jest.fn() }));
jest.mock("@/lib/platforms/creatorProfile", () => ({ readCreatorProfile: jest.fn() }));
jest.mock("@/lib/posts/thumbnailStore", () => ({
  ...jest.requireActual("@/lib/posts/thumbnailStore"),
  storeThumbnailFromUrl: jest.fn(),
  recordThumbnailFailure: jest.fn(),
}));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { refreshTikTokCover } from "@/lib/platforms/fetchPostMetrics";
import { readInstagramPostPage } from "@/lib/platforms/instagramPostPage";
import { recordThumbnailFailure, storeThumbnailFromUrl } from "@/lib/posts/thumbnailStore";
import { backfillPostThumbnails, tallyBackfill } from "@/lib/posts/thumbnailBackfill";
import { GET, POST } from "@/app/api/admin/backfill-post-thumbnails/route";

const query = (db as unknown as { $queryRawUnsafe: jest.Mock }).$queryRawUnsafe;
const store = storeThumbnailFromUrl as jest.Mock;
const recordFailure = recordThumbnailFailure as jest.Mock;
const NOW = Date.parse("2026-10-14T12:00:00Z");
const nowS = Math.floor(NOW / 1000);
const igCover = (key: string) => `https://scontent.cdninstagram.com/v/t51/${key}?oe=${(nowS + 86_400).toString(16)}`;
const ttCover = (key: string) => `https://p16-sign.tiktokcdn.com/obj/${key}~c5.jpeg?x-expires=${nowS + 86_400}`;

type CountRow = Parameters<typeof tallyBackfill>[0][number];
const count = (over: Partial<CountRow>): CountRow => ({ shared: false, stored: false, recentlyFailed: false, link: "live", n: BigInt(1), ...over });
const work = (over: Record<string, unknown>) => ({
  id: "p1",
  platform: "INSTAGRAM",
  postUrl: "https://www.instagram.com/p/AAA/",
  thumbnailUrl: igCover("1_n.jpg"),
  orgId: "org-1",
  shared: true,
  link: "live",
  ...over,
});
/** The three reads a batch makes, in order: counts before, the work, counts after. */
const batch = (before: object[], rows: object[], after: object[] = []) => {
  query.mockResolvedValueOnce(before).mockResolvedValueOnce(rows).mockResolvedValueOnce(after);
};

beforeEach(() => jest.clearAllMocks());

describe("tallyBackfill", () => {
  it("files each post once, under the first thing that is true of it", () => {
    const c = tallyBackfill([
      count({ stored: true, n: BigInt(4) }),
      count({ link: "creatorcore", n: BigInt(9) }),
      count({ link: "other", n: BigInt(1) }),
      count({ recentlyFailed: true, link: "expired", n: BigInt(3) }),
      count({ shared: true, link: "live", n: BigInt(2) }),
      count({ shared: true, link: "expired", n: BigInt(5) }),
      count({ shared: true, link: "missing", n: BigInt(1) }),
      count({ link: "live", n: BigInt(7) }),
      count({ link: "expired", n: BigInt(6) }),
      count({ link: "missing", n: BigInt(8) }),
    ]);
    expect(c).toEqual({
      posts: 46,
      alreadyStored: 4,
      recentlyFailed: 3,
      creatorCoreHosted: 9,
      otherHost: 1,
      todo: { sharedLive: 2, sharedRefetch: 6, live: 7, expired: 6, missing: 8 },
    });
  });

  it("counts recent failures as work again when asked to retry them", () => {
    expect(tallyBackfill([count({ recentlyFailed: true, link: "expired", n: 3 })], true).todo.expired).toBe(3);
  });
});

describe("backfillPostThumbnails", () => {
  it("dry run: counts, and fetches, re-reads and writes nothing", async () => {
    query.mockResolvedValueOnce([count({ shared: true, link: "live", n: BigInt(4) }), count({ link: "expired", n: BigInt(2) })]);
    const r = await backfillPostThumbnails({ dryRun: true, nowMs: NOW });
    expect(r).toMatchObject({ dryRun: true, tableReady: true, remaining: 6 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(store).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
    expect(refreshTikTokCover).not.toHaveBeenCalled();
    expect(readInstagramPostPage).not.toHaveBeenCalled();
  });

  it("reports a database without the table instead of failing", async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('relation "PostThumbnail" does not exist'), { code: "P2010" }));
    const r = await backfillPostThumbnails({ nowMs: NOW });
    expect(r).toMatchObject({ tableReady: false, before: null, remaining: null });
    expect(store).not.toHaveBeenCalled();
  });

  it("copies a still-valid link with no platform call", async () => {
    batch([count({ shared: true, n: BigInt(1) })], [work({})], []);
    store.mockResolvedValue({ stored: true, bytes: 40_000 });
    const readInstagramCover = jest.fn();
    const r = await backfillPostThumbnails({ nowMs: NOW, readInstagramCover });
    expect(store).toHaveBeenCalledWith({ id: "p1", orgId: "org-1" }, igCover("1_n.jpg"), { timeoutMs: 10_000 });
    expect(readInstagramCover).not.toHaveBeenCalled();
    expect(r.processed).toEqual({ considered: 1, stored: 1, failed: 0, skipped: 0, bytes: 40_000 });
    expect(r.remaining).toBe(0);
  });

  it("re-reads an expired Instagram cover from the public post page, and copies the fresh one", async () => {
    batch([], [work({ link: "expired", thumbnailUrl: "https://scontent.cdninstagram.com/v/t51/old.jpg?oe=1" })]);
    store.mockResolvedValue({ stored: true, bytes: 30_000 });
    const readInstagramCover = jest.fn(async () => ({ url: igCover("new_n.jpg") }));
    const r = await backfillPostThumbnails({ nowMs: NOW, readInstagramCover });
    expect(readInstagramCover).toHaveBeenCalledWith("https://www.instagram.com/p/AAA/");
    expect(store).toHaveBeenCalledTimes(1);
    expect(store.mock.calls[0][1]).toBe(igCover("new_n.jpg"));
    expect(r.processed.stored).toBe(1);
  });

  it("records a post Instagram will not show logged out, so the next batch moves on", async () => {
    batch([], [work({ link: "missing", thumbnailUrl: null })]);
    const r = await backfillPostThumbnails({ nowMs: NOW, readInstagramCover: async () => ({ url: null, failure: "post not public" }) });
    expect(recordFailure).toHaveBeenCalledWith("p1", "org-1", "post not public");
    expect(r.processed.failed).toBe(1);
    expect(r.failures).toEqual({ "post not public": 1 });
    expect(store).not.toHaveBeenCalled();
  });

  it("re-reads TikTok through oEmbed", async () => {
    batch([], [work({ platform: "TIKTOK", postUrl: "https://www.tiktok.com/@a/video/1", link: "expired", thumbnailUrl: null })]);
    store.mockResolvedValue({ stored: true, bytes: 20_000 });
    const readTikTokCover = jest.fn(async () => ttCover("abc"));
    const r = await backfillPostThumbnails({ nowMs: NOW, readTikTokCover });
    expect(readTikTokCover).toHaveBeenCalledWith("https://www.tiktok.com/@a/video/1");
    expect(store.mock.calls[0][1]).toBe(ttCover("abc"));
    expect(r.processed.stored).toBe(1);
  });

  it("does not copy a re-read link off the platform's own CDN", async () => {
    batch([], [work({ link: "expired" })]);
    const r = await backfillPostThumbnails({ nowMs: NOW, readInstagramCover: async () => ({ url: "https://elsewhere.example/a.jpg" }) });
    expect(store).not.toHaveBeenCalled();
    expect(r.failures).toEqual({ "re-read gave a link we do not copy": 1 });
  });

  it("falls through to a re-read when a link that looked live refuses, unless re-reads are off", async () => {
    batch([], [work({})]);
    store.mockResolvedValueOnce({ stored: false, failure: "upstream error 403" }).mockResolvedValueOnce({ stored: true, bytes: 1 });
    const readInstagramCover = jest.fn(async () => ({ url: igCover("2_n.jpg") }));
    expect((await backfillPostThumbnails({ nowMs: NOW, readInstagramCover })).processed.stored).toBe(1);

    jest.clearAllMocks();
    batch([], [work({})]);
    store.mockResolvedValueOnce({ stored: false, failure: "upstream error 403" });
    const r = await backfillPostThumbnails({ nowMs: NOW, refetch: false, readInstagramCover });
    expect(readInstagramCover).not.toHaveBeenCalled();
    expect(r.failures).toEqual({ "stored link: upstream error 403": 1 });
  });

  it("asks only for still-valid links when re-reads are off, and skips recent failures unless told to retry", async () => {
    batch([], []);
    await backfillPostThumbnails({ nowMs: NOW, refetch: false, campaignId: "camp-4", limit: 7 });
    const [sql, campaignId, , , limit] = query.mock.calls[1];
    expect(sql).toContain("link IN ('live')");
    expect(sql).toContain(`AND NOT "recentlyFailed"`);
    expect([campaignId, limit]).toEqual(["camp-4", 7]);

    jest.clearAllMocks();
    batch([], []);
    await backfillPostThumbnails({ nowMs: NOW, retryFailed: true });
    expect(query.mock.calls[1][0]).toContain("link IN ('live', 'expired', 'missing')");
    expect(query.mock.calls[1][0]).not.toContain(`AND NOT "recentlyFailed"`);
  });

  it("stops starting new posts at its deadline and counts the rest as skipped", async () => {
    batch([], [work({ id: "p1" }), work({ id: "p2" }), work({ id: "p3" })]);
    const r = await backfillPostThumbnails({ nowMs: NOW, deadlineMs: -1 });
    expect(r.processed).toMatchObject({ considered: 0, skipped: 3 });
    expect(store).not.toHaveBeenCalled();
  });
});

describe("/api/admin/backfill-post-thumbnails", () => {
  const saved = process.env.ADMIN_MIGRATE_TOKEN;
  const req = (method: string, qs = "", token = "test-admin-token") =>
    new NextRequest(`http://localhost/api/admin/backfill-post-thumbnails${qs}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
  beforeEach(() => {
    process.env.ADMIN_MIGRATE_TOKEN = "test-admin-token";
  });
  afterAll(() => {
    process.env.ADMIN_MIGRATE_TOKEN = saved;
  });

  it("is gated like the migration: absent without the token, 401 with a wrong one", async () => {
    delete process.env.ADMIN_MIGRATE_TOKEN;
    expect((await POST(req("POST"))).status).toBe(404);
    process.env.ADMIN_MIGRATE_TOKEN = "test-admin-token";
    expect((await POST(req("POST", "", "wrong"))).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it("GET is always the dry run", async () => {
    query.mockResolvedValueOnce([]);
    const body = await (await GET(req("GET", "?campaignId=camp-4"))).json();
    expect(body).toMatchObject({ ok: true, dryRun: true, remaining: 0 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toBe("camp-4");
  });
});
