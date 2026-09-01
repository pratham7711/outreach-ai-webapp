/**
 * The music-embed sound reader — the rung that removed the VPS requirement.
 *
 * scripts/sound-worker/README.md is right that the music page has no count and
 * that /api/music/detail/ needs headers only TikTok's client script can make.
 * The embed page is the exception: it server-renders an embedInfo carrying the
 * count. Measured once, from a Vercel Sandbox in iad1, against one real sound.
 *
 * One measurement is why these tests are about REFUSING rather than parsing. A
 * bogus sound id returns a 239KB generic shell with no embedInfo, and a count
 * written from a page we did not actually understand would end up in a client's
 * report. Every ambiguous shape here must come back null.
 */
import {
  parseTikTokMusicEmbed,
  tikTokMusicEmbedUrl,
} from "@/lib/platforms/tiktokSoundEmbed";

const ID = "7546394810303694849";

/** The shape measured on prod, verbatim in structure. */
const realEmbedInfo = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    coverUrl: "https://p19-common.tiktokcdn-us.com/tos-alisg-v-2774/abc~tplv.jpeg",
    artist: "Ellie Holcomb",
    videoCount: 44,
    id: ID,
    statusCode: 0,
    code: 200,
    ...over,
  });

const page = (info: string) =>
  `<html><script>window.x={"pageName":"music","embedInfo":${info},"playlistEndpoint":"${ID}"}</script></html>`;

describe("the URL", () => {
  it("points at the embed, not the music page", () => {
    expect(tikTokMusicEmbedUrl(ID)).toBe(`https://www.tiktok.com/embed/music/${ID}`);
  });

  it("encodes the id rather than interpolating it raw", () => {
    expect(tikTokMusicEmbedUrl("a/b?c")).toBe("https://www.tiktok.com/embed/music/a%2Fb%3Fc");
  });
});

describe("a good reading", () => {
  it("reads the count TikTok calls videoCount", () => {
    const s = parseTikTokMusicEmbed(page(realEmbedInfo()), ID);
    expect(s).not.toBeNull();
    expect(s!.usesCount).toBe(44);
  });

  it("carries the artist and cover the snapshot backfills", () => {
    const s = parseTikTokMusicEmbed(page(realEmbedInfo()), ID)!;
    expect(s.artist).toBe("Ellie Holcomb");
    expect(s.coverImageUrl).toContain("tiktokcdn");
  });

  it("leaves the title null, because the embed does not carry one", () => {
    // Must not be mistaken for evidence that a stored title is wrong.
    expect(parseTikTokMusicEmbed(page(realEmbedInfo()), ID)!.title).toBeNull();
  });

  it("accepts a genuine zero — a sound nobody has used is a real reading", () => {
    const s = parseTikTokMusicEmbed(page(realEmbedInfo({ videoCount: 0 })), ID);
    expect(s!.usesCount).toBe(0);
  });

  it("survives a brace inside the artist name", () => {
    // Free text, so the extractor steps over string contents rather than
    // counting braces blindly — the lesson the captions taught the Top Posts parser.
    const s = parseTikTokMusicEmbed(page(realEmbedInfo({ artist: 'Odd } Name {' })), ID);
    expect(s!.usesCount).toBe(44);
    expect(s!.artist).toBe("Odd } Name {");
  });
});

describe("refusals", () => {
  it("returns null for the shell a non-existent sound serves", () => {
    // 239KB of page with no embedInfo anywhere. This is the common failure.
    expect(parseTikTokMusicEmbed("<html><body>nothing here</body></html>", ID)).toBeNull();
  });

  it("returns null when statusCode is not 0", () => {
    // Not a zero-use sound — no reading at all.
    expect(parseTikTokMusicEmbed(page(realEmbedInfo({ statusCode: 10221 })), ID)).toBeNull();
  });

  it("returns null when the embed is for a different sound", () => {
    expect(parseTikTokMusicEmbed(page(realEmbedInfo({ id: "999999999999999999" })), ID)).toBeNull();
  });

  it("still reads when no expected id is supplied", () => {
    expect(parseTikTokMusicEmbed(page(realEmbedInfo()))!.usesCount).toBe(44);
  });

  it("returns null when videoCount is missing or not a number", () => {
    expect(parseTikTokMusicEmbed(page(realEmbedInfo({ videoCount: undefined })), ID)).toBeNull();
    expect(parseTikTokMusicEmbed(page(realEmbedInfo({ videoCount: "lots" })), ID)).toBeNull();
  });

  it("returns null on a negative count", () => {
    expect(parseTikTokMusicEmbed(page(realEmbedInfo({ videoCount: -1 })), ID)).toBeNull();
  });

  it("returns null when embedInfo is present but unparseable", () => {
    expect(parseTikTokMusicEmbed('{"embedInfo":{not json at all', ID)).toBeNull();
  });

  it("returns null when embedInfo is never closed", () => {
    expect(parseTikTokMusicEmbed('{"embedInfo":{"videoCount":44', ID)).toBeNull();
  });
});
