import { mediaUrl, embedSrcFor } from "@/lib/postMedia";
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
