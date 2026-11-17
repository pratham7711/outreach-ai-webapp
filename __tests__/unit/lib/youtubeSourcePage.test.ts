import { extractJsonAfter, parseShortsCount, parseYouTubeSourcePage } from "@/lib/platforms/youtubeSourcePage";
import { parseSoundUrl } from "@/lib/trackers/soundUrl";

/* The shapes measured on youtube.com/source/<id>/shorts on 2026-11-17, cut
   down to the fields the parser reads. */
function page(data: unknown): string {
  return `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;
}

function header(title: string, artist: string, count?: string, cover?: string) {
  return {
    pageHeaderRenderer: {
      pageTitle: title,
      content: {
        pageHeaderViewModel: {
          title: { dynamicTextViewModel: { text: { content: title } } },
          ...(cover
            ? { image: { contentPreviewImageViewModel: { image: { sources: [{ url: `${cover}=s88`, width: 88 }, { url: `${cover}=s256`, width: 256 }] } } } }
            : {}),
          metadata: {
            contentMetadataViewModel: {
              metadataRows: [
                { metadataParts: [{ avatarStack: { avatarStackViewModel: { text: { content: artist } } } }] },
                ...(count ? [{ metadataParts: [{ text: { content: count } }] }] : []),
              ],
            },
          },
        },
      },
    },
  };
}

function grid(ids: string[], continues: boolean) {
  return {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              richGridRenderer: {
                contents: [
                  ...ids.map((id) => ({
                    richItemRenderer: {
                      content: { shortsLockupViewModel: { entityId: `shorts-shelf-item-${id}`, onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: id } } } } },
                    },
                  })),
                  ...(continues ? [{ continuationItemRenderer: { trigger: "CONTINUATION_TRIGGER_ON_ITEM_SHOWN" } }] : []),
                ],
              },
            },
          },
        },
      ],
    },
  };
}

describe("parseYouTubeSourcePage", () => {
  it("reads the printed count, rounded when abbreviated", () => {
    const html = page({ header: header("Never Gonna Give You Up (Cake Mix)", "@RickAstleyYT", "137K Shorts"), contents: grid(["a".repeat(11)], true) });
    expect(parseYouTubeSourcePage(html, "dQw4w9WgXcQ")).toEqual({
      kind: "reading",
      reading: {
        usesCount: 137_000,
        precision: "rounded",
        title: "Never Gonna Give You Up (Cake Mix)",
        artist: "@RickAstleyYT",
        coverImageUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      },
    });
  });

  it("counts a fully listed grid exactly when no count is printed (efCmfyPaK5U: 6 Shorts)", () => {
    const ids = ["v1aaaaaaaaa", "v2aaaaaaaaa", "v3aaaaaaaaa", "v4aaaaaaaaa", "v5aaaaaaaaa", "v6aaaaaaaaa"];
    const html = page({ header: header("code.red", "DudePlaya, DXNTVX", undefined, "https://yt3.googleusercontent.com/cover"), contents: grid(ids, false) });
    const result = parseYouTubeSourcePage(html, "efCmfyPaK5U");
    expect(result).toEqual({
      kind: "reading",
      reading: {
        usesCount: 6,
        precision: "exact",
        title: "code.red",
        artist: "DudePlaya, DXNTVX",
        coverImageUrl: "https://yt3.googleusercontent.com/cover=s256",
      },
    });
  });

  it("refuses a first page of Shorts that continues: a floor is not a count", () => {
    const html = page({ header: header("Song", "Artist"), contents: grid(["v1aaaaaaaaa"], true) });
    expect(parseYouTubeSourcePage(html).kind).toBe("no-count");
  });

  it("reads no header as no such source, and no data as unreadable", () => {
    expect(parseYouTubeSourcePage(page({ contents: grid([], false) })).kind).toBe("not-found");
    expect(parseYouTubeSourcePage("<html>consent</html>").kind).toBe("unreadable");
  });

  it("parses data whose strings contain braces and script ends", () => {
    const html = `var ytInitialData = {"a":"};</script>{","b":{"c":1}};</script>`;
    expect(extractJsonAfter(html, "ytInitialData")).toEqual({ a: "};</script>{", b: { c: 1 } });
  });
});

describe("parseShortsCount", () => {
  it.each([
    ["137K Shorts", 137_000, "rounded"],
    ["2.9M Shorts", 2_900_000, "rounded"],
    ["1,204 Shorts", 1204, "exact"],
    ["1 Short", 1, "exact"],
  ])("%s", (text, usesCount, precision) => {
    expect(parseShortsCount(text)).toEqual({ usesCount, precision });
  });

  it("returns null for anything that is not a count", () => {
    expect(parseShortsCount("@RickAstleyYT")).toBeNull();
    expect(parseShortsCount("12 views")).toBeNull();
  });
});

describe("parseSoundUrl: YouTube", () => {
  it.each([
    "https://www.youtube.com/source/efCmfyPaK5U/shorts?app=desktop&bp=8gVdClASQQoLZWZDbWZ5UGFLNVUSC2VmQ21meVBhSzVV&ra=m",
    "https://m.youtube.com/source/efCmfyPaK5U",
    "https://youtu.be/efCmfyPaK5U?si=abc",
    "https://www.youtube.com/watch?v=efCmfyPaK5U&t=3",
    "https://music.youtube.com/watch?v=efCmfyPaK5U",
  ])("%s is the source efCmfyPaK5U", (url) => {
    expect(parseSoundUrl(url)).toEqual({ kind: "sound", platform: "YOUTUBE", tiktokSoundId: "efCmfyPaK5U", provisionalTitle: null });
  });

  it("names a Short as a post, not its audio", () => {
    expect(parseSoundUrl("https://www.youtube.com/shorts/wc60whcV3Ew")).toEqual({ kind: "video", reason: "video_url" });
  });

  it("refuses a channel page and a malformed id", () => {
    expect(parseSoundUrl("https://www.youtube.com/@someone").kind).toBe("invalid");
    expect(parseSoundUrl("https://www.youtube.com/watch?v=abc").kind).toBe("invalid");
  });
});
