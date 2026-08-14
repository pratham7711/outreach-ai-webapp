import { parseTikTokRehydration } from "@/lib/platforms/fetchPostMetrics";

function page(scope: unknown): string {
  return [
    "<html><head></head><body>",
    `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: scope,
    })}</script>`,
    "</body></html>",
  ].join("");
}

function videoDetail(over: Record<string, unknown> = {}) {
  return {
    "webapp.video-detail": {
      statusCode: 0,
      itemInfo: {
        itemStruct: {
          desc: "a clip",
          createTime: "1750000000",
          video: { cover: "https://cdn.example/cover.jpg" },
          stats: {
            playCount: 63346,
            diggCount: 4200,
            commentCount: 310,
            shareCount: 88,
          },
          ...over,
        },
      },
    },
  };
}

describe("parseTikTokRehydration", () => {
  it("extracts counts, caption, thumbnail and postedAt", () => {
    const result = parseTikTokRehydration(page(videoDetail()));

    expect(result).not.toBeNull();
    expect(result!.viewsCount).toBe(63346);
    expect(result!.likesCount).toBe(4200);
    expect(result!.commentsCount).toBe(310);
    expect(result!.sharesCount).toBe(88);
    expect(result!.caption).toBe("a clip");
    expect(result!.thumbnailUrl).toBe("https://cdn.example/cover.jpg");
    expect(result!.postedAt?.toISOString()).toBe(new Date(1750000000 * 1000).toISOString());
  });

  it("falls back to statsV2 when stats is zeroed", () => {
    const result = parseTikTokRehydration(
      page(
        videoDetail({
          stats: { playCount: 0, diggCount: 0, commentCount: 0, shareCount: 0 },
          statsV2: {
            playCount: "91500",
            diggCount: "7010",
            commentCount: "412",
            shareCount: "120",
          },
        }),
      ),
    );

    expect(result!.viewsCount).toBe(91500);
    expect(result!.likesCount).toBe(7010);
    expect(result!.commentsCount).toBe(412);
    expect(result!.sharesCount).toBe(120);
  });

  it("preserves a genuine zero-view reading", () => {
    const result = parseTikTokRehydration(
      page(
        videoDetail({
          stats: { playCount: 0, diggCount: 0, commentCount: 0, shareCount: 0 },
        }),
      ),
    );

    expect(result).not.toBeNull();
    expect(result!.viewsCount).toBe(0);
  });

  it("returns null when the video is unavailable", () => {
    const html = page({
      "webapp.video-detail": { statusCode: 10204, itemInfo: {} },
    });

    expect(parseTikTokRehydration(html)).toBeNull();
  });

  it("returns null when the rehydration script is absent", () => {
    expect(parseTikTokRehydration("<html><body>captcha</body></html>")).toBeNull();
  });

  it("returns null on malformed JSON rather than throwing", () => {
    const html =
      '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{not json</script>';

    expect(parseTikTokRehydration(html)).toBeNull();
  });

  it("returns null when the item carries no stats at all", () => {
    const html = page({
      "webapp.video-detail": {
        statusCode: 0,
        itemInfo: { itemStruct: { desc: "no stats", createTime: "1750000000" } },
      },
    });

    expect(parseTikTokRehydration(html)).toBeNull();
  });
});
