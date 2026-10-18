import { campaignArtwork } from "@/lib/campaignArtwork";

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
 * A signed CDN link is a picture with a shelf life. The audio setup copied the
 * sound's signed cover into thumbnailUrl, where nothing renews it, so the
 * client report's header went to a music note once it expired. Our own copy of
 * the sound's cover (lib/sounds/coverStore) is what lasts.
 */
describe("campaignArtwork and signed links", () => {
  const NOW = Date.parse("2026-10-18T12:00:00Z");
  const signed = (hoursFromNow: number) =>
    `https://p16-sign-sg.tiktokcdn.com/c.jpeg?x-expires=${Math.floor(NOW / 1000) + hoursFromNow * 3600}&x-signature=z`;
  const stored = "/api/sounds/sound-1/cover?v=1";

  it("prefers our stored copy over a signed thumbnail, live or not", () => {
    const campaign = { thumbnailUrl: signed(48), song: { coverUrl: null, sound: { coverImageUrl: signed(48) } } };
    expect(campaignArtwork(campaign, stored, NOW)).toBe(stored);
    expect(campaignArtwork({ ...campaign, thumbnailUrl: signed(-48) }, stored, NOW)).toBe(stored);
  });

  it("still lets a thumbnail somebody chose, with no signature, come first", () => {
    expect(campaignArtwork({ thumbnailUrl: "https://cdn/stored.jpg" }, stored, NOW)).toBe("https://cdn/stored.jpg");
  });

  it("skips a link past its signature instead of painting a broken box", () => {
    expect(
      campaignArtwork(
        { thumbnailUrl: signed(-1), song: { coverUrl: "https://cdn/song.jpg", sound: { coverImageUrl: signed(72) } } },
        null,
        NOW
      )
    ).toBe(signed(72));
    expect(campaignArtwork({ thumbnailUrl: signed(-1), song: { coverUrl: null, sound: { coverImageUrl: signed(-1) } } }, null, NOW)).toBeNull();
  });

  it("keeps a live signed thumbnail when nothing is stored yet", () => {
    expect(campaignArtwork({ thumbnailUrl: signed(2), song: { coverUrl: "https://cdn/song.jpg" } }, null, NOW)).toBe(signed(2));
  });
});
