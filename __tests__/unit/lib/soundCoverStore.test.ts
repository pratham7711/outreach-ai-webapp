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
    tikTokSound: { findUnique: jest.fn(), findMany: jest.fn() },
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
  soundsWithoutCover,
  SOUND_COVER_MISSING_ALERT_MS,
} from "@/lib/sounds/coverStore";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const load = loadImage as jest.Mock;
const NOW = Date.parse("2026-10-18T12:00:00Z");
const nowS = Math.floor(NOW / 1000);
/* What loadImage hands back for a copy we keep: our own AVIF. */
const webp = { ok: true, body: Buffer.from("webp-bytes"), contentType: "image/avif" };
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

    expect(await captureSoundCover("sound-1", cover("abc"), NOW)).toBe(cover("abc"));

    expect(load).toHaveBeenCalledWith(
      cover("abc"),
      SOUND_COVER_STORE_PX,
      SOUND_COVER_STORE_PX,
      "sounds/coverStore",
      { fit: "inside", timeoutMs: SOUND_COVER_FETCH_TIMEOUT_MS, format: "avif" }
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

    expect(await captureSoundCover("sound-1", cover("abc", nowS + 86_400, "p16-sign-va.tiktokcdn.com"), NOW)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("downloads again when the sound's artwork changed", async () => {
    mdb.tikTokSound.findUnique.mockResolvedValue({
      orgId: "org-1",
      cover: { fetchedAt: new Date(NOW - 3_600_000), sourceUrl: cover("old"), failedAt: null },
    });
    load.mockResolvedValue(webp);
    mdb.soundCover.upsert.mockResolvedValue({});

    expect(await captureSoundCover("sound-1", cover("new"), NOW)).toBe(cover("new"));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("refuses a link past its signature without touching the database", async () => {
    expect(await captureSoundCover("sound-1", cover("abc", nowS - 60), NOW)).toBeNull();
    expect(await captureSoundCover("sound-1", null, NOW)).toBeNull();
    expect(await captureSoundCover("sound-1", [null, undefined], NOW)).toBeNull();
    expect(await captureSoundCover("sound-1", cover("abc").replace("https:", "http:"), NOW)).toBeNull();
    expect(mdb.tikTokSound.findUnique).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("waits out a link that failed lately rather than asking every hour", async () => {
    mdb.tikTokSound.findUnique.mockResolvedValue({
      orgId: "org-1",
      cover: { fetchedAt: null, sourceUrl: cover("abc", nowS - 999), failedAt: new Date(NOW - 60_000) },
    });
    expect(await captureSoundCover("sound-1", cover("abc"), NOW)).toBeNull();
    expect(load).not.toHaveBeenCalled();

    mdb.tikTokSound.findUnique.mockResolvedValue({
      orgId: "org-1",
      cover: { fetchedAt: null, sourceUrl: cover("abc"), failedAt: new Date(NOW - SOUND_COVER_RETRY_MS - 1) },
    });
    load.mockResolvedValue(webp);
    mdb.soundCover.upsert.mockResolvedValue({});
    expect(await captureSoundCover("sound-1", cover("abc"), NOW)).toBe(cover("abc"));
  });

  it("tries a different link at once, whatever failed before it", async () => {
    // The failure that stranded a report: one dead link, and a reading with another on offer.
    mdb.tikTokSound.findUnique.mockResolvedValue({
      orgId: "org-1",
      cover: { fetchedAt: null, sourceUrl: cover("dead"), failedAt: new Date(NOW - 60_000) },
    });
    load.mockResolvedValue(webp);
    mdb.soundCover.upsert.mockResolvedValue({});
    expect(await captureSoundCover("sound-1", [cover("fresh"), cover("dead")], NOW)).toBe(cover("fresh"));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("tells apart two pictures that share a file name", async () => {
    // Every YouTube picture is hqdefault.jpg and every upload image.png; a song's
    // cover can be either. A dead one must not hold up a working one.
    const yt = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    mdb.tikTokSound.findUnique.mockResolvedValue({
      orgId: "org-1",
      cover: { fetchedAt: null, sourceUrl: yt("dead"), failedAt: new Date(NOW - 60_000) },
    });
    load.mockResolvedValue(webp);
    mdb.soundCover.upsert.mockResolvedValue({});
    expect(await captureSoundCover("sound-1", [yt("works"), yt("dead")], NOW)).toBe(yt("works"));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not download an Instagram picture again from another regional host", async () => {
    const ig = (host: string) => `https://${host}/v/t51.2885-15/461_123_n.jpg?stp=dst-jpg&oe=6A00AAAA`;
    mdb.tikTokSound.findUnique.mockResolvedValue({
      orgId: "org-1",
      cover: { fetchedAt: new Date(NOW - 3_600_000), sourceUrl: ig("scontent-sin6-1.cdninstagram.com"), failedAt: null },
    });
    expect(await captureSoundCover("sound-1", ig("scontent-iad3-2.cdninstagram.com"), NOW)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("falls back to the next link when the first will not download", async () => {
    mdb.tikTokSound.findUnique.mockResolvedValue({ orgId: "org-1", cover: null });
    load
      .mockResolvedValueOnce({ ok: false, status: 502, message: "upstream error 404" })
      .mockResolvedValueOnce(webp);
    mdb.soundCover.upsert.mockResolvedValue({});

    expect(await captureSoundCover("sound-1", [cover("reading"), cover("row")], NOW)).toBe(cover("row"));
    expect(load).toHaveBeenCalledTimes(2);
    // The failed link is recorded while nothing is held, so the wait knows which one it is.
    expect(mdb.soundCover.upsert.mock.calls[0][0].create).toMatchObject({ sourceUrl: cover("reading") });
  });

  it("stops at a picture it already holds rather than downloading it again", async () => {
    mdb.tikTokSound.findUnique.mockResolvedValue({
      orgId: "org-1",
      cover: { fetchedAt: new Date(NOW - 3_600_000), sourceUrl: cover("held"), failedAt: null },
    });
    load.mockResolvedValue({ ok: false, status: 502, message: "upstream error 404" });
    mdb.soundCover.upsert.mockResolvedValue({});

    expect(await captureSoundCover("sound-1", [cover("new"), cover("held")], NOW)).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("asks once for the same address under two signatures", async () => {
    mdb.tikTokSound.findUnique.mockResolvedValue({ orgId: "org-1", cover: null });
    load.mockResolvedValue({ ok: false, status: 502, message: "upstream error 404" });
    mdb.soundCover.upsert.mockResolvedValue({});
    await captureSoundCover("sound-1", [cover("abc"), cover("abc", nowS + 7200)], NOW);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("tries the same picture on another host when one host has lost it", async () => {
    // Measured 2026-10-19: one cover answered 404 on TikTok's Singapore host
    // (/aweme/<key>.jpeg) and 200 on its US host (/tos-…/<key>~….jpeg).
    const sg = "https://p16-sg.tiktokcdn.com/aweme/720x720/tos-alisg-v-2774/owg99.jpeg";
    const us = "https://p16-common.tiktokcdn-us.com/tos-alisg-v-2774/owg99~tplv-obj.jpeg";
    mdb.tikTokSound.findUnique.mockResolvedValue({
      orgId: "org-1",
      cover: { fetchedAt: null, sourceUrl: sg, failedAt: new Date(NOW - 60_000) },
    });
    load.mockResolvedValue(webp);
    mdb.soundCover.upsert.mockResolvedValue({});
    expect(await captureSoundCover("sound-1", [sg, us], NOW)).toBe(us);
    expect(load).toHaveBeenCalledTimes(1);

    // Held, the other host's link is the same picture: no download.
    load.mockClear();
    mdb.tikTokSound.findUnique.mockResolvedValue({
      orgId: "org-1",
      cover: { fetchedAt: new Date(NOW), sourceUrl: us, failedAt: null },
    });
    expect(await captureSoundCover("sound-1", [sg], NOW)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("does nothing for a sound that no longer exists", async () => {
    mdb.tikTokSound.findUnique.mockResolvedValue(null);
    expect(await captureSoundCover("gone", cover("abc"), NOW)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("never throws, and stays quiet when the table is not there yet", async () => {
    mdb.tikTokSound.findUnique.mockRejectedValue(missingTable());
    await expect(captureSoundCover("sound-1", cover("abc"), NOW)).resolves.toBeNull();

    mdb.tikTokSound.findUnique.mockRejectedValue(new Error("Can't reach database server"));
    await expect(captureSoundCover("sound-1", cover("abc"), NOW)).resolves.toBeNull();
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

  it("leaves sourceUrl naming the held copy when a new link fails", async () => {
    load.mockResolvedValue({ ok: false, status: 502, message: "upstream error 404" });
    mdb.soundCover.upsert.mockResolvedValue({});

    await storeSoundCoverFromUrl({ id: "sound-1", orgId: "org-1" }, cover("new"), { holding: true });
    expect(mdb.soundCover.upsert.mock.calls[0][0].update).not.toHaveProperty("sourceUrl");

    await storeSoundCoverFromUrl({ id: "sound-1", orgId: "org-1" }, cover("new"), { holding: false });
    expect(mdb.soundCover.upsert.mock.calls[1][0].update).toMatchObject({ sourceUrl: cover("new") });
  });

  it("keeps only our own encoding, never the CDN's raw bytes", async () => {
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

describe("soundsWithoutCover", () => {
  it("names sounds tracked a day or more with no copy held, across every org", async () => {
    mdb.tikTokSound.findMany.mockResolvedValue([{ id: "s-1" }, { id: "s-2" }]);
    expect(await soundsWithoutCover(NOW)).toEqual(["s-1", "s-2"]);
    const where = mdb.tikTokSound.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("orgId");
    expect(where.createdAt).toEqual({ lt: new Date(NOW - SOUND_COVER_MISSING_ALERT_MS) });
    expect(where.OR).toEqual([{ cover: { is: null } }, { cover: { is: { fetchedAt: null } } }]);
  });

  it("is empty before the table exists", async () => {
    mdb.tikTokSound.findMany.mockRejectedValue(missingTable());
    expect(await soundsWithoutCover(NOW)).toEqual([]);
  });
});
