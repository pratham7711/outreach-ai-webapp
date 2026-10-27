/**
 * @jest-environment node
 *
 * A song's two sound slots (lib/songs/songSounds.ts): which sound is which
 * platform's, and what setting or clearing one does to the other -- above all
 * to an older song whose Instagram audio sits in soundId.
 */
import { clearSongSound, readSongSounds, setSongSound, sortSongSounds } from "@/lib/songs/songSounds";

const TT = { id: "snd-tt", platform: "TIKTOK" };
const IG = { id: "snd-ig", platform: "INSTAGRAM" };
const IG2 = { id: "snd-ig2", platform: "INSTAGRAM" };

function fakeDb(song: Record<string, unknown> | null) {
  return {
    song: {
      findFirst: jest.fn(async () => song),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
}
type FakeDb = ReturnType<typeof fakeDb>;
const asDb = (db: FakeDb) => db as never;

describe("sortSongSounds", () => {
  it("reads each slot by its sound's platform, not by the column", () => {
    expect(sortSongSounds(TT, IG)).toEqual({ tiktok: TT, instagram: IG });
    // An older song: its one sound is Instagram's, in soundId.
    expect(sortSongSounds(IG, null)).toEqual({ tiktok: null, instagram: IG });
    expect(sortSongSounds(null, null)).toEqual({ tiktok: null, instagram: null });
  });

  it("prefers the dedicated slot if two Instagram sounds ever coexist", () => {
    expect(sortSongSounds(IG2, IG)).toEqual({ tiktok: null, instagram: IG });
  });
});

describe("readSongSounds", () => {
  it("answers no sounds, ready, for a campaign with no song, without a query", async () => {
    const db = fakeDb(null);
    expect(await readSongSounds("org-1", null, asDb(db))).toEqual({ ready: true, tiktok: null, instagram: null });
    expect(db.song.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to soundId alone, not ready, while instagramSoundId does not exist", async () => {
    const db = fakeDb(null);
    db.song.findFirst
      .mockRejectedValueOnce(Object.assign(new Error("The column `(not available)` does not exist"), { code: "P2022" }))
      .mockResolvedValueOnce({ sound: IG } as never);
    expect(await readSongSounds("org-1", "song-1", asDb(db))).toEqual({ ready: false, tiktok: null, instagram: IG });
    // Org-scoped both times.
    for (const [arg] of db.song.findFirst.mock.calls as unknown as [{ where: unknown }][]) {
      expect(arg.where).toEqual({ id: "song-1", orgId: "org-1" });
    }
  });

  it("rethrows anything that is not a missing column", async () => {
    const db = fakeDb(null);
    db.song.findFirst.mockRejectedValueOnce(new Error("connection reset"));
    await expect(readSongSounds("org-1", "song-1", asDb(db))).rejects.toThrow("connection reset");
  });
});

describe("setSongSound", () => {
  const data = (db: FakeDb) => (db.song.updateMany.mock.calls[0] as unknown as [{ data: unknown }])[0].data;

  it("puts an Instagram audio in its own slot beside the TikTok sound", async () => {
    const db = fakeDb({ soundId: "snd-tt", instagramSoundId: null, sound: { platform: "TIKTOK" } });
    expect(await setSongSound(asDb(db), "org-1", "song-1", { id: "snd-ig", platform: "INSTAGRAM" })).toBe("changed");
    expect(data(db)).toEqual({ instagramSoundId: "snd-ig" });
  });

  it("replaces an older song's Instagram audio by emptying soundId, where it lives", async () => {
    const db = fakeDb({ soundId: "snd-ig", instagramSoundId: null, sound: { platform: "INSTAGRAM" } });
    expect(await setSongSound(asDb(db), "org-1", "song-1", { id: "snd-ig2", platform: "INSTAGRAM" })).toBe("changed");
    expect(data(db)).toEqual({ instagramSoundId: "snd-ig2", soundId: null });
  });

  it("moves an older song's Instagram audio across when a TikTok sound takes soundId", async () => {
    const db = fakeDb({ soundId: "snd-ig", instagramSoundId: null, sound: { platform: "INSTAGRAM" } });
    expect(await setSongSound(asDb(db), "org-1", "song-1", { id: "snd-tt", platform: "TIKTOK" })).toBe("changed");
    expect(data(db)).toEqual({ soundId: "snd-tt", instagramSoundId: "snd-ig" });
  });

  it("replaces a TikTok sound and leaves the Instagram slot alone", async () => {
    const db = fakeDb({ soundId: "snd-tt", instagramSoundId: "snd-ig", sound: { platform: "TIKTOK" } });
    expect(await setSongSound(asDb(db), "org-1", "song-1", { id: "snd-tt2", platform: "TIKTOK" })).toBe("changed");
    expect(data(db)).toEqual({ soundId: "snd-tt2" });
  });

  it("writes nothing for the sound the song already has, in either slot", async () => {
    for (const song of [
      { soundId: "snd-tt", instagramSoundId: "snd-ig", sound: { platform: "TIKTOK" } },
      { soundId: "snd-ig", instagramSoundId: null, sound: { platform: "INSTAGRAM" } },
    ]) {
      const db = fakeDb(song);
      expect(await setSongSound(asDb(db), "org-1", "song-1", { id: "snd-ig", platform: "INSTAGRAM" })).toBe("unchanged");
      expect(db.song.updateMany).not.toHaveBeenCalled();
    }
    const db = fakeDb({ soundId: "snd-tt", instagramSoundId: null, sound: { platform: "TIKTOK" } });
    expect(await setSongSound(asDb(db), "org-1", "song-1", { id: "snd-tt", platform: "TIKTOK" })).toBe("unchanged");
    expect(db.song.updateMany).not.toHaveBeenCalled();
  });

  it("answers no-song for a song that is not this org's or is deleted, and writes nothing", async () => {
    const db = fakeDb(null);
    expect(await setSongSound(asDb(db), "org-1", "song-1", { id: "snd-ig", platform: "INSTAGRAM" })).toBe("no-song");
    expect(db.song.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "song-1", orgId: "org-1", deletedAt: null } }));
    expect(db.song.updateMany).not.toHaveBeenCalled();
  });
});

describe("clearSongSound", () => {
  const data = (db: FakeDb) => (db.song.updateMany.mock.calls[0] as unknown as [{ data: unknown; where: unknown }])[0];

  it("empties the Instagram slot and keeps the TikTok sound", async () => {
    const db = fakeDb({ sound: TT, instagramSound: IG });
    expect(await clearSongSound(asDb(db), "org-1", "song-1", "INSTAGRAM")).toBe(true);
    expect(data(db)).toEqual({ where: { id: "song-1", orgId: "org-1" }, data: { instagramSoundId: null } });
  });

  it("empties soundId for an older song's Instagram audio", async () => {
    const db = fakeDb({ sound: IG, instagramSound: null });
    expect(await clearSongSound(asDb(db), "org-1", "song-1", "INSTAGRAM")).toBe(true);
    expect(data(db).data).toEqual({ soundId: null });
  });

  it("empties the TikTok slot and keeps the Instagram audio", async () => {
    const db = fakeDb({ sound: TT, instagramSound: IG });
    expect(await clearSongSound(asDb(db), "org-1", "song-1", "TIKTOK")).toBe(true);
    expect(data(db).data).toEqual({ soundId: null });
  });

  it("answers false, writing nothing, when the song has no sound of that platform", async () => {
    const db = fakeDb({ sound: TT, instagramSound: null });
    expect(await clearSongSound(asDb(db), "org-1", "song-1", "INSTAGRAM")).toBe(false);
    expect(db.song.updateMany).not.toHaveBeenCalled();
  });
});
