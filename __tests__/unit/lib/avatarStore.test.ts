/**
 * @jest-environment node
 */
jest.mock("@/lib/db", () => ({
  db: {
    creatorAvatar: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
    creator: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/media/loadImage", () => ({ loadImage: jest.fn() }));
jest.mock("@/lib/platforms/creatorProfile", () => ({ readCreatorProfile: jest.fn() }));

import { db } from "@/lib/db";
import { loadImage } from "@/lib/media/loadImage";
import { readCreatorProfile } from "@/lib/platforms/creatorProfile";
import {
  AVATAR_STALE_MS,
  avatarImageKey,
  captureLatestAvatar,
  isFetchableAvatarUrl,
  readStoredAvatar,
  refreshCreatorAvatars,
  signedUrlExpiry,
  storeAvatarFromUrl,
  storedAvatarVersions,
} from "@/lib/creators/avatarStore";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const load = loadImage as jest.Mock;
const read = readCreatorProfile as jest.Mock;
const NOW = Date.parse("2026-09-28T12:00:00Z");
const nowS = Math.floor(NOW / 1000);
const webp = { ok: true, body: Buffer.from("webp-bytes"), contentType: "image/webp" };

beforeEach(() => jest.clearAllMocks());

describe("signedUrlExpiry", () => {
  it("reads TikTok's x-expires and Meta's hex oe", () => {
    expect(signedUrlExpiry("https://p16-sign.tiktokcdn.com/a.jpeg?x-expires=1790000000&x-signature=z")).toBe(1790000000);
    expect(signedUrlExpiry("https://scontent.cdninstagram.com/p.jpg?_nc=1&oe=6A000000")).toBe(0x6a000000);
    expect(signedUrlExpiry("https://yt3.ggpht.com/abc=s88")).toBeNull();
  });
});

describe("isFetchableAvatarUrl", () => {
  it("refuses expired, nearly expired and non-https links", () => {
    expect(isFetchableAvatarUrl(`https://x.tiktokcdn.com/a?x-expires=${nowS - 60}`, NOW)).toBe(false);
    expect(isFetchableAvatarUrl(`https://x.tiktokcdn.com/a?x-expires=${nowS + 60}`, NOW)).toBe(false);
    expect(isFetchableAvatarUrl(`https://x.tiktokcdn.com/a?x-expires=${nowS + 86400}`, NOW)).toBe(true);
    expect(isFetchableAvatarUrl("http://yt3.ggpht.com/a", NOW)).toBe(false);
    expect(isFetchableAvatarUrl(null, NOW)).toBe(false);
  });
});

describe("storeAvatarFromUrl", () => {
  it("keeps the downloaded WebP under the creator's org", async () => {
    load.mockResolvedValue(webp);
    expect(await storeAvatarFromUrl("c1", "org-1", "https://yt3.ggpht.com/a")).toBe(true);
    const arg = mdb.creatorAvatar.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ creatorId: "c1" });
    expect(arg.create.orgId).toBe("org-1");
    expect(Buffer.from(arg.create.data).toString()).toBe("webp-bytes");
  });

  it("writes nothing when the image did not load", async () => {
    load.mockResolvedValue({ ok: false, status: 502, message: "upstream error 403" });
    expect(await storeAvatarFromUrl("c1", "org-1", "https://yt3.ggpht.com/a")).toBe(false);
    expect(mdb.creatorAvatar.upsert).not.toHaveBeenCalled();
  });

  it("does not keep a non-WebP passthrough", async () => {
    load.mockResolvedValue({ ok: true, body: Buffer.from("gif"), contentType: "image/gif" });
    expect(await storeAvatarFromUrl("c1", "org-1", "https://yt3.ggpht.com/a")).toBe(false);
  });
});

describe("readStoredAvatar", () => {
  it("filters by org and treats a missing table as no picture", async () => {
    mdb.creatorAvatar.findFirst.mockRejectedValue(Object.assign(new Error("missing"), { code: "P2021" }));
    await expect(readStoredAvatar("c1", "org-1")).resolves.toBeNull();
    mdb.creatorAvatar.findFirst.mockResolvedValue({ data: new Uint8Array([1]), fetchedAt: null });
    await readStoredAvatar("c1", "org-1");
    expect(mdb.creatorAvatar.findFirst.mock.calls[1][0].where).toMatchObject({ creatorId: "c1", orgId: "org-1" });
  });
});

describe("storedAvatarVersions", () => {
  it("reads only this org's stored pictures and keys them by creator", async () => {
    const at = new Date("2026-09-20T00:00:00Z");
    mdb.creatorAvatar.findMany.mockResolvedValue([{ creatorId: "c1", fetchedAt: at }]);
    const versions = await storedAvatarVersions(["c1", "c2"], "org-1");
    expect(versions.get("c1")).toBe(at.getTime());
    expect(versions.has("c2")).toBe(false);
    expect(mdb.creatorAvatar.findMany.mock.calls[0][0].where).toEqual({
      orgId: "org-1",
      creatorId: { in: ["c1", "c2"] },
      data: { not: null },
    });
  });

  it("asks nothing for an empty page and treats a missing table as no pictures", async () => {
    expect((await storedAvatarVersions([], "org-1")).size).toBe(0);
    expect(mdb.creatorAvatar.findMany).not.toHaveBeenCalled();
    mdb.creatorAvatar.findMany.mockRejectedValue(Object.assign(new Error("x"), { code: "P2021" }));
    expect((await storedAvatarVersions(["c1"], "org-1")).size).toBe(0);
  });
});

describe("avatarImageKey", () => {
  it("names the picture apart from host, size and signature", () => {
    const tt = (host: string, opts: string) =>
      `https://${host}.tiktokcdn.com/tos-maliva-avt-0068/7c1f9e~${opts}.jpeg?x-expires=${nowS}&x-signature=s`;
    expect(avatarImageKey(tt("p16-sign-va", "tplv-tiktokx-cropcenter:100:100"))).toBe("7c1f9e");
    expect(avatarImageKey(tt("p19-sign-useast", "c5_720x720"))).toBe("7c1f9e");
    expect(avatarImageKey("https://yt3.ggpht.com/ytc/AIdro_abc=s88-c-k")).toBe("/ytc/AIdro_abc");
    expect(avatarImageKey("https://yt3.googleusercontent.com/ytc/AIdro_abc=s240")).toBe("/ytc/AIdro_abc");
    expect(avatarImageKey("https://scontent-sin6-2.cdninstagram.com/v/t51/123_n.jpg?oe=6A000000")).toBe("123_n.jpg");
    expect(avatarImageKey("not a url")).toBeNull();
    expect(avatarImageKey(null)).toBeNull();
  });
});

describe("captureLatestAvatar", () => {
  const url = "https://yt3.ggpht.com/a=s88";
  const stored = (sourceUrl: string, ageMs: number) => ({
    data: new Uint8Array([1]),
    fetchedAt: new Date(NOW - ageMs),
    sourceUrl,
  });

  it("skips the download while the same picture is stored and recent", async () => {
    mdb.creatorAvatar.findUnique.mockResolvedValue(stored("https://yt3.ggpht.com/a=s240", 1000));
    expect(await captureLatestAvatar({ id: "c1", orgId: "o" }, url, NOW)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it("downloads straight away when the creator has a new picture", async () => {
    mdb.creatorAvatar.findUnique.mockResolvedValue(stored("https://yt3.ggpht.com/old=s88", 1000));
    load.mockResolvedValue(webp);
    expect(await captureLatestAvatar({ id: "c1", orgId: "o" }, url, NOW)).toBe(true);
    expect(load.mock.calls[0][0]).toBe(url);
    expect(mdb.creatorAvatar.upsert.mock.calls[0][0].update).toMatchObject({ sourceUrl: url });
  });

  it("treats the same TikTok picture from another host as unchanged", async () => {
    const at = (host: string) => `https://${host}.tiktokcdn.com/avt/9ab~c5_100x100.jpeg?x-expires=${nowS + 3600}`;
    mdb.creatorAvatar.findUnique.mockResolvedValue(stored(at("p16-sign-va"), 1000));
    expect(await captureLatestAvatar({ id: "c1", orgId: "o" }, at("p19-sign-useast"), NOW)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it("re-downloads once the stored picture is a fortnight old", async () => {
    mdb.creatorAvatar.findUnique.mockResolvedValue(stored(url, AVATAR_STALE_MS + 1));
    load.mockResolvedValue(webp);
    expect(await captureLatestAvatar({ id: "c1", orgId: "o" }, url, NOW)).toBe(true);
  });
});

describe("refreshCreatorAvatars", () => {
  const base = { orgId: "org-1", platform: "YOUTUBE", handle: "chan", avatarUrl: null, posts: [] };

  it("uses a held live link before reading the profile", async () => {
    mdb.creator.findMany.mockResolvedValue([{ ...base, id: "c1", avatarUrl: "https://yt3.ggpht.com/held" }]);
    load.mockResolvedValue(webp);
    const counts = await refreshCreatorAvatars({ nowMs: NOW });
    expect(counts).toMatchObject({ considered: 1, stored: 1, failed: 0 });
    expect(read).not.toHaveBeenCalled();
  });

  it("skips an expired held link and falls back to the profile read", async () => {
    mdb.creator.findMany.mockResolvedValue([
      { ...base, id: "c1", avatarUrl: `https://x.tiktokcdn.com/a?x-expires=${nowS - 10}` },
    ]);
    read.mockResolvedValue({ ok: true, profile: { avatarUrl: "https://yt3.ggpht.com/fresh" } });
    load.mockResolvedValue(webp);
    const counts = await refreshCreatorAvatars({ nowMs: NOW });
    expect(read).toHaveBeenCalledWith("YOUTUBE", "chan", { instagramStopAtPercent: 60, orgId: "org-1" });
    expect(load.mock.calls[0][0]).toBe("https://yt3.ggpht.com/fresh");
    expect(counts.stored).toBe(1);
  });

  it("goes to the sandbox only when a TikTok direct read fails", async () => {
    mdb.creator.findMany.mockResolvedValue([{ ...base, id: "c1", platform: "TIKTOK" }]);
    read.mockResolvedValue({ ok: false, reason: "unreadable" });
    const remote = jest.fn().mockResolvedValue({ ok: true, profile: { avatarUrl: "https://p16.tiktokcdn.com/x.jpeg" } });
    load.mockResolvedValue(webp);
    const counts = await refreshCreatorAvatars({ nowMs: NOW, readTikTokProfileRemote: remote });
    expect(remote).toHaveBeenCalledWith("chan");
    expect(counts.stored).toBe(1);
  });

  it("records a failure so the creator waits a week before the next try", async () => {
    mdb.creator.findMany.mockResolvedValue([{ ...base, id: "c1" }]);
    read.mockResolvedValue({ ok: false, reason: "no-credentials" });
    const counts = await refreshCreatorAvatars({ nowMs: NOW });
    expect(counts.failed).toBe(1);
    const arg = mdb.creatorAvatar.upsert.mock.calls[0][0];
    expect(arg.update).toMatchObject({ failure: "profile read: no-credentials" });
    expect(arg.update).not.toHaveProperty("data");
  });

  it("stops asking a platform that rate-limits, and records no failure for it", async () => {
    mdb.creator.findMany.mockResolvedValue([
      { ...base, id: "c1", platform: "INSTAGRAM", handle: "one" },
      { ...base, id: "c2", platform: "INSTAGRAM", handle: "two" },
      { ...base, id: "c3", platform: "YOUTUBE", handle: "three" },
    ]);
    read.mockImplementation(async (platform: string) =>
      platform === "INSTAGRAM"
        ? { ok: false, reason: "rate-limited", detail: "(#4) Application request limit reached" }
        : { ok: true, profile: { avatarUrl: "https://yt3.ggpht.com/fresh" } },
    );
    load.mockResolvedValue(webp);
    const counts = await refreshCreatorAvatars({ nowMs: NOW });
    expect(read.mock.calls.map((c) => c[0])).toEqual(["INSTAGRAM", "YOUTUBE"]);
    const failures = mdb.creatorAvatar.upsert.mock.calls.filter((c: any[]) => c[0].update.failure);
    expect(failures).toEqual([]);
    expect(counts).toMatchObject({ stored: 1, failed: 0, skipped: 2 });
  });

  it("retries a creator whose last failure was a rate limit without waiting a week", async () => {
    mdb.creator.findMany.mockResolvedValue([]);
    await refreshCreatorAvatars({ nowMs: NOW });
    const where = mdb.creator.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"failure":{"startsWith":"profile read: rate-limited"}');
  });

  it("works on several creators at once and still reaches every one", async () => {
    mdb.creator.findMany.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({ ...base, id: `c${i}`, avatarUrl: `https://yt3.ggpht.com/${i}` })),
    );
    let inFlight = 0;
    let peak = 0;
    load.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return webp;
    });
    const counts = await refreshCreatorAvatars({ nowMs: NOW, concurrency: 3 });
    expect(peak).toBe(3);
    expect(counts).toMatchObject({ considered: 6, stored: 6, skipped: 0 });
    expect(new Set(mdb.creatorAvatar.upsert.mock.calls.map((c: any[]) => c[0].where.creatorId)).size).toBe(6);
  });

  it("leaves the creators it had no time for as skipped", async () => {
    mdb.creator.findMany.mockResolvedValue([{ ...base, id: "c1" }, { ...base, id: "c2" }]);
    const counts = await refreshCreatorAvatars({ nowMs: NOW, deadlineMs: -1, concurrency: 4 });
    expect(counts).toEqual({ considered: 0, stored: 0, failed: 0, skipped: 2 });
    expect(read).not.toHaveBeenCalled();
  });

  it("returns empty counts when the table has not been created yet", async () => {
    mdb.creator.findMany.mockRejectedValue(Object.assign(new Error("x"), { code: "P2021" }));
    await expect(refreshCreatorAvatars({ nowMs: NOW })).resolves.toEqual({ considered: 0, stored: 0, failed: 0, skipped: 0 });
  });
});
