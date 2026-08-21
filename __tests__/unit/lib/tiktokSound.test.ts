import { parseTikTokSoundRehydration, soundUrl } from "@/lib/platforms/tiktokSound";

function wrap(payload: unknown): string {
  return `<html><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(
    payload
  )}</script></body></html>`;
}

function musicPage(overrides: Record<string, unknown> = {}) {
  return {
    __DEFAULT_SCOPE__: {
      "webapp.music-detail": {
        statusCode: 0,
        musicInfo: {
          stats: { videoCount: 863958 },
          music: {
            title: "Espresso",
            authorName: "Sabrina Carpenter",
            coverLarge: "https://cdn.example/cover.jpg",
          },
        },
        ...overrides,
      },
    },
  };
}

describe("parseTikTokSoundRehydration", () => {
  it("reads uses, title, artist and cover from a music page", () => {
    const result = parseTikTokSoundRehydration(wrap(musicPage()));
    expect(result).toEqual({
      usesCount: 863958,
      title: "Espresso",
      artist: "Sabrina Carpenter",
      coverImageUrl: "https://cdn.example/cover.jpg",
    });
  });

  it("returns null when the script tag is absent", () => {
    expect(parseTikTokSoundRehydration("<html><body>nothing</body></html>")).toBeNull();
  });

  it("returns null on malformed JSON rather than throwing", () => {
    const html =
      '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{not json</script>';
    expect(() => parseTikTokSoundRehydration(html)).not.toThrow();
    expect(parseTikTokSoundRehydration(html)).toBeNull();
  });

  it("returns null when TikTok reports a non-zero status", () => {
    const payload = {
      __DEFAULT_SCOPE__: {
        "webapp.music-detail": { statusCode: 10202, musicInfo: { stats: { videoCount: 5 } } },
      },
    };
    expect(parseTikTokSoundRehydration(wrap(payload))).toBeNull();
  });

  it("returns null when no usage count is present, rather than reporting zero uses", () => {
    const payload = {
      __DEFAULT_SCOPE__: {
        "webapp.music-detail": {
          statusCode: 0,
          musicInfo: { music: { title: "No stats" } },
        },
      },
    };
    expect(parseTikTokSoundRehydration(wrap(payload))).toBeNull();
  });

  it("preserves a genuine zero-use sound instead of discarding it", () => {
    const payload = {
      __DEFAULT_SCOPE__: {
        "webapp.music-detail": {
          statusCode: 0,
          musicInfo: { stats: { videoCount: 0 }, music: { title: "Brand new" } },
        },
      },
    };
    const result = parseTikTokSoundRehydration(wrap(payload));
    expect(result).not.toBeNull();
    expect(result!.usesCount).toBe(0);
  });

  it("accepts the music-page scope variant", () => {
    const payload = {
      __DEFAULT_SCOPE__: {
        "webapp.music-page": {
          statusCode: 0,
          musicInfo: { stats: { videoCount: 42 }, music: { title: "Alt scope" } },
        },
      },
    };
    expect(parseTikTokSoundRehydration(wrap(payload))!.usesCount).toBe(42);
  });

  it("falls back to videoCount on the music object", () => {
    const payload = {
      __DEFAULT_SCOPE__: {
        "webapp.music-detail": {
          statusCode: 0,
          musicInfo: { music: { title: "Nested", videoCount: 77 } },
        },
      },
    };
    expect(parseTikTokSoundRehydration(wrap(payload))!.usesCount).toBe(77);
  });

  it("returns null for an unrelated rehydration payload", () => {
    const payload = { __DEFAULT_SCOPE__: { "webapp.video-detail": { statusCode: 0 } } };
    expect(parseTikTokSoundRehydration(wrap(payload))).toBeNull();
  });
});

describe("soundUrl", () => {
  it("builds a music URL and escapes the id", () => {
    expect(soundUrl("123456")).toBe("https://www.tiktok.com/music/x-123456");
    expect(soundUrl("a b")).toBe("https://www.tiktok.com/music/x-a%20b");
  });
});
