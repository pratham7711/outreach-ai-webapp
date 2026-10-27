import {
  audioFieldFor,
  droppedNotice,
  isLastingRefusal,
  movedNotice,
  notAddedReason,
} from "@/lib/campaigns/audioLinkField";

describe("audioFieldFor — the field a pasted link belongs in", () => {
  it.each([
    ["https://www.tiktok.com/music/Runaway-6604064037363780357", "TIKTOK"],
    ["tiktok.com/music/Runaway-6604064037363780357", "TIKTOK"],
    ["https://vm.tiktok.com/ZMabc123/", "TIKTOK"],
    ["https://www.tiktok.com/@someone/video/7400000000000000001", "TIKTOK"],
    ["6604064037363780357", "TIKTOK"],
    ["https://www.instagram.com/reels/audio/2094289147512017/", "INSTAGRAM"],
    ["https://m.instagram.com/reel/Cabc123/", "INSTAGRAM"],
    ["https://open.spotify.com/track/69bRMupnNveGN0PbZNoctn?si=x", "SPOTIFY"],
    ["https://open.spotify.com/album/69bRMupnNveGN0PbZNoctn", "SPOTIFY"],
    ["https://spotify.link/AbCdEf", "SPOTIFY"],
    ["spotify:track:69bRMupnNveGN0PbZNoctn", "SPOTIFY"],
  ])("%s -> %s", (link, field) => {
    expect(audioFieldFor(link)).toBe(field);
  });

  it.each([
    "",
    "   ",
    "https://www.youtube.com/watch?v=abc",
    "https://nottiktok.com/music/x-6604064037363780357",
    "https://instagram.com.evil.example/reels/audio/1/",
    "not a link at all",
  ])("%p belongs to none of them", (link) => {
    expect(audioFieldFor(link)).toBeNull();
  });
});

describe("what is said about a link", () => {
  it("names original audio in a line, and falls back to the route's words for an unknown code", () => {
    expect(notAddedReason("instagram_audio_no_count", "x")).toMatch(/^That's original audio\./);
    expect(notAddedReason("album", "x")).toBe("That's an album link. Open the song and copy its link.");
    expect(notAddedReason("something_new", "The route's own sentence.")).toBe("The route's own sentence.");
    expect(notAddedReason(null, "Fallback.")).toBe("Fallback.");
  });

  it("says where a moved link came from, and when it replaced one", () => {
    expect(movedNotice("TIKTOK", false)).toEqual({ tone: "moved", text: "Moved here from TikTok sound." });
    expect(movedNotice("SPOTIFY", true).text).toBe("Moved here from Spotify link, in place of the link that was here.");
    expect(droppedNotice("not_found", "x")).toEqual({ tone: "dropped", text: "Spotify has no track at that link." });
    expect(droppedNotice("not_found", "x", true).text).toBe("Spotify has no track at that link. The link already in this field stays.");
  });

  it("leaves a link out only for what is true of the link, not of the moment", () => {
    expect(isLastingRefusal("video_url")).toBe(true);
    expect(isLastingRefusal("instagram_audio_no_count")).toBe(true);
    expect(isLastingRefusal("instagram_audio_not_found")).toBe(true);
    expect(isLastingRefusal("short_link_unresolvable")).toBe(false);
    expect(isLastingRefusal("instagram_audio_unreadable")).toBe(false);
    expect(isLastingRefusal(undefined)).toBe(false);
  });
});
