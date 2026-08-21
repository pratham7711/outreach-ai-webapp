import { lookupTikTokPost } from "@/lib/platforms/fetchPostMetrics";

const URL = "https://www.tiktok.com/@someone/video/7123456789012345678";

function page(videoDetail: unknown): string {
  return `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(
    { __DEFAULT_SCOPE__: { "webapp.video-detail": videoDetail } }
  )}</script>`;
}

function htmlResponse(body: string) {
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}

const realFetch = global.fetch;

describe("lookupTikTokPost", () => {
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it("reports a live post with its stats", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      htmlResponse(
        page({
          statusCode: 0,
          itemInfo: {
            itemStruct: {
              desc: "a clip",
              createTime: "1750000000",
              video: { cover: "https://cdn.example/c.jpg" },
              stats: { playCount: 63346, diggCount: 4200, commentCount: 310, shareCount: 88 },
            },
          },
        })
      )
    ) as unknown as typeof fetch;

    const r = await lookupTikTokPost(URL);
    expect(r.state).toBe("live");
    expect(r.statusCode).toBe(0);
    expect(r.metrics?.viewsCount).toBe(63346);
    expect(r.metrics?.likesCount).toBe(4200);
  });

  // The real shape TikTok returned on 2026-08-20 for a removed post.
  it("reports a deleted post distinctly, not as a failure", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        htmlResponse(page({ statusCode: 10204, statusMsg: "item doesn't exist" }))
      ) as unknown as typeof fetch;

    const r = await lookupTikTokPost(URL);
    expect(r.state).toBe("deleted");
    expect(r.statusCode).toBe(10204);
    expect(r.metrics).toBeNull();
    expect(r.reason).toBeNull();
  });

  it("says unavailable — never 'deleted' — when the payload is missing", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(htmlResponse("<html>challenge page</html>")) as unknown as typeof fetch;

    const r = await lookupTikTokPost(URL);
    expect(r.state).toBe("unavailable");
    expect(r.reason).toBe("no-parsable-payload");
  });

  it("says unavailable on a non-OK response, carrying the status", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 403 } as unknown as Response) as unknown as typeof fetch;

    const r = await lookupTikTokPost(URL);
    expect(r.state).toBe("unavailable");
    expect(r.reason).toBe("http-403");
  });

  it("says unavailable when the fetch throws", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;

    const r = await lookupTikTokPost(URL);
    expect(r.state).toBe("unavailable");
    expect(r.metrics).toBeNull();
  });
});
