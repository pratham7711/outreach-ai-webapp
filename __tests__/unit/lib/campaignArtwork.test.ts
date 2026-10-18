import { campaignArtwork, songArtwork } from "@/lib/campaignArtwork";

/**
 * The new-campaign form stopped asking for a thumbnail URL, so a campaign's
 * picture now comes from the sound it promotes. Every campaign created from
 * here on has thumbnailUrl null, which makes this fallback the only thing
 * standing between a music campaign and a grey initial.
 */
describe("campaignArtwork", () => {
  it("prefers a stored thumbnail, which older campaigns still carry", () => {
    // Measured on the dev copy of prod: 506 of 512 campaigns have one.
    expect(
      campaignArtwork({
        thumbnailUrl: "https://cdn/stored.jpg",
        song: { coverUrl: "https://cdn/song.jpg", sound: { coverImageUrl: "https://cdn/sound.jpg" } },
      })
    ).toBe("https://cdn/stored.jpg");
  });

  it("falls back to the sound's cover, which is fetched from the live sound page", () => {
    expect(
      campaignArtwork({
        thumbnailUrl: null,
        song: { coverUrl: "https://cdn/song.jpg", sound: { coverImageUrl: "https://cdn/sound.jpg" } },
      })
    ).toBe("https://cdn/sound.jpg");
  });

  it("falls back to the song's own cover when the sound has none yet", () => {
    /* The usual state right after creation: the tracker has not read the sound
       page yet, so coverImageUrl is null while the catalogued release has art.
       campaignPerformance.ts resolves the same two in the same order. */
    expect(
      campaignArtwork({ thumbnailUrl: null, song: { coverUrl: "https://cdn/song.jpg", sound: { coverImageUrl: null } } })
    ).toBe("https://cdn/song.jpg");
  });

  it("returns null rather than a blank string when there is no artwork at all", () => {
    // The card tests this for truthiness to decide between an image and initials.
    expect(campaignArtwork({ thumbnailUrl: null, song: null })).toBeNull();
    expect(campaignArtwork({})).toBeNull();
    expect(campaignArtwork({ thumbnailUrl: null, song: { coverUrl: null, sound: null } })).toBeNull();
  });
});

/**
 * A link is a picture only while the server behind it keeps it. The audio
 * setup copied the sound's signed cover into thumbnailUrl, where nothing
 * renews it, and the client report's header went to a music note once it
 * expired. Our own copies (lib/campaigns/thumbnailCopy, lib/sounds/coverStore)
 * are what last.
 */
describe("campaignArtwork and stored copies", () => {
  const NOW = Date.parse("2026-10-18T12:00:00Z");
  const signed = (hoursFromNow: number) =>
    `https://p16-sign-sg.tiktokcdn.com/c.jpeg?x-expires=${Math.floor(NOW / 1000) + hoursFromNow * 3600}&x-signature=z`;
  const soundCover = "/api/sounds/sound-1/cover?v=1";
  const thumbnail = "/api/campaigns/camp-1/thumbnail?v=1";

  it("prefers our copy of the campaign's own picture over everything", () => {
    const campaign = { thumbnailUrl: "https://x.cdn.bubble.io/f1/a.png", song: { sound: { coverImageUrl: signed(48) } } };
    expect(campaignArtwork(campaign, { thumbnail, soundCover }, NOW)).toBe(thumbnail);
  });

  it("prefers our copy of the sound's cover over a signed thumbnail, live or not", () => {
    const campaign = { thumbnailUrl: signed(48), song: { coverUrl: null, sound: { coverImageUrl: signed(48) } } };
    expect(campaignArtwork(campaign, { soundCover }, NOW)).toBe(soundCover);
    expect(campaignArtwork({ ...campaign, thumbnailUrl: signed(-48) }, { soundCover }, NOW)).toBe(soundCover);
  });

  it("still lets a thumbnail somebody chose, with no signature, come before the sound's copy", () => {
    expect(campaignArtwork({ thumbnailUrl: "https://cdn/stored.jpg" }, { soundCover }, NOW)).toBe("https://cdn/stored.jpg");
  });

  it("skips a chosen thumbnail already known not to draw", () => {
    const campaign = { thumbnailUrl: "https://x.cdn.bubble.io/f1/gone.png", song: { sound: { coverImageUrl: signed(48) } } };
    expect(campaignArtwork(campaign, { thumbnailDead: true, soundCover }, NOW)).toBe(soundCover);
    expect(campaignArtwork(campaign, { thumbnailDead: true }, NOW)).toBe(signed(48));
  });

  it("skips a link past its signature instead of painting a broken box", () => {
    expect(
      campaignArtwork(
        { thumbnailUrl: signed(-1), song: { coverUrl: "https://cdn/song.jpg", sound: { coverImageUrl: signed(72) } } },
        {},
        NOW
      )
    ).toBe(signed(72));
    expect(campaignArtwork({ thumbnailUrl: signed(-1), song: { coverUrl: null, sound: { coverImageUrl: signed(-1) } } }, {}, NOW)).toBeNull();
  });

  it("keeps a live signed thumbnail when nothing is stored yet", () => {
    expect(campaignArtwork({ thumbnailUrl: signed(2), song: { coverUrl: "https://cdn/song.jpg" } }, {}, NOW)).toBe(signed(2));
  });

  it("never offers a page as a picture", () => {
    // A TikTok music page saved as the thumbnail: the sound's cover stands in.
    const tiktokPage = { thumbnailUrl: "https://www.tiktok.com/music/x-123", song: { sound: { coverImageUrl: signed(48) } } };
    expect(campaignArtwork(tiktokPage, {}, NOW)).toBe(signed(48));
    expect(campaignArtwork({ thumbnailUrl: "https://www.tiktok.com/music/x-123" }, {}, NOW)).toBeNull();
    // A YouTube video becomes the picture YouTube serves for it.
    expect(campaignArtwork({ thumbnailUrl: "https://youtu.be/HP6AmFsxbU8" }, {}, NOW)).toBe(
      "https://i.ytimg.com/vi/HP6AmFsxbU8/hqdefault.jpg"
    );
  });

  it("normalises a protocol-relative upload the way the screens do", () => {
    expect(campaignArtwork({ thumbnailUrl: "//x.cdn.bubble.io/f1/a.png" }, {}, NOW)).toBe("https://x.cdn.bubble.io/f1/a.png");
  });
});

describe("songArtwork", () => {
  const NOW = Date.parse("2026-10-18T12:00:00Z");
  const igExpired = "https://scontent.xx.fbcdn.net/v/t39/a.jpg?_nc_ht=y&oe=" + Math.floor((NOW - 86_400_000) / 1000).toString(16);

  it("shows the sound's stored cover when the song has none catalogued, as every prod song does", () => {
    expect(songArtwork({ coverUrl: null, sound: { id: "s1", coverImageUrl: igExpired } }, "/api/sounds/s1/cover?v=1", NOW)).toBe(
      "/api/sounds/s1/cover?v=1"
    );
  });

  it("keeps a catalogued cover ahead of the sound's", () => {
    expect(songArtwork({ coverUrl: "https://cdn.example/release.jpg", sound: { id: "s1" } }, "/api/sounds/s1/cover?v=1", NOW)).toBe(
      "https://cdn.example/release.jpg"
    );
  });

  it("draws the placeholder rather than a link past its signature", () => {
    expect(songArtwork({ coverUrl: null, sound: { id: "s1", coverImageUrl: igExpired } }, null, NOW)).toBeNull();
  });

  it("has nothing to show for a song with no sound", () => {
    expect(songArtwork({ coverUrl: null, sound: null }, null, NOW)).toBeNull();
  });
});
