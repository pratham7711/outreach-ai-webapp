import {
  instagramAudioPageUrl,
  parseAudioTitle,
  parseInstagramAudioPage,
  parseUsesCount,
} from "@/lib/platforms/instagramAudioPage";

/* The three fixtures are the Open Graph blocks Instagram actually served on
   2026-09-17, copied rather than composed:
     music    instagram.com/reels/audio/2094289147512017/  (AURORA, Runaway)
     original instagram.com/reels/audio/932615931412635/   (avawillyums)
     missing  instagram.com/reels/audio/1234567890123456/  (a fabricated id)
   All three answered 200. That is the point of this file. */

const MUSIC = `<html><head>
<meta property="og:title" content="AURORA | Runaway on Instagram" />
<meta property="og:description" content="1M reels - Listen to AURORA on Instagram and watch reels using Runaway audio" />
<meta property="og:image" content="https://scontent.fdel11-2.fna.fbcdn.net/v/t39.30808-6/427959948_353.jpg?oh=00_AQL&amp;oe=6AB166FE" />
</head><body></body></html>`;

const ORIGINAL_AUDIO = `<html><head>
<meta property="og:title" content="avawillyums | Original audio on Instagram" />
<meta property="og:description" content="Listen to avawillyums on Instagram and watch reels with original audio" />
<meta property="og:image" content="https://scontent.cdninstagram.com/v/t51.82787-19/658931277_1.jpg" />
</head><body></body></html>`;

const NO_SUCH_AUDIO = `<html><head>
<meta property="og:title" content="Audio on Instagram" />
<meta property="og:description" content="Discover the most recent and top videos on Instagram" />
</head><body></body></html>`;

/* What a browser user-agent gets: 627KB of app shell and no og block at all. */
const BROWSER_SHELL = `<html><head><title>Instagram</title></head><body><div id="root"></div></body></html>`;

describe("parseUsesCount", () => {
  it("reads the abbreviated count Instagram published, and says it is rounded", () => {
    expect(parseUsesCount("1M reels - Listen to AURORA on Instagram")).toEqual({
      usesCount: 1_000_000,
      precision: "rounded",
    });
  });

  it("keeps a plain number exact, grouping and all", () => {
    expect(parseUsesCount("9,482 reels - Listen")).toEqual({ usesCount: 9482, precision: "exact" });
    expect(parseUsesCount("7 reels - Listen")).toEqual({ usesCount: 7, precision: "exact" });
  });

  it("reads the singular, which one reel produces", () => {
    expect(parseUsesCount("1 reel - Listen")).toEqual({ usesCount: 1, precision: "exact" });
  });

  it("scales the suffixes and marks every one of them rounded", () => {
    expect(parseUsesCount("12.5K reels")).toEqual({ usesCount: 12_500, precision: "rounded" });
    expect(parseUsesCount("3.4M reels")).toEqual({ usesCount: 3_400_000, precision: "rounded" });
    expect(parseUsesCount("2B reels")).toEqual({ usesCount: 2_000_000_000, precision: "rounded" });
    expect(parseUsesCount("1m reels")).toEqual({ usesCount: 1_000_000, precision: "rounded" });
  });

  /* Original audio's description opens with "Listen to", never a number. This
     must be null and not zero -- the audio exists and is in use, Instagram
     simply does not say by how many. */
  it("finds no count in the original-audio description", () => {
    expect(parseUsesCount("Listen to avawillyums on Instagram and watch reels with original audio")).toBeNull();
  });

  it("refuses a decimal with no suffix rather than guessing what it meant", () => {
    expect(parseUsesCount("1.5 reels")).toBeNull();
  });

  it("ignores a number that is not counting reels", () => {
    expect(parseUsesCount("500 followers - Listen")).toBeNull();
    expect(parseUsesCount("Discover the most recent and top videos on Instagram")).toBeNull();
  });
});

describe("parseAudioTitle", () => {
  it("splits artist from track", () => {
    expect(parseAudioTitle("AURORA | Runaway on Instagram")).toEqual({
      artist: "AURORA",
      title: "Runaway",
    });
  });

  it("keeps the creator's handle as the artist of their original audio", () => {
    expect(parseAudioTitle("avawillyums | Original audio on Instagram")).toEqual({
      artist: "avawillyums",
      title: "Original audio",
    });
  });

  /* The generic shell has no pipe, which is what distinguishes it. */
  it("returns nothing for the generic audio shell", () => {
    expect(parseAudioTitle("Audio on Instagram")).toBeNull();
    expect(parseAudioTitle(null)).toBeNull();
  });

  it("does not strip an 'on Instagram' that belongs to the track name", () => {
    expect(parseAudioTitle("Band | Live on Instagram on Instagram")).toEqual({
      artist: "Band",
      title: "Live on Instagram",
    });
  });
});

describe("parseInstagramAudioPage", () => {
  it("reads a licensed track", () => {
    const out = parseInstagramAudioPage(MUSIC);
    expect(out.kind).toBe("reading");
    if (out.kind !== "reading") throw new Error("unreachable");
    expect(out.reading.usesCount).toBe(1_000_000);
    expect(out.reading.precision).toBe("rounded");
    expect(out.reading.artist).toBe("AURORA");
    expect(out.reading.title).toBe("Runaway");
    // The entity in the signed cover URL is decoded, or the URL 403s.
    expect(out.reading.coverImageUrl).toContain("oh=00_AQL&oe=");
  });

  /* Existing, in use, and publishing no number. Not a failure to read, and
     emphatically not zero uses. */
  it("separates original audio from a sound with no uses", () => {
    const out = parseInstagramAudioPage(ORIGINAL_AUDIO);
    expect(out.kind).toBe("no-count");
    if (out.kind !== "no-count") throw new Error("unreachable");
    expect(out.artist).toBe("avawillyums");
    expect(out.title).toBe("Original audio");
  });

  /* The trap this whole module exists for: Instagram answers 200 for an id
     that is not an audio page. Calling that zero uses would put a real-looking
     number on a tracker for something that was never there. */
  it("calls the generic shell not-found even though it arrived as a 200", () => {
    expect(parseInstagramAudioPage(NO_SUCH_AUDIO)).toEqual({ kind: "not-found" });
  });

  /* Distinct from not-found on purpose: the audio may exist perfectly well and
     this reader simply could not see it, which is a different thing to do
     about and the shape that would appear if Instagram stopped serving the og
     block to non-browsers. */
  it("reports the browser shell as unreadable, not as a missing audio", () => {
    expect(parseInstagramAudioPage(BROWSER_SHELL)).toEqual({
      kind: "unreadable",
      reason: "no-og-block",
    });
  });

  it("reads the tags whichever order the attributes come in", () => {
    const reversed = `<meta content="AURORA | Runaway on Instagram" property="og:title">
      <meta content="1M reels - Listen" property="og:description">`;
    const out = parseInstagramAudioPage(reversed);
    expect(out.kind).toBe("reading");
  });
});

describe("instagramAudioPageUrl", () => {
  it("asks for English, so the count string is the one the parser reads", () => {
    expect(instagramAudioPageUrl("2094289147512017")).toBe(
      "https://www.instagram.com/reels/audio/2094289147512017/?hl=en",
    );
  });

  it("escapes the id rather than pasting it into the path", () => {
    expect(instagramAudioPageUrl("../../evil")).toContain("..%2F..%2Fevil");
  });
});
