/**
 * Shares and saves, and the cost of asking for them.
 *
 * Instagram publishes both only on the /insights edge of a media the token
 * owns, and it refuses the WHOLE request with a 400 when one metric does not
 * apply to that media type -- so asking for `views,reach,shares,saved` on an
 * image would previously have returned nothing at all, losing the views we
 * already had. The ladder is the answer: widest set first, then narrower ones,
 * stopping at the first that answers.
 *
 * What must stay true: the widest rung is tried first; a refusal falls through
 * rather than discarding the post; an auth failure or a timeout does NOT fall
 * through (the first would repeat on every media, the second would be waited
 * out once per rung); and an absent counter stays absent rather than becoming a
 * zero the platform never reported.
 */
import { fetchInstagramMetricsGraph, InstagramAuthError } from "@/lib/platforms/instagram";
import { countsFrom } from "@/lib/sync/syncPost";

jest.mock("@/lib/db", () => ({ db: {} }));

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

const SHORTCODE = "Cxyz123";
const POST_URL = `https://www.instagram.com/p/${SHORTCODE}/`;

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function graphError(status: number, code: number, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message } }),
  } as unknown as Response;
}

type Insight = { name: string; values: Array<{ value: number }> };

/**
 * me/accounts -> one media page -> whatever `answer` makes of each insights
 * call. `answer` receives the requested metric string, which is the whole point
 * of the ladder, and returns the Response for that rung.
 */
function mockGraph(answer: (metric: string) => Response) {
  const metricsAsked: string[] = [];
  global.fetch = jest.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("me/accounts")) {
      return json({ data: [{ instagram_business_account: { id: "ig-1" } }] });
    }
    // Before the /media test: the insights path also contains "/media".
    if (url.includes("/insights")) {
      const metric = new URL(url).searchParams.get("metric") ?? "";
      metricsAsked.push(metric);
      return answer(metric);
    }
    if (url.includes("/media")) {
      return json({
        data: [
          {
            id: "media-1",
            permalink: POST_URL,
            caption: "hello",
            like_count: 12,
            comments_count: 3,
            timestamp: "2026-08-01T10:00:00+0000",
          },
        ],
      });
    }
    return json({});
  }) as unknown as typeof fetch;
  return metricsAsked;
}

/** The rung that answers everything asked of it. */
const answersWith = (insights: Insight[]) => () => json({ data: insights });

describe("the insights ladder", () => {
  it("asks for shares and saves on the first attempt", async () => {
    const asked = mockGraph(answersWith([{ name: "views", values: [{ value: 900 }] }]));

    await fetchInstagramMetricsGraph(POST_URL, "tok");

    expect(asked[0]).toBe("views,reach,shares,saved");
  });

  it("returns shares and saves as counters", async () => {
    mockGraph(
      answersWith([
        { name: "views", values: [{ value: 900 }] },
        { name: "reach", values: [{ value: 700 }] },
        { name: "shares", values: [{ value: 41 }] },
        { name: "saved", values: [{ value: 58 }] },
      ]),
    );

    const out = await fetchInstagramMetricsGraph(POST_URL, "tok");

    expect(out?.viewsCount).toBe(900);
    expect(out?.reachCount).toBe(700);
    expect(out?.sharesCount).toBe(41);
    expect(out?.savesCount).toBe(58);
    expect(out?.likesCount).toBe(12);
    expect(out?.commentsCount).toBe(3);
  });

  it("falls back to a narrower metric set when Instagram refuses the wide one", async () => {
    /* The measured refusal: (#100) Invalid parameter, for the whole call, when
       one of the metrics does not apply to that media type. */
    const asked = mockGraph((metric) =>
      metric === "views,reach,shares,saved"
        ? graphError(400, 100, "(#100) Invalid parameter")
        : json({ data: [{ name: "views", values: [{ value: 900 }] }, { name: "reach", values: [{ value: 700 }] }] }),
    );

    const out = await fetchInstagramMetricsGraph(POST_URL, "tok");

    expect(asked).toEqual(["views,reach,shares,saved", "views,reach"]);
    expect(out?.viewsCount).toBe(900);
    expect(out?.reachCount).toBe(700);
  });

  it("walks all the way down to views alone", async () => {
    const asked = mockGraph((metric) =>
      metric === "views"
        ? json({ data: [{ name: "views", values: [{ value: 900 }] }] })
        : graphError(400, 100, "(#100) Invalid parameter"),
    );

    const out = await fetchInstagramMetricsGraph(POST_URL, "tok");

    expect(asked).toEqual(["views,reach,shares,saved", "views,reach", "views"]);
    expect(out?.viewsCount).toBe(900);
  });

  it("keeps the post when every rung is refused, with no counters invented", async () => {
    /* A post whose insights we cannot read is still a post: its caption,
       thumbnail and the likes/comments from the media edge are all real. */
    mockGraph(() => graphError(400, 100, "(#100) Invalid parameter"));

    const out = await fetchInstagramMetricsGraph(POST_URL, "tok");

    expect(out).not.toBeNull();
    expect(out?.likesCount).toBe(12);
    expect(out).not.toHaveProperty("viewsCount");
    expect(out).not.toHaveProperty("sharesCount");
    expect(out).not.toHaveProperty("savesCount");
  });

  it("does not retry an auth failure down the ladder", async () => {
    // Code 190 is the dead token. Every later rung and every later media would
    // fail identically, so the walk must stop and say so.
    const asked = mockGraph(() =>
      graphError(400, 190, "Error validating access token: Session has expired"),
    );

    await expect(fetchInstagramMetricsGraph(POST_URL, "tok")).rejects.toBeInstanceOf(
      InstagramAuthError,
    );
    expect(asked).toEqual(["views,reach,shares,saved"]);
  });

  it("does not retry a timeout down the ladder", async () => {
    /* Three rungs x one request timeout is three times the stall for a post we
       are not going to read anyway. */
    const asked: string[] = [];
    global.fetch = jest.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("me/accounts")) {
        return json({ data: [{ instagram_business_account: { id: "ig-1" } }] });
      }
      if (url.includes("/insights")) {
        asked.push(new URL(url).searchParams.get("metric") ?? "");
        const err = new Error("timed out");
        err.name = "TimeoutError";
        throw err;
      }
      if (url.includes("/media")) {
        return json({ data: [{ id: "media-1", permalink: POST_URL, timestamp: "2026-08-01T10:00:00+0000" }] });
      }
      return json({});
    }) as unknown as typeof fetch;

    await expect(fetchInstagramMetricsGraph(POST_URL, "tok")).rejects.toThrow();
    expect(asked).toEqual(["views,reach,shares,saved"]);
  });

  it("leaves shares and saves absent when the payload omits them, never 0", async () => {
    /* The state of every post read with a token that has no insights scope on
       that media: the call succeeds and simply carries fewer rows. */
    mockGraph(answersWith([{ name: "views", values: [{ value: 900 }] }]));

    const out = await fetchInstagramMetricsGraph(POST_URL, "tok");

    expect(out?.sharesCount).toBeUndefined();
    expect(out?.savesCount).toBeUndefined();
    expect(out).not.toHaveProperty("sharesCount", 0);
    expect(out).not.toHaveProperty("savesCount", 0);
  });

  it("carries a genuine zero through", async () => {
    // A reel that was shared by nobody reported zero, and that is a fact worth
    // printing -- the distinction this whole file exists for.
    mockGraph(
      answersWith([
        { name: "views", values: [{ value: 900 }] },
        { name: "shares", values: [{ value: 0 }] },
        { name: "saved", values: [{ value: 0 }] },
      ]),
    );

    const out = await fetchInstagramMetricsGraph(POST_URL, "tok");

    expect(out?.sharesCount).toBe(0);
    expect(out?.savesCount).toBe(0);
  });
});

describe("what the writer does with them", () => {
  it("marks shares and saves measured so the UI stops guessing", async () => {
    mockGraph(
      answersWith([
        { name: "views", values: [{ value: 900 }] },
        { name: "shares", values: [{ value: 0 }] },
        { name: "saved", values: [{ value: 58 }] },
      ]),
    );

    const out = await fetchInstagramMetricsGraph(POST_URL, "tok");
    const { counts, present } = countsFrom({
      platform: "INSTAGRAM",
      platformPostId: "media-1",
      thumbnailUrl: null,
      caption: null,
      ...out,
    });

    expect(counts.sharesCount).toBe(0);
    expect(counts.savesCount).toBe(58);
    expect(present).toEqual(expect.arrayContaining(["views", "shares", "saves"]));
  });
});
