/**
 * Reach is the one counter a discovery-based vendor cannot obtain, so it is
 * worth a test that it is actually asked for -- and a test that its absence
 * stays an absence. CreatorCore's own exported data carries reach for 0 of
 * 18,638 posts while carrying saves for 7,042 of them, which is what the
 * distinction is for: a metric nobody was allowed to read is not a post nobody
 * saw, and writing 0 would assert the second.
 */
import { fetchInstagramMetricsGraph } from "@/lib/platforms/instagram";
import { countsFrom } from "@/lib/sync/syncPost";
import type { PostMetrics } from "@/lib/platforms/fetchPostMetrics";

jest.mock("@/lib/db", () => ({ db: {} }));

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

const SHORTCODE = "Cxyz123";
const URL = `https://www.instagram.com/p/${SHORTCODE}/`;

/** me/accounts -> one media page -> the insights call for the matched media. */
function mockGraph(insights: Array<{ name: string; values: Array<{ value: number }> }>) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("me/accounts")) {
      return json({ data: [{ instagram_business_account: { id: "ig-1" } }] });
    }
    /* Checked before /media on purpose: the insights URL is
       ".../media-1/insights", which also contains "/media", so the looser test
       would answer the insights call with a media page. */
    if (url.includes("/insights")) return json({ data: insights });
    if (url.includes("/media")) {
      return json({
        data: [
          {
            id: "media-1",
            permalink: `https://www.instagram.com/p/${SHORTCODE}/`,
            caption: "hello",
            like_count: 12,
            comments_count: 3,
            thumbnail_url: "https://cdn/t.jpg",
            timestamp: "2026-08-01T10:00:00+0000",
          },
        ],
      });
    }
    return json({});
  }) as unknown as typeof fetch;
  return calls;
}

describe("Instagram insights", () => {
  it("asks for reach in the same round trip as views", async () => {
    /* The endpoint bills per call, not per metric, so asking separately would
       double the cost of the walk for nothing. */
    const calls = mockGraph([
      { name: "views", values: [{ value: 900 }] },
      { name: "reach", values: [{ value: 700 }] },
    ]);

    await fetchInstagramMetricsGraph(URL, "tok");

    const insightsCall = calls.find((c) => c.includes("/insights"));
    expect(insightsCall).toBeDefined();
    expect(decodeURIComponent(insightsCall!)).toContain("metric=views,reach");
  });

  it("carries reach through as a counter", async () => {
    mockGraph([
      { name: "views", values: [{ value: 900 }] },
      { name: "reach", values: [{ value: 700 }] },
    ]);

    const out = await fetchInstagramMetricsGraph(URL, "tok");

    expect(out?.viewsCount).toBe(900);
    expect(out?.reachCount).toBe(700);
  });

  it("leaves reach undefined when the payload omits it, never 0", async () => {
    /* This is the state every post is in until Meta App Review lands: the
       insights call succeeds and simply carries no reach. */
    mockGraph([{ name: "views", values: [{ value: 900 }] }]);

    const out = await fetchInstagramMetricsGraph(URL, "tok");

    expect(out?.viewsCount).toBe(900);
    expect(out?.reachCount).toBeUndefined();
    expect(out).not.toHaveProperty("reachCount", 0);
  });

  it("still returns reach when views is the metric that is missing", async () => {
    /* An image publishes no play count. Reading the two independently is what
       stops a missing views from discarding a reach we were given. */
    mockGraph([{ name: "reach", values: [{ value: 700 }] }]);

    const out = await fetchInstagramMetricsGraph(URL, "tok");

    expect(out?.viewsCount).toBeUndefined();
    expect(out?.reachCount).toBe(700);
  });
});

describe("countsFrom", () => {
  const base: PostMetrics = {
    platform: "INSTAGRAM",
    platformPostId: "1",
    thumbnailUrl: null,
    caption: null,
  };

  it("writes reachCount and marks reach measured when it arrived", () => {
    const { counts, present } = countsFrom({ ...base, viewsCount: 10, reachCount: 7 });
    expect(counts.reachCount).toBe(7);
    expect(present).toContain("reach");
  });

  it("omits the column entirely when reach is absent", () => {
    /* Not 0. The column defaults to 0 in the schema, so writing an absent reach
       as 0 is indistinguishable from a post that reached nobody -- and 82% of
       our posts are TikTok, which has no reach concept at all. */
    const { counts, present } = countsFrom({ ...base, viewsCount: 10 });
    expect(counts).not.toHaveProperty("reachCount");
    expect(present).not.toContain("reach");
  });

  it("records a genuine zero reach when the platform actually said zero", () => {
    const { counts, present } = countsFrom({ ...base, reachCount: 0 });
    expect(counts.reachCount).toBe(0);
    expect(present).toContain("reach");
  });
});
