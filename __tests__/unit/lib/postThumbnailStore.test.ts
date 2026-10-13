/**
 * @jest-environment node
 *
 * Our own copy of a post's cover (lib/posts/thumbnailStore).
 *
 * TikTok and Instagram covers are signed links that stop answering; once a
 * campaign stops syncing, its cards went blank (217 of 650 shared posts on
 * 2026-10-13). The store keeps a WebP of each cover the sync sees. What is
 * pinned here: only the platforms' own signed covers are copied, a copy is
 * downloaded once per picture rather than once per sync, a failure never
 * fails the sync or erases a good copy, and a database without the table
 * behaves exactly as before.
 */
jest.mock("@/lib/db", () => ({
  db: {
    postThumbnail: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
    post: { findUnique: jest.fn() },
  },
}));
jest.mock("@/lib/media/loadImage", () => ({ loadImage: jest.fn() }));
jest.mock("@/lib/platforms/creatorProfile", () => ({ readCreatorProfile: jest.fn() }));

import { db } from "@/lib/db";
import { loadImage } from "@/lib/media/loadImage";
import {
  THUMB_FETCH_TIMEOUT_MS,
  THUMB_RETRY_MS,
  THUMB_STORE_HEIGHT,
  THUMB_STORE_WIDTH,
  capturePostThumbnail,
  copiesThumbnails,
  isCopyableThumbnailUrl,
  readStoredThumbnail,
  recordThumbnailFailure,
  storeThumbnailFromUrl,
  storedThumbnailVersions,
  withStoredShareThumbnails,
} from "@/lib/posts/thumbnailStore";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const load = loadImage as jest.Mock;
const NOW = Date.parse("2026-10-14T12:00:00Z");
const nowS = Math.floor(NOW / 1000);
const webp = { ok: true, body: Buffer.from("webp-bytes"), contentType: "image/webp" };
const missingTable = () => Object.assign(new Error('The table `public.PostThumbnail` does not exist'), { code: "P2021" });

const ig = (key: string, expiresS = nowS + 86_400, host = "scontent-sin6-2.cdninstagram.com") =>
  `https://${host}/v/t51.2885-15/${key}?_nc_ht=x&oe=${expiresS.toString(16).toUpperCase()}`;
const tt = (key: string, expiresS = nowS + 86_400, host = "p16-sign-va.tiktokcdn.com") =>
  `https://${host}/obj/tos-maliva-p-0068/${key}~tplv-photomode-zoomcover:720:720.jpeg?x-expires=${expiresS}&x-signature=s`;

beforeEach(() => jest.resetAllMocks());

describe("isCopyableThumbnailUrl", () => {
  it("copies TikTok and Instagram covers on their own signed CDNs", () => {
    expect(isCopyableThumbnailUrl("INSTAGRAM", ig("1_n.jpg"), NOW)).toBe(true);
    expect(isCopyableThumbnailUrl("INSTAGRAM", ig("1_n.jpg", nowS + 86_400, "scontent.xx.fbcdn.net"), NOW)).toBe(true);
    expect(isCopyableThumbnailUrl("TIKTOK", tt("abc"), NOW)).toBe(true);
    expect(isCopyableThumbnailUrl("TIKTOK", tt("abc", nowS + 86_400, "p19-sign.tiktokcdn-us.com"), NOW)).toBe(true);
  });

  it("leaves YouTube, CreatorCore's CDN and other hosts to their stored link", () => {
    expect(copiesThumbnails("YOUTUBE")).toBe(false);
    expect(isCopyableThumbnailUrl("YOUTUBE", "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg", NOW)).toBe(false);
    expect(isCopyableThumbnailUrl("INSTAGRAM", "//ea59.cdn.bubble.io/f1/x.png", NOW)).toBe(false);
    expect(isCopyableThumbnailUrl("INSTAGRAM", "https://ea59.cdn.bubble.io/f1/x.png", NOW)).toBe(false);
    expect(isCopyableThumbnailUrl("TIKTOK", "https://evil.example/tiktokcdn.com/a.jpeg", NOW)).toBe(false);
  });

  it("does not hand a TikTok link to Instagram's rule, or the reverse", () => {
    expect(isCopyableThumbnailUrl("INSTAGRAM", tt("abc"), NOW)).toBe(false);
    expect(isCopyableThumbnailUrl("TIKTOK", ig("1_n.jpg"), NOW)).toBe(false);
  });

  it("refuses a signature that has run out or is about to", () => {
    expect(isCopyableThumbnailUrl("INSTAGRAM", ig("1_n.jpg", nowS - 60), NOW)).toBe(false);
    expect(isCopyableThumbnailUrl("TIKTOK", tt("abc", nowS + 60), NOW)).toBe(false);
    expect(isCopyableThumbnailUrl("INSTAGRAM", ig("1_n.jpg").replace("https:", "http:"), NOW)).toBe(false);
    expect(isCopyableThumbnailUrl("INSTAGRAM", null, NOW)).toBe(false);
  });
});

describe("storeThumbnailFromUrl", () => {
  it("keeps a bounded WebP under the post's org, with a bounded wait", async () => {
    load.mockResolvedValue(webp);
    expect(await storeThumbnailFromUrl({ id: "p1", orgId: "org-1" }, ig("1_n.jpg"))).toEqual({ stored: true, bytes: 10 });
    const [url, w, h, , opts] = load.mock.calls[0];
    expect(url).toBe(ig("1_n.jpg"));
    expect([w, h]).toEqual([THUMB_STORE_WIDTH, THUMB_STORE_HEIGHT]);
    expect(opts).toEqual({ fit: "inside", timeoutMs: THUMB_FETCH_TIMEOUT_MS });
    const arg = mdb.postThumbnail.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ postId: "p1" });
    expect(arg.create).toMatchObject({ postId: "p1", orgId: "org-1", sourceUrl: ig("1_n.jpg") });
    expect(Buffer.from(arg.create.data).toString()).toBe("webp-bytes");
    // A fresh copy clears an earlier failure.
    expect(arg.update).toMatchObject({ failedAt: null, failure: null });
  });

  it("finds the org through the campaign when the caller did not have it", async () => {
    load.mockResolvedValue(webp);
    mdb.post.findUnique.mockResolvedValue({ campaign: { orgId: "org-9" } });
    await storeThumbnailFromUrl({ id: "p1" }, ig("1_n.jpg"));
    expect(mdb.postThumbnail.upsert.mock.calls[0][0].create.orgId).toBe("org-9");
  });

  it("records a failed download without touching a copy already held", async () => {
    load.mockResolvedValue({ ok: false, status: 502, message: "upstream error 403" });
    expect(await storeThumbnailFromUrl({ id: "p1", orgId: "org-1" }, ig("1_n.jpg"))).toEqual({
      stored: false,
      failure: "upstream error 403",
    });
    const arg = mdb.postThumbnail.upsert.mock.calls[0][0];
    expect(Object.keys(arg.update).sort()).toEqual(["failedAt", "failure"]);
    expect(arg.create).not.toHaveProperty("data");
  });

  it("does not keep a passthrough it could not transcode", async () => {
    load.mockResolvedValue({ ok: true, body: Buffer.from("gif"), contentType: "image/gif" });
    const r = await storeThumbnailFromUrl({ id: "p1", orgId: "org-1" }, ig("1_n.jpg"));
    expect(r).toEqual({ stored: false, failure: "not transcoded (image/gif)" });
    expect(mdb.postThumbnail.upsert.mock.calls[0][0].update).not.toHaveProperty("data");
  });

  it("says so, rather than throwing, before the table exists", async () => {
    load.mockResolvedValue(webp);
    mdb.postThumbnail.upsert.mockRejectedValue(missingTable());
    expect(await storeThumbnailFromUrl({ id: "p1", orgId: "org-1" }, ig("1_n.jpg"))).toEqual({
      stored: false,
      failure: "table missing",
    });
  });
});

describe("recordThumbnailFailure", () => {
  it("swallows only the missing table", async () => {
    mdb.postThumbnail.upsert.mockRejectedValueOnce(missingTable());
    await expect(recordThumbnailFailure("p1", "org-1", "x")).resolves.toBeUndefined();
    mdb.postThumbnail.upsert.mockRejectedValueOnce(new Error("connection reset"));
    await expect(recordThumbnailFailure("p1", "org-1", "x")).rejects.toThrow("connection reset");
  });
});

describe("readStoredThumbnail", () => {
  it("reads only this org's held copy, narrowed by the caller's post filter", async () => {
    mdb.postThumbnail.findFirst.mockResolvedValue({ data: new Uint8Array([1]), fetchedAt: null });
    await readStoredThumbnail("p1", "org-1", { campaignId: "camp-a" });
    expect(mdb.postThumbnail.findFirst.mock.calls[0][0].where).toEqual({
      postId: "p1",
      orgId: "org-1",
      data: { not: null },
      post: { campaignId: "camp-a" },
    });
    await readStoredThumbnail("p1", "org-1");
    expect(mdb.postThumbnail.findFirst.mock.calls[1][0].where).not.toHaveProperty("post");
  });

  it("is no picture before the table exists, and nothing when the row holds only a failure", async () => {
    mdb.postThumbnail.findFirst.mockRejectedValueOnce(missingTable());
    await expect(readStoredThumbnail("p1", "org-1")).resolves.toBeNull();
    mdb.postThumbnail.findFirst.mockResolvedValueOnce(null);
    await expect(readStoredThumbnail("p1", "org-1")).resolves.toBeNull();
  });
});

describe("storedThumbnailVersions", () => {
  it("keys this org's held copies by post, versioned by when each was taken", async () => {
    const at = new Date("2026-10-14T09:00:00Z");
    mdb.postThumbnail.findMany.mockResolvedValue([{ postId: "p1", fetchedAt: at }]);
    const v = await storedThumbnailVersions(["p1", "p2"], "org-1");
    expect(v.get("p1")).toBe(at.getTime());
    expect(v.has("p2")).toBe(false);
    expect(mdb.postThumbnail.findMany.mock.calls[0][0].where).toEqual({
      orgId: "org-1",
      postId: { in: ["p1", "p2"] },
      data: { not: null },
    });
  });

  it("never fails a post list: no query for an empty page, and no copies on any error", async () => {
    expect((await storedThumbnailVersions([], "org-1")).size).toBe(0);
    expect(mdb.postThumbnail.findMany).not.toHaveBeenCalled();
    mdb.postThumbnail.findMany.mockRejectedValueOnce(missingTable());
    expect((await storedThumbnailVersions(["p1"], "org-1")).size).toBe(0);
    mdb.postThumbnail.findMany.mockRejectedValueOnce(new Error("connection reset"));
    expect((await storedThumbnailVersions(["p1"], "org-1")).size).toBe(0);
  });
});

describe("capturePostThumbnail", () => {
  const post = { id: "p1", platform: "INSTAGRAM" };
  const held = (sourceUrl: string, over: Record<string, unknown> = {}) => ({
    orgId: "org-1",
    fetchedAt: new Date(NOW - 3_600_000),
    sourceUrl,
    failedAt: null,
    ...over,
  });

  it("asks nothing at all for a cover it does not copy", async () => {
    expect(await capturePostThumbnail({ id: "y1", platform: "YOUTUBE" }, "https://i.ytimg.com/vi/x/hqdefault.jpg", NOW)).toBe(false);
    expect(await capturePostThumbnail(post, null, NOW)).toBe(false);
    expect(mdb.postThumbnail.findUnique).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("downloads a post's first cover", async () => {
    mdb.postThumbnail.findUnique.mockResolvedValue(null);
    mdb.post.findUnique.mockResolvedValue({ campaign: { orgId: "org-1" } });
    load.mockResolvedValue(webp);
    expect(await capturePostThumbnail(post, ig("1_n.jpg"), NOW)).toBe(true);
    expect(mdb.postThumbnail.upsert).toHaveBeenCalledTimes(1);
  });

  it("skips the download when the same picture comes back on a new signature and host", async () => {
    mdb.postThumbnail.findUnique.mockResolvedValue(held(ig("1_n.jpg", nowS + 3_600, "scontent-del3-1.cdninstagram.com")));
    expect(await capturePostThumbnail(post, ig("1_n.jpg", nowS + 90_000), NOW)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it("does not pull the stored bytes just to see whether a copy is held", async () => {
    mdb.postThumbnail.findUnique.mockResolvedValue(held(ig("1_n.jpg")));
    await capturePostThumbnail(post, ig("1_n.jpg"), NOW);
    expect(mdb.postThumbnail.findUnique.mock.calls[0][0].select).not.toHaveProperty("data");
  });

  it("replaces the copy when the post shows a different picture", async () => {
    mdb.postThumbnail.findUnique.mockResolvedValue(held(ig("1_n.jpg")));
    load.mockResolvedValue(webp);
    expect(await capturePostThumbnail(post, ig("2_n.jpg"), NOW)).toBe(true);
    expect(mdb.postThumbnail.upsert.mock.calls[0][0].update.sourceUrl).toBe(ig("2_n.jpg"));
  });

  it("waits out the retry window after a failure, then asks again", async () => {
    const failedAt = (ago: number) => held(ig("1_n.jpg"), { fetchedAt: null, failedAt: new Date(NOW - ago) });
    mdb.postThumbnail.findUnique.mockResolvedValueOnce(failedAt(60_000));
    expect(await capturePostThumbnail(post, ig("1_n.jpg"), NOW)).toBe(false);
    expect(load).not.toHaveBeenCalled();

    mdb.postThumbnail.findUnique.mockResolvedValueOnce(failedAt(THUMB_RETRY_MS + 1));
    load.mockResolvedValue(webp);
    expect(await capturePostThumbnail(post, ig("1_n.jpg"), NOW)).toBe(true);
  });

  it("never throws, whatever the database or the CDN does", async () => {
    mdb.postThumbnail.findUnique.mockRejectedValueOnce(missingTable());
    await expect(capturePostThumbnail(post, ig("1_n.jpg"), NOW)).resolves.toBe(false);
    mdb.postThumbnail.findUnique.mockRejectedValueOnce(new Error("connection reset"));
    await expect(capturePostThumbnail(post, ig("1_n.jpg"), NOW)).resolves.toBe(false);
    mdb.postThumbnail.findUnique.mockResolvedValueOnce(null);
    mdb.post.findUnique.mockResolvedValueOnce({ campaign: { orgId: "org-1" } });
    load.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(capturePostThumbnail(post, ig("1_n.jpg"), NOW)).resolves.toBe(false);
  });
});

describe("withStoredShareThumbnails", () => {
  const data = {
    totals: { views: 1 },
    posts: [
      { id: "p1", thumbnailUrl: ig("1_n.jpg") },
      { id: "p2", thumbnailUrl: ig("2_n.jpg") },
      { id: "p 3", thumbnailUrl: null },
    ],
  };

  it("points posts with a copy at the token's own route and leaves the rest alone", async () => {
    mdb.postThumbnail.findMany.mockResolvedValue([
      { postId: "p1", fetchedAt: new Date(1000) },
      { postId: "p 3", fetchedAt: new Date(2000) },
    ]);
    const out = await withStoredShareThumbnails(data, { token: "tok", orgId: "org-1", showCreators: true });
    expect(out.posts.map((p) => p.thumbnailUrl)).toEqual([
      "/api/share/tok/thumbnail/p1?v=1000",
      ig("2_n.jpg"),
      "/api/share/tok/thumbnail/p%203?v=2000",
    ]);
    expect(out.totals).toBe(data.totals);
    expect(mdb.postThumbnail.findMany.mock.calls[0][0].where.orgId).toBe("org-1");
  });

  it("adds no picture to a link that hides creators, and asks nothing", async () => {
    const hidden = { posts: [{ id: "p1", thumbnailUrl: null }] };
    expect(await withStoredShareThumbnails(hidden, { token: "tok", orgId: "org-1", showCreators: false })).toBe(hidden);
    expect(mdb.postThumbnail.findMany).not.toHaveBeenCalled();
  });

  it("hands back the same report when there are no copies, or no table", async () => {
    mdb.postThumbnail.findMany.mockRejectedValueOnce(missingTable());
    expect(await withStoredShareThumbnails(data, { token: "tok", orgId: "org-1", showCreators: true })).toBe(data);
  });
});
