import { deslugTitle, parseSoundUrl } from "@/lib/trackers/soundUrl";

const REAL = "7546394810303694849"; // "Wherever I Go" — the one real tracked sound

describe("parseSoundUrl — canonical music links", () => {
  it("reads the id off a normal music URL", () => {
    const r = parseSoundUrl(`https://www.tiktok.com/music/Wherever-I-Go-${REAL}`);
    expect(r).toEqual({ kind: "sound", platform: "TIKTOK", tiktokSoundId: REAL, provisionalTitle: "Wherever I Go" });
  });

  it("takes the TRAILING digit run, not the first number in the slug", () => {
    // Titles legitimately contain digits: "first number wins" would track 2.
    const r = parseSoundUrl(`https://www.tiktok.com/music/song-2-remix-${REAL}`);
    expect(r).toMatchObject({ kind: "sound", tiktokSoundId: REAL });
  });

  it("ignores share query params and fragments", () => {
    const a = parseSoundUrl(`https://www.tiktok.com/music/x-${REAL}?_t=8k2&_r=1&is_from_webapp=1#top`);
    const b = parseSoundUrl(`https://www.tiktok.com/music/x-${REAL}`);
    expect(a).toEqual(b);
  });

  it("accepts m., bare host, trailing slash and a missing scheme", () => {
    for (const u of [
      `https://m.tiktok.com/music/a-${REAL}`,
      `https://tiktok.com/music/a-${REAL}/`,
      `www.tiktok.com/music/a-${REAL}`,
      `HTTPS://WWW.TIKTOK.COM/music/a-${REAL}`,
    ]) {
      expect(parseSoundUrl(u)).toMatchObject({ kind: "sound", tiktokSoundId: REAL });
    }
  });

  it("accepts a slug that is only the id", () => {
    expect(parseSoundUrl(`https://www.tiktok.com/music/${REAL}`)).toEqual({
      kind: "sound",
      platform: "TIKTOK",
      tiktokSoundId: REAL,
      provisionalTitle: null,
    });
  });

  it("still accepts a bare id, which is what ops paste", () => {
    expect(parseSoundUrl(REAL)).toEqual({
      kind: "sound",
      platform: "TIKTOK",
      tiktokSoundId: REAL,
      provisionalTitle: null,
    });
  });
});

describe("parseSoundUrl — the mistakes", () => {
  it("names a video link specifically rather than failing generically", () => {
    // The id in a video URL is a video id; tracking it would follow a sound
    // that does not exist. This is the most common paste, so it gets its own
    // message telling the user where the sound link actually is.
    expect(parseSoundUrl("https://www.tiktok.com/@someone/video/7312345678901234567")).toEqual({
      kind: "video",
      reason: "video_url",
    });
  });

  it("treats a photo carousel link as a video link too", () => {
    expect(parseSoundUrl("https://www.tiktok.com/@someone/photo/7312345678901234567")).toMatchObject({
      kind: "video",
    });
  });

  it("defers short links to the server, which can follow the redirect", () => {
    expect(parseSoundUrl("https://vm.tiktok.com/ZMabc123/")).toMatchObject({ kind: "short-link" });
    expect(parseSoundUrl("https://vt.tiktok.com/ZSxyz/")).toMatchObject({ kind: "short-link" });
    expect(parseSoundUrl("https://www.tiktok.com/t/ZT8abc/")).toMatchObject({ kind: "short-link" });
  });

  it("rejects a non-TikTok host outright", () => {
    expect(parseSoundUrl("https://example.com/music/a-1234567890123456789")).toEqual({
      kind: "invalid",
      reason: "not_tiktok",
    });
  });

  it("rejects a lookalike host rather than trusting a suffix match", () => {
    expect(parseSoundUrl("https://tiktok.com.evil.example/music/a-1234567890123456789")).toMatchObject({
      kind: "invalid",
      reason: "not_tiktok",
    });
  });

  it("rejects empty and unparseable input", () => {
    expect(parseSoundUrl("")).toMatchObject({ kind: "invalid" });
    expect(parseSoundUrl("   ")).toMatchObject({ kind: "invalid" });
    expect(parseSoundUrl("not a url at all")).toMatchObject({ kind: "invalid" });
  });

  it("rejects a music link with no id in it", () => {
    expect(parseSoundUrl("https://www.tiktok.com/music/just-a-title")).toMatchObject({
      kind: "invalid",
      reason: "unrecognised",
    });
  });

  it("rejects an id that is too short to be a snowflake", () => {
    // 7300001 is one of the invented seed ids that polluted production.
    expect(parseSoundUrl("https://www.tiktok.com/music/fake-7300001")).toMatchObject({
      kind: "invalid",
    });
    expect(parseSoundUrl("7300001")).toMatchObject({ kind: "invalid" });
  });
});

describe("deslugTitle", () => {
  it("turns a slug into a readable provisional title", () => {
    expect(deslugTitle(`Wherever-I-Go-${REAL}`)).toBe("Wherever I Go");
  });

  it("capitalises every word, including the single-letter one", () => {
    // No small-word exception: it would spare "up in the air" at the cost of
    // getting "Wherever I Go" wrong, and that is the common case.
    expect(deslugTitle(`up-in-the-air-${REAL}`)).toBe("Up In The Air");
  });

  it("decodes percent-encoding", () => {
    expect(deslugTitle(`caf%C3%A9-nights-${REAL}`)).toBe("Café Nights");
  });

  it("returns null when the slug is only an id", () => {
    expect(deslugTitle(REAL)).toBeNull();
  });
});

/**
 * Instagram audio. The URL shape and the sample id are taken verbatim from a
 * live CreatorCore audio tracker (soundurl_text), so these assert against what
 * the reference app actually stores rather than a guess at the format.
 */
describe("parseSoundUrl — Instagram audio", () => {
  const IG = "477633528619317"; // BMW FUNK (SLOWED), a real CreatorCore tracker

  it("reads the id off the canonical reels/audio link", () => {
    expect(parseSoundUrl(`https://www.instagram.com/reels/audio/${IG}/`)).toEqual({
      kind: "sound",
      platform: "INSTAGRAM",
      tiktokSoundId: IG,
      provisionalTitle: null,
    });
  });

  it("accepts the singular /reel/audio/ spelling and a missing trailing slash", () => {
    expect(parseSoundUrl(`https://instagram.com/reel/audio/${IG}`)).toMatchObject({
      kind: "sound",
      platform: "INSTAGRAM",
      tiktokSoundId: IG,
    });
  });

  it("ignores share query params", () => {
    const a = parseSoundUrl(`https://www.instagram.com/reels/audio/${IG}/?igsh=abc123`);
    const b = parseSoundUrl(`https://www.instagram.com/reels/audio/${IG}/`);
    expect(a).toEqual(b);
  });

  it("names a reel permalink as a post link, not a sound", () => {
    // The shortcode is the reel's, not the audio's -- tracking it would follow
    // something that does not exist, the same trap as a TikTok video link.
    expect(parseSoundUrl("https://www.instagram.com/reel/C8xYzAbCdEf/")).toEqual({
      kind: "video",
      reason: "video_url",
    });
  });

  it("names a feed post link the same way", () => {
    expect(parseSoundUrl("https://www.instagram.com/p/C8xYzAbCdEf/")).toEqual({
      kind: "video",
      reason: "video_url",
    });
  });

  it("does not mistake an Instagram profile for a sound", () => {
    expect(parseSoundUrl("https://www.instagram.com/remembxredphonk/")).toMatchObject({
      kind: "invalid",
    });
  });

  it("keeps TikTok ids on TikTok — an IG id is too short for a snowflake", () => {
    // A bare 15-digit id is not a TikTok snowflake and must not be accepted as
    // one; platform comes from the host, never from the id's shape.
    expect(parseSoundUrl(IG)).toMatchObject({ kind: "invalid" });
  });
});
