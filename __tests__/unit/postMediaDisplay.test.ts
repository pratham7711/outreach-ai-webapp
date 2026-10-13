import { mediaUrl, embedSrcFor, imgSrc, shareImgSrc, youtubeVideoId, postThumbnailUrl, postThumbnailPath, sharePostThumbnailPath } from "@/lib/postMedia";
import { metricValue, engagementRateValue } from "@/lib/metricDisplay";

/**
 * The imported thumbnails are protocol-relative Bubble CDN paths and the
 * engagement counters are zero-by-default, so both helpers exist to stop the UI
 * lying: one about where an image lives, the other about a number nobody
 * measured.
 */
describe("mediaUrl", () => {
  it("makes a protocol-relative CDN path absolute", () => {
    // 18,580 of 18,665 stored thumbnails look exactly like this.
    expect(mediaUrl("//ea59.cdn.bubble.io/f123/x.png")).toBe("https://ea59.cdn.bubble.io/f123/x.png");
  });

  it("upgrades http to https so the page does not go mixed-content", () => {
    expect(mediaUrl("http://i.ytimg.com/vi/abc/hq.jpg")).toBe("https://i.ytimg.com/vi/abc/hq.jpg");
  });

  it("leaves an https url alone and treats blanks as absent", () => {
    expect(mediaUrl("https://i.ytimg.com/vi/abc/hq.jpg")).toBe("https://i.ytimg.com/vi/abc/hq.jpg");
    expect(mediaUrl("   ")).toBeNull();
    expect(mediaUrl(null)).toBeNull();
    expect(mediaUrl(undefined)).toBeNull();
  });
});

describe("embedSrcFor", () => {
  it("builds a TikTok player from a numeric id", () => {
    expect(embedSrcFor("TIKTOK", "7361234567890123456", null)).toBe(
      "https://www.tiktok.com/embed/v2/7361234567890123456"
    );
  });

  it("recovers a TikTok id from the url when the stored id is a handle", () => {
    expect(embedSrcFor("TIKTOK", "@someone", "https://www.tiktok.com/@someone/video/7399999999999999999")).toBe(
      "https://www.tiktok.com/embed/v2/7399999999999999999"
    );
  });

  it("handles Instagram reels as well as posts", () => {
    expect(embedSrcFor("INSTAGRAM", null, "https://www.instagram.com/reel/CxYz123/")).toBe(
      "https://www.instagram.com/p/CxYz123/embed"
    );
  });

  it("handles YouTube shorts and watch urls", () => {
    expect(embedSrcFor("YOUTUBE", null, "https://www.youtube.com/shorts/Wy0uiI_7vgY")).toBe(
      "https://www.youtube.com/embed/Wy0uiI_7vgY"
    );
    expect(embedSrcFor("YOUTUBE", null, "https://www.youtube.com/watch?v=Wy0uiI_7vgY")).toBe(
      "https://www.youtube.com/embed/Wy0uiI_7vgY"
    );
  });

  it("ignores a stored YouTube id that is not a video id and reads the url", () => {
    // CreatorCore stored its own 32-character record id on 838 YouTube posts.
    expect(
      embedSrcFor("YOUTUBE", "0123456789abcdef0123456789abcdef", "https://www.youtube.com/watch?v=Wy0uiI_7vgY&t=3s")
    ).toBe("https://www.youtube.com/embed/Wy0uiI_7vgY");
    expect(embedSrcFor("YOUTUBE", "0123456789abcdef0123456789abcdef", "https://youtu.be/Wy0uiI_7vgY?si=abc")).toBe(
      "https://www.youtube.com/embed/Wy0uiI_7vgY"
    );
    expect(embedSrcFor("YOUTUBE", "Wy0uiI_7vgY", "https://www.youtube.com/watch?v=Wy0uiI_7vgY")).toBe(
      "https://www.youtube.com/embed/Wy0uiI_7vgY"
    );
    expect(embedSrcFor("YOUTUBE", "0123456789abcdef0123456789abcdef", "https://www.youtube.com/@someone")).toBeNull();
  });

  it("takes the Instagram shortcode from the url over a stored record id", () => {
    expect(embedSrcFor("INSTAGRAM", "17912345678901234", "https://www.instagram.com/reel/CxYz123/")).toBe(
      "https://www.instagram.com/p/CxYz123/embed"
    );
  });

  it("returns null when there is nothing to build a player from", () => {
    // The caller then shows the still image and an outbound link instead.
    expect(embedSrcFor("TIKTOK", null, "https://tiktok.com/@x")).toBeNull();
    expect(embedSrcFor("LINKEDIN", "123", "https://linkedin.com/feed/x")).toBeNull();
  });
});

describe("metricValue", () => {
  it("shows a real number regardless of sync state", () => {
    expect(metricValue(4200, null)).toBe(4200);
  });

  it("treats a zero we never fetched as unknown", () => {
    // 18,602 posts are in exactly this state.
    expect(metricValue(0, null)).toBeNull();
  });

  it("keeps a zero we actually observed", () => {
    expect(metricValue(0, "2026-08-20T10:00:00.000Z")).toBe(0);
  });
});

describe("engagementRateValue", () => {
  it("is unknown when neither likes nor comments were ever measured", () => {
    // Better a dash than a confident 0.00% on a post with 6.8M views.
    expect(engagementRateValue(0, 0, 6_800_000, null)).toBeNull();
  });

  it("computes from real counts", () => {
    expect(engagementRateValue(50, 50, 1000, null)).toBeCloseTo(10);
  });

  it("is unknown without a view count to divide by", () => {
    expect(engagementRateValue(10, 5, 0, "2026-08-20T10:00:00.000Z")).toBeNull();
  });
});

describe("imgSrc", () => {
  it("routes a CDN image through the normaliser at the size asked for", () => {
    expect(imgSrc("//x.cdn.bubble.io/f/a.heic", 128)).toBe(
      "/api/img?u=https%3A%2F%2Fx.cdn.bubble.io%2Ff%2Fa.heic&w=128"
    );
  });

  it("carries a height only when the box is not square", () => {
    expect(imgSrc("https://x.cdn.bubble.io/f/a.png", 112, 148)).toContain("&w=112&h=148");
    expect(imgSrc("https://x.cdn.bubble.io/f/a.png", 96, 96)).not.toContain("&h=");
  });

  it("stays null with nothing stored, so callers fall back to initials", () => {
    expect(imgSrc(null)).toBeNull();
    expect(imgSrc("   ")).toBeNull();
  });

  /* The URL is the cache key, so an avatar asked for at three sizes by three
     surfaces used to mean three fetches of the same source from the upstream
     CDN -- which is 376ms of the 380ms a first view costs. */
  it("snaps a square request up to the nearest standard width", () => {
    const at = (w: number) => imgSrc("https://x.cdn.bubble.io/f/a.png", w);
    expect(at(112)).toContain("&w=128");
    expect(at(128)).toContain("&w=128");
    expect(at(88)).toContain("&w=96");
    expect(at(64)).toContain("&w=64");
    expect(at(160)).toContain("&w=192");
  });

  it("gives the same URL for the sizes it collapses, which is the point", () => {
    const url = "https://x.cdn.bubble.io/f/a.png";
    expect(imgSrc(url, 112)).toBe(imgSrc(url, 128));
    expect(imgSrc(url, 97)).toBe(imgSrc(url, 128));
  });

  it("never snaps down, so nothing is painted from too few pixels", () => {
    const url = "https://x.cdn.bubble.io/f/a.png";
    for (const w of [17, 40, 65, 100, 200, 300, 500, 800]) {
      const got = Number(/&w=(\d+)/.exec(imgSrc(url, w) ?? "")?.[1]);
      expect(got).toBeGreaterThanOrEqual(w);
    }
  });

  /* A 240x160 thumbnail has a deliberate aspect ratio and the proxy crops to
     cover, so rounding its width up alone would re-crop the picture. */
  it("leaves a non-square box exactly as asked", () => {
    expect(imgSrc("https://x.cdn.bubble.io/f/a.png", 240, 160)).toContain("&w=240&h=160");
    expect(imgSrc("https://x.cdn.bubble.io/f/a.png", 320, 568)).toContain("&w=320&h=568");
  });

  it("snaps the share-link variant the same way", () => {
    expect(shareImgSrc("tok", "https://x.cdn.bubble.io/f/a.png", 112)).toContain("&w=128");
    expect(shareImgSrc("tok", "https://x.cdn.bubble.io/f/a.png", 240, 160)).toContain("&w=240&h=160");
  });
});

describe("youtubeVideoId", () => {
  it("trusts a stored id only when it has YouTube's eleven-character shape", () => {
    expect(youtubeVideoId("9bZkp7q19f0", null)).toBe("9bZkp7q19f0");
    // An importer's 32-character record id is not a video id; the URL is.
    expect(youtubeVideoId("1690000000000x123456789012345678", "https://www.youtube.com/watch?v=9bZkp7q19f0")).toBe("9bZkp7q19f0");
  });

  it("reads watch, short-link, Shorts and live URLs", () => {
    expect(youtubeVideoId(null, "https://youtu.be/9bZkp7q19f0?t=3")).toBe("9bZkp7q19f0");
    expect(youtubeVideoId(null, "https://www.youtube.com/shorts/9bZkp7q19f0")).toBe("9bZkp7q19f0");
    expect(youtubeVideoId(null, "https://www.youtube.com/live/9bZkp7q19f0")).toBe("9bZkp7q19f0");
    expect(youtubeVideoId(null, "https://www.youtube.com/@someone")).toBeNull();
  });
});

describe("postThumbnailUrl", () => {
  it("keeps a stored thumbnail", () => {
    expect(postThumbnailUrl({ platform: "YOUTUBE", platformPostId: "9bZkp7q19f0", thumbnailUrl: "//ea59.cdn.bubble.io/x.png" })).toBe(
      "//ea59.cdn.bubble.io/x.png"
    );
  });

  it("gives a YouTube post with none the picture YouTube serves for every video", () => {
    expect(postThumbnailUrl({ platform: "YOUTUBE", platformPostId: null, postUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0", thumbnailUrl: null })).toBe(
      "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg"
    );
  });

  it("does not invent one for other platforms or an unreadable YouTube link", () => {
    expect(postThumbnailUrl({ platform: "TIKTOK", platformPostId: "7300000000000000000", thumbnailUrl: null })).toBeNull();
    expect(postThumbnailUrl({ platform: "YOUTUBE", platformPostId: null, postUrl: "https://www.youtube.com/@someone", thumbnailUrl: null })).toBeNull();
  });
});

/* Our own copy of a post's cover goes where the CDN link went (PostDto,
   the share report's rows), so the same imgSrc/shareImgSrc calls the cards
   already make have to pass it through with the box added -- not wrap it in
   the CDN proxy, which would refuse a relative path. */
describe("stored post pictures", () => {
  it("names the copy by post and version", () => {
    expect(postThumbnailPath("p 1", 1000)).toBe("/api/posts/p%201/thumbnail?v=1000");
    expect(sharePostThumbnailPath("tok", "p 1", 1000)).toBe("/api/share/tok/thumbnail/p%201?v=1000");
  });

  it("adds the box a surface asks for, snapped the way the proxy snaps it", () => {
    expect(imgSrc(postThumbnailPath("p1", 7), 320, 568)).toBe("/api/posts/p1/thumbnail?v=7&w=320&h=568");
    expect(imgSrc(postThumbnailPath("p1", 7), 240, 160)).toBe("/api/posts/p1/thumbnail?v=7&w=240&h=160");
    expect(imgSrc(postThumbnailPath("p1", 7), 112)).toBe("/api/posts/p1/thumbnail?v=7&w=128");
    expect(shareImgSrc("tok", sharePostThumbnailPath("tok", "p1", 7), 478, 490)).toBe(
      "/api/share/tok/thumbnail/p1?v=7&w=478&h=490"
    );
  });

  it("lets each family through only its own door", () => {
    // A signed-in path on the public report would be a 401 to a viewer with no
    // session; a share path on the dashboard answers for one campaign only.
    expect(shareImgSrc("tok", postThumbnailPath("p1", 7), 320)).toBeNull();
    expect(imgSrc(sharePostThumbnailPath("tok", "p1", 7), 320)).toBeNull();
  });

  it("still sends every CDN link through the proxy", () => {
    expect(imgSrc("https://scontent.cdninstagram.com/v/t51/1_n.jpg?oe=6A000000", 320, 568)).toMatch(/^\/api\/img\?u=/);
    expect(shareImgSrc("tok", "https://p16-sign.tiktokcdn.com/obj/a.jpeg", 478, 490)).toMatch(/^\/api\/share\/tok\/img\?u=/);
  });
});
