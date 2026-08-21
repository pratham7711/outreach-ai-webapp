import {
  createRateGate,
  isBlockedStatus,
  parseTikTokDetailStatus,
  parseTikTokRehydration,
} from "@/lib/platforms/fetchPostMetrics";

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

describe("isBlockedStatus", () => {
  it("treats throttling and server faults as blocking", () => {
    expect(isBlockedStatus(403)).toBe(true);
    expect(isBlockedStatus(429)).toBe(true);
    expect(isBlockedStatus(503)).toBe(true);
  });

  it("does not treat a removed video as blocking", () => {
    expect(isBlockedStatus(404)).toBe(false);
    expect(isBlockedStatus(410)).toBe(false);
  });
});

describe("createRateGate", () => {
  function gate(over: Partial<Parameters<typeof createRateGate>[0]> = {}) {
    return createRateGate({
      minGapMs: 0,
      jitterMs: 0,
      breakerThreshold: 3,
      breakerCooldownMs: 60_000,
      ...over,
    });
  }

  it("allows the first acquire", async () => {
    expect(await gate().acquire()).toBe(true);
  });

  it("spaces consecutive acquires by at least the minimum gap", async () => {
    const g = gate({ minGapMs: 60 });
    const startedAt = Date.now();
    await g.acquire();
    await g.acquire();
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(55);
  });

  it("opens the breaker after consecutive blocks and refuses to acquire", async () => {
    const g = gate();
    g.recordBlocked();
    g.recordBlocked();
    expect(g.isOpen()).toBe(false);

    g.recordBlocked();
    expect(g.isOpen()).toBe(true);
    expect(await g.acquire()).toBe(false);
  });

  it("resets the failure run on a success", () => {
    const g = gate();
    g.recordBlocked();
    g.recordBlocked();
    g.recordSuccess();
    g.recordBlocked();
    g.recordBlocked();
    expect(g.isOpen()).toBe(false);
  });

  it("closes the breaker once the cooldown elapses", () => {
    const g = gate();
    g.recordBlocked();
    g.recordBlocked();
    g.recordBlocked();
    expect(g.isOpen()).toBe(true);
    expect(g.isOpen(Date.now() + 60_001)).toBe(false);
  });
});

// Shape confirmed against a live TikTok response on 2026-08-20: a removed post
// comes back HTTP 200 with statusCode 10204 "item doesn't exist".
describe("parseTikTokDetailStatus", () => {
  it("reports the status of a removed post so it is not mistaken for a block", () => {
    const html = page({
      "webapp.video-detail": { statusCode: 10204, statusMsg: "item doesn't exist" },
    });
    expect(parseTikTokDetailStatus(html)).toBe(10204);
    expect(parseTikTokRehydration(html)).toBeNull();
  });

  it("reports 0 for a healthy payload", () => {
    expect(parseTikTokDetailStatus(page(videoDetail()))).toBe(0);
  });

  it("returns null when there is no payload at all — the genuine block case", () => {
    expect(parseTikTokDetailStatus("<html><body>nope</body></html>")).toBeNull();
    expect(
      parseTikTokDetailStatus(
        '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{not json</script>'
      )
    ).toBeNull();
  });

  it("returns null when the payload carries no video-detail scope", () => {
    expect(parseTikTokDetailStatus(page({ "webapp.user-detail": { statusCode: 0 } }))).toBeNull();
  });
});
