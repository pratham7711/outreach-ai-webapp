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
