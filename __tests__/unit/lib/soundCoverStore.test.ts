/**
 * @jest-environment node
 *
 * Our own copy of a sound's cover (lib/sounds/coverStore).
 *
 * TikTok signs a sound's cover with an x-expires and the CDN answers 403 once
 * it passes. A sound whose link was not renewed in time left a client report
 * on prod showing a music note where the artwork had been (2026-10-18).
 * What is pinned here: a cover is
 * downloaded once per picture rather than once per reading, it is filed under
 * the sound's own org, a failure never erases a good copy or fails the
 * reading, and a database without the table behaves exactly as before.
 */
jest.mock("@/lib/db", () => ({
  db: {
    soundCover: { findFirst: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
    tikTokSound: { findUnique: jest.fn() },
  },
}));
jest.mock("@/lib/media/loadImage", () => ({ loadImage: jest.fn() }));
jest.mock("@/lib/platforms/creatorProfile", () => ({ readCreatorProfile: jest.fn() }));

import { db } from "@/lib/db";
import { loadImage } from "@/lib/media/loadImage";
import {
  SOUND_COVER_FETCH_TIMEOUT_MS,
  SOUND_COVER_RETRY_MS,
  SOUND_COVER_STORE_PX,
  captureSoundCover,
  readStoredSoundCover,
  storeSoundCoverFromUrl,
  storedSoundCoverVersions,
} from "@/lib/sounds/coverStore";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const load = loadImage as jest.Mock;
const NOW = Date.parse("2026-10-18T12:00:00Z");
const nowS = Math.floor(NOW / 1000);
const webp = { ok: true, body: Buffer.from("webp-bytes"), contentType: "image/webp" };
const missingTable = () => Object.assign(new Error("The table `public.SoundCover` does not exist"), { code: "P2021" });

/* The shape TikTok's music embed hands back: a signed p16 link, the picture's
   object key before the `~` options. */
const cover = (key: string, expiresS = nowS + 86_400, host = "p16-sign-sg.tiktokcdn.com") =>
  `https://${host}/tos-alisg-v-2774/${key}~c5_720x720.jpeg?x-expires=${expiresS}&x-signature=s`;

beforeEach(() => jest.resetAllMocks());

describe("captureSoundCover", () => {
  it("keeps a cover the first time it is seen, under the sound's own org", async () => {
    mdb.tikTokSound.findUnique.mockResolvedValue({ orgId: "org-1", cover: null });
    load.mockResolvedValue(webp);
    mdb.soundCover.upsert.mockResolvedValue({});

    expect(await captureSoundCover("sound-1", cover("abc"), NOW)).toBe(true);

    expect(load).toHaveBeenCalledWith(
      cover("abc"),
      SOUND_COVER_STORE_PX,
      SOUND_COVER_STORE_PX,
      "sounds/coverStore",
      { fit: "inside", timeoutMs: SOUND_COVER_FETCH_TIMEOUT_MS }
    );
    const write = mdb.soundCover.upsert.mock.calls[0][0];
    expect(write.where).toEqual({ soundId: "sound-1" });
    expect(write.create).toMatchObject({ soundId: "sound-1", orgId: "org-1", sourceUrl: cover("abc") });
    expect(Buffer.from(write.create.data).toString()).toBe("webp-bytes");
    expect(write.update).toMatchObject({ failedAt: null, failure: null, sourceUrl: cover("abc") });
  });

  it("does not download the same picture again under a fresh signature or host", async () => {
    // Every reading hands back a newly signed link; the object key is what names the picture.
    mdb.tikTokSound.findUnique.mockResolvedValue({
      orgId: "org-1",
      cover: { fetchedAt: new Date(NOW - 3_600_000), sourceUrl: cover("abc", nowS - 999), failedAt: null },
    });

    expect(await captureSoundCover("sound-1", cover("abc", nowS + 86_400, "p16-sign-va.tiktokcdn.com"), NOW)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it("downloads again when the sound's artwork changed", async () => {
    mdb.tikTokSound.findUnique.mockResolvedValue({
      orgId: "org-1",
      cover: { fetchedAt: new Date(NOW - 3_600_000), sourceUrl: cover("old"), failedAt: null },
    });
    load.mockResolvedValue(webp);
    mdb.soundCover.upsert.mockResolvedValue({});

    expect(await captureSoundCover("sound-1", cover("new"), NOW)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("refuses a link past its signature without touching the database", async () => {
    expect(await captureSoundCover("sound-1", cover("abc", nowS - 60), NOW)).toBe(false);
    expect(await captureSoundCover("sound-1", null, NOW)).toBe(false);
    expect(await captureSoundCover("sound-1", cover("abc").replace("https:", "http:"), NOW)).toBe(false);
    expect(mdb.tikTokSound.findUnique).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("waits out a recent failure rather than asking every hour", async () => {
    mdb.tikTokSound.findUnique.mockResolvedValue({
      orgId: "org-1",
      cover: { fetchedAt: null, sourceUrl: null, failedAt: new Date(NOW - 60_000) },
    });
    expect(await captureSoundCover("sound-1", cover("abc"), NOW)).toBe(false);
    expect(load).not.toHaveBeenCalled();

    mdb.tikTokSound.findUnique.mockResolvedValue({
      orgId: "org-1",
      cover: { fetchedAt: null, sourceUrl: null, failedAt: new Date(NOW - SOUND_COVER_RETRY_MS - 1) },
    });
    load.mockResolvedValue(webp);
    mdb.soundCover.upsert.mockResolvedValue({});
    expect(await captureSoundCover("sound-1", cover("abc"), NOW)).toBe(true);
  });

  it("does nothing for a sound that no longer exists", async () => {
    mdb.tikTokSound.findUnique.mockResolvedValue(null);
    expect(await captureSoundCover("gone", cover("abc"), NOW)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it("never throws, and stays quiet when the table is not there yet", async () => {
    mdb.tikTokSound.findUnique.mockRejectedValue(missingTable());
    await expect(captureSoundCover("sound-1", cover("abc"), NOW)).resolves.toBe(false);

    mdb.tikTokSound.findUnique.mockRejectedValue(new Error("Can't reach database server"));
    await expect(captureSoundCover("sound-1", cover("abc"), NOW)).resolves.toBe(false);
  });
});

describe("storeSoundCoverFromUrl", () => {
  it("records a failed download without erasing the copy already held", async () => {
    load.mockResolvedValue({ ok: false, status: 502, message: "upstream error 403" });
    mdb.soundCover.upsert.mockResolvedValue({});

    expect(await storeSoundCoverFromUrl({ id: "sound-1", orgId: "org-1" }, cover("abc"))).toEqual({
      stored: false,
      failure: "upstream error 403",
    });
    const write = mdb.soundCover.upsert.mock.calls[0][0];
    expect(write.update).not.toHaveProperty("data");
    expect(write.update).not.toHaveProperty("fetchedAt");
    expect(write.update.failure).toBe("upstream error 403");
  });

  it("keeps only WebP, never the CDN's raw bytes", async () => {
    load.mockResolvedValue({ ok: true, body: Buffer.from("jpeg"), contentType: "image/jpeg" });
    mdb.soundCover.upsert.mockResolvedValue({});

    const result = await storeSoundCoverFromUrl({ id: "sound-1", orgId: "org-1" }, cover("abc"));
    expect(result).toEqual({ stored: false, failure: "not transcoded (image/jpeg)" });
    expect(mdb.soundCover.upsert.mock.calls[0][0].update).not.toHaveProperty("data");
  });

  it("reports a missing table instead of throwing", async () => {
    load.mockResolvedValue(webp);
    mdb.soundCover.upsert.mockRejectedValue(missingTable());
    expect(await storeSoundCoverFromUrl({ id: "sound-1", orgId: "org-1" }, cover("abc"))).toEqual({
      stored: false,
      failure: "table missing",
    });
  });
});

describe("reading the copy back", () => {
  it("reads one sound's copy inside its org only", async () => {
    const fetchedAt = new Date(NOW);
    mdb.soundCover.findFirst.mockResolvedValue({ data: new Uint8Array([1, 2]), fetchedAt });
    expect(await readStoredSoundCover("sound-1", "org-1")).toEqual({ data: new Uint8Array([1, 2]), fetchedAt });
    expect(mdb.soundCover.findFirst.mock.calls[0][0].where).toEqual({
      soundId: "sound-1",
      orgId: "org-1",
      data: { not: null },
    });
  });

  it("answers null before the table exists", async () => {
    mdb.soundCover.findFirst.mockRejectedValue(missingTable());
    expect(await readStoredSoundCover("sound-1", "org-1")).toBeNull();
  });

  it("gives each copied sound its version, and an empty map on any failure", async () => {
    mdb.soundCover.findMany.mockResolvedValue([{ soundId: "sound-1", fetchedAt: new Date(NOW) }]);
    expect(await storedSoundCoverVersions(["sound-1", "sound-2", "sound-1", ""], "org-1")).toEqual(
      new Map([["sound-1", NOW]])
    );
    expect(mdb.soundCover.findMany.mock.calls[0][0].where).toEqual({
      orgId: "org-1",
      soundId: { in: ["sound-1", "sound-2"] },
      data: { not: null },
    });

    mdb.soundCover.findMany.mockRejectedValue(new Error("Can't reach database server"));
    expect(await storedSoundCoverVersions(["sound-1"], "org-1")).toEqual(new Map());

    mdb.soundCover.findMany.mockClear();
    expect(await storedSoundCoverVersions([], "org-1")).toEqual(new Map());
    expect(mdb.soundCover.findMany).not.toHaveBeenCalled();
  });
});
