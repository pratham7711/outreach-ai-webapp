import { mediaUrl, embedSrcFor, imgSrc, shareImgSrc } from "@/lib/postMedia";
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
