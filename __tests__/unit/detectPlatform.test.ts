import { detectPlatform } from "@/lib/platforms/fetchPostMetrics";

/**
 * The URL is the only evidence available at paste time, so what it does and
 * does not say both matter: a wrong media type is silently written to the post,
 * and a wrong handle would attribute someone else's video to a creator.
 */
describe("detectPlatform", () => {
  describe("TikTok", () => {
    it("reads the id, the handle and the kind off a video URL", () => {
      expect(detectPlatform("https://www.tiktok.com/@rebilion.edits/video/7546394810303694849"))
        .toEqual({ platform: "TIKTOK", id: "7546394810303694849", mediaType: "VIDEO", handle: "rebilion.edits" });
    });

    it("calls a photo carousel a POST, not a video", () => {
      expect(detectPlatform("https://www.tiktok.com/@someone/photo/7546394810303694849"))
        .toMatchObject({ platform: "TIKTOK", mediaType: "POST" });
    });
  });

  describe("Instagram", () => {
    it("handles the bare reel form, which names no author", () => {
      expect(detectPlatform("https://www.instagram.com/reel/C8xYz-1AbCd/"))
        .toEqual({ platform: "INSTAGRAM", id: "C8xYz-1AbCd", mediaType: "REEL" });
    });

    it("handles the author-prefixed form the share sheet produces", () => {
      // This form previously matched nothing at all.
      expect(detectPlatform("https://www.instagram.com/awxyken/reel/C8xYz-1AbCd/"))
        .toEqual({ platform: "INSTAGRAM", id: "C8xYz-1AbCd", mediaType: "REEL", handle: "awxyken" });
    });

    it("does not mistake the word 'reel' for a handle", () => {
      const r = detectPlatform("https://www.instagram.com/reel/C8xYz-1AbCd/");
      expect(r?.handle).toBeUndefined();
    });

    it("separates a photo post from a reel", () => {
      expect(detectPlatform("https://www.instagram.com/p/C8xYz-1AbCd/"))
        .toMatchObject({ mediaType: "POST" });
    });

    it("reads a story and its author", () => {
      expect(detectPlatform("https://www.instagram.com/stories/awxyken/3412345678901234567"))
        .toEqual({ platform: "INSTAGRAM", id: "3412345678901234567", mediaType: "STORY", handle: "awxyken" });
    });
  });

  describe("YouTube", () => {
    it("calls a short a SHORT", () => {
      expect(detectPlatform("https://www.youtube.com/shorts/dQw4w9WgXcQ"))
        .toMatchObject({ platform: "YOUTUBE", id: "dQw4w9WgXcQ", mediaType: "SHORT" });
    });

    it("calls a watch URL a VIDEO and claims no handle", () => {
      expect(detectPlatform("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
        .toEqual({ platform: "YOUTUBE", id: "dQw4w9WgXcQ", mediaType: "VIDEO" });
    });

    it("still reads youtu.be short links", () => {
      expect(detectPlatform("https://youtu.be/dQw4w9WgXcQ"))
        .toMatchObject({ platform: "YOUTUBE", id: "dQw4w9WgXcQ" });
    });
  });

  it("returns null for a URL it cannot place", () => {
    expect(detectPlatform("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(detectPlatform("not a url")).toBeNull();
  });
});
