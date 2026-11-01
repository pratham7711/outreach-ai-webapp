import { MAX_PASTE, instagramDmUrl, parseProspectInput, profileUrl } from "@/lib/creatorFinder/prospects";

describe("parseProspectInput", () => {
  it("reads bare handles, @handles and profile links, one per line or comma-separated", () => {
    const { items, skipped } = parseProspectInput(
      "@Creator_One, creator.two\nhttps://www.instagram.com/creator_three/?hl=en\ninstagram.com/creator_four",
    );
    expect(items).toEqual([
      { platform: "INSTAGRAM", handle: "creator_one", channelId: null },
      { platform: "INSTAGRAM", handle: "creator.two", channelId: null },
      { platform: "INSTAGRAM", handle: "creator_three", channelId: null },
      { platform: "INSTAGRAM", handle: "creator_four", channelId: null },
    ]);
    expect(skipped).toEqual([]);
  });

  it("lets a link name its own platform, whatever bare handles default to", () => {
    const { items } = parseProspectInput(
      "https://www.youtube.com/@PhonkChannel https://youtube.com/channel/UCabcdefghijklmnopqrstuv @ig_person",
    );
    expect(items).toEqual([
      { platform: "YOUTUBE", handle: "phonkchannel", channelId: null },
      { platform: "YOUTUBE", handle: "UCabcdefghijklmnopqrstuv", channelId: "UCabcdefghijklmnopqrstuv" },
      { platform: "INSTAGRAM", handle: "ig_person", channelId: null },
    ]);
  });

  it("treats bare handles as YouTube when that is the platform picked", () => {
    expect(parseProspectInput("@funk_channel", "YOUTUBE").items).toEqual([
      { platform: "YOUTUBE", handle: "funk_channel", channelId: null },
    ]);
  });

  it("says why it skipped something instead of dropping it silently", () => {
    const { items, skipped } = parseProspectInput(
      "https://www.instagram.com/p/C0abc123/ https://www.tiktok.com/@someone https://example.com/x not!a!handle",
    );
    expect(items).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual([
      "Not an Instagram profile link",
      "TikTok profiles can't be looked up through an official API yet",
      "Not an Instagram or YouTube link",
      "Not an Instagram handle",
    ]);
  });

  it("drops duplicates, case-insensitively, before counting against the limit", () => {
    const { items } = parseProspectInput("@a_b @A_B https://instagram.com/a_b/");
    expect(items).toHaveLength(1);
  });

  it(`stops at ${MAX_PASTE} per paste and reports how many were over`, () => {
    const raw = Array.from({ length: MAX_PASTE + 7 }, (_, i) => `@creator_${i}`).join("\n");
    const { items, overLimit } = parseProspectInput(raw);
    expect(items).toHaveLength(MAX_PASTE);
    expect(overLimit).toBe(7);
  });
});

describe("links", () => {
  it("builds profile and DM links that open the creator's own page, never a send", () => {
    expect(profileUrl({ platform: "INSTAGRAM", handle: "x.y" })).toBe("https://www.instagram.com/x.y/");
    expect(profileUrl({ platform: "YOUTUBE", handle: "chan" })).toBe("https://www.youtube.com/@chan");
    expect(profileUrl({ platform: "YOUTUBE", handle: "UCabcdefghijklmnopqrstuv", channelId: "UCabcdefghijklmnopqrstuv" })).toBe(
      "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv",
    );
    expect(instagramDmUrl("x.y")).toBe("https://ig.me/m/x.y");
  });
});
