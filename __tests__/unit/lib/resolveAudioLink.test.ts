/**
 * The campaign wizard's audio field, at the layer that decides what a pasted
 * link becomes. The rule worth pinning is *reuse*: a second campaign on the
 * same sound must join the existing tracker, because the usage curve belongs
 * to the audio and forking it splits the reporting in half.
 */
import { resolveAudioLink } from "@/lib/campaigns/audioLink";

type Row = { id: string };

function fakeDb(existing: { sound?: Row; song?: Row } = {}) {
  const created = { sounds: 0, songs: 0 };
  const db = {
    tikTokSound: {
      findFirst: jest.fn(async () => existing.sound ?? null),
      create: jest.fn(async () => {
        created.sounds += 1;
        return { id: "sound-new" };
      }),
    },
    song: {
      findFirst: jest.fn(async () => existing.song ?? null),
      create: jest.fn(async () => {
        created.songs += 1;
        return { id: "song-new" };
      }),
    },
  };
  return { db: db as never, created, spy: db };
}

describe("resolveAudioLink", () => {
  it("creates a sound and a song for a first-seen TikTok link", async () => {
    const { db, created, spy } = fakeDb();
    const res = await resolveAudioLink(db, "org1", "https://www.tiktok.com/music/Test-7123456789012345678", "My Campaign");

    expect(res).toEqual({ ok: true, songId: "song-new" });
    expect(created).toEqual({ sounds: 1, songs: 1 });
    expect(spy.tikTokSound.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org1", platform: "TIKTOK", tiktokSoundId: "7123456789012345678" },
      })
    );
  });

  it("accepts an Instagram audio link and scopes it to INSTAGRAM", async () => {
    const { db, spy } = fakeDb();
    const res = await resolveAudioLink(db, "org1", "https://www.instagram.com/reels/audio/477633528619317/", "My Campaign");

    expect(res).toEqual({ ok: true, songId: "song-new" });
    expect(spy.tikTokSound.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org1", platform: "INSTAGRAM", tiktokSoundId: "477633528619317" },
      })
    );
  });

  it("joins the existing tracker instead of forking a private copy", async () => {
    const { db, created } = fakeDb({ sound: { id: "sound-1" }, song: { id: "song-1" } });
    const res = await resolveAudioLink(db, "org1", "https://www.tiktok.com/music/Test-7123456789012345678", "Second Campaign");

    expect(res).toEqual({ ok: true, songId: "song-1" });
    expect(created).toEqual({ sounds: 0, songs: 0 });
  });

  it("rejects a post link rather than tracking the wrong thing", async () => {
    const { db, created } = fakeDb();
    const res = await resolveAudioLink(db, "org1", "https://www.tiktok.com/@someone/video/7123456789012345678", "My Campaign");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("video_url");
    expect(created).toEqual({ sounds: 0, songs: 0 });
  });

  it("rejects a link that is not a sound on any supported platform", async () => {
    const { db, created } = fakeDb();
    const res = await resolveAudioLink(db, "org1", "https://open.spotify.com/track/abc", "My Campaign");

    expect(res.ok).toBe(false);
    expect(created).toEqual({ sounds: 0, songs: 0 });
  });
});
