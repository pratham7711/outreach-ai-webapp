/**
 * @jest-environment node
 *
 * Account totals, followers by day, follower demographics and live story
 * insights, read with the creator's own token (instagram_manage_insights).
 * Graph is faked at fetch, so the real graphGet error handling runs: a 400
 * means "this metric is not supported", a 190 means the grant is gone.
 */
import {
  ACCOUNT_TOTAL_METRICS,
  breakdownRows,
  metricValue,
  readInstagramInsightsBundle,
} from "@/lib/platforms/instagramAccountInsights";
import { InstagramAuthError } from "@/lib/platforms/instagram";

type Answer = { status?: number; body: unknown };
type Route = (path: string, q: URLSearchParams) => Answer | undefined;

const realFetch = global.fetch;
let calls: Array<{ path: string; q: URLSearchParams }> = [];

function fakeGraph(route: Route) {
  calls = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
    calls.push({ path, q: url.searchParams });
    const answer = route(path, url.searchParams) ?? { status: 400, body: { error: { code: 100, message: "Invalid parameter" } } };
    const status = answer.status ?? 200;
    return { ok: status < 400, status, headers: new Headers(), json: async () => answer.body } as unknown as Response;
  }) as typeof fetch;
}

afterEach(() => {
  global.fetch = realFetch;
});

const total = (name: string, value: number) => ({ name, period: "day", total_value: { value } });
const breakdown = (name: string, results: Array<[string, number]>) => ({
  name,
  total_value: { breakdowns: [{ dimension_keys: ["x"], results: results.map(([k, v]) => ({ dimension_values: [k], value: v })) }] },
});

const NOW = new Date("2026-10-24T12:00:00Z");

describe("metricValue and breakdownRows", () => {
  it("reads total_value on account metrics and values[0] on story metrics", () => {
    expect(metricValue([total("reach", 42)], "reach")).toBe(42);
    expect(metricValue([{ name: "reach", values: [{ value: 7 }] }], "reach")).toBe(7);
    expect(metricValue([{ name: "reach" }], "reach")).toBeUndefined();
    expect(metricValue([], "reach")).toBeUndefined();
  });

  it("lists a breakdown largest first and drops rows without a number", () => {
    const rows = [breakdown("follower_demographics", [["IN", 5], ["US", 9], ["", 3]])];
    expect(breakdownRows(rows, "follower_demographics")).toEqual([
      { key: "US", value: 9 },
      { key: "IN", value: 5 },
    ]);
  });
});

describe("readInstagramInsightsBundle", () => {
  it("reads every group in one call each when Instagram accepts it", async () => {
    fakeGraph((path, q) => {
      if (path === "ig-1/insights" && q.get("metric_type") === "total_value" && q.get("period") === "day")
        return { body: { data: ACCOUNT_TOTAL_METRICS.map((m, i) => total(m, i + 1)) } };
      if (path === "ig-1/insights" && q.get("metric") === "follower_count")
        return {
          body: {
            data: [{ name: "follower_count", values: [{ value: 120, end_time: "2026-10-22T07:00:00+0000" }, { value: 125, end_time: "2026-10-23T07:00:00+0000" }] }],
          },
        };
      /* Meta's reference: timeframe is "Required for demographics-related metrics". */
      if (path === "ig-1/insights" && q.get("metric") === "follower_demographics" && q.get("timeframe") === "this_month")
        return { body: { data: [breakdown("follower_demographics", q.get("breakdown") === "gender" ? [["F", 60], ["M", 40]] : [["IN", 70], ["AE", 30]])] } };
      if (path === "ig-1/stories")
        return { body: { data: [{ id: "st-1", media_type: "IMAGE", media_url: "https://cdn/x.jpg", permalink: "https://instagram.com/stories/a/1", timestamp: "2026-10-24T09:00:00+0000" }] } };
      if (path === "st-1/insights" && q.get("metric") === "navigation")
        return { body: { data: [breakdown("navigation", [["TAP_FORWARD", 4], ["tap_exit", 2], ["unknown_action", 1]])] } };
      if (path === "st-1/insights") return { body: { data: [{ name: "reach", values: [{ value: 11 }] }, { name: "replies", values: [{ value: 1 }] }] } };
      return undefined;
    });

    const bundle = await readInstagramInsightsBundle("user-token", "ig-1", { now: NOW });

    expect(bundle.account.totals.reach).toBe(1);
    expect(Object.keys(bundle.account.totals)).toHaveLength(ACCOUNT_TOTAL_METRICS.length);
    expect(bundle.account.days).toBe(28);
    expect(bundle.account.followerSeries).toEqual([
      { day: "2026-10-22", value: 120 },
      { day: "2026-10-23", value: 125 },
    ]);
    expect(bundle.account.demographics.gender).toEqual([
      { key: "F", value: 60 },
      { key: "M", value: 40 },
    ]);
    expect(bundle.account.demographics.country[0]).toEqual({ key: "IN", value: 70 });
    expect(bundle.stories).toEqual([
      {
        id: "st-1",
        mediaType: "IMAGE",
        thumbnailUrl: "https://cdn/x.jpg",
        permalink: "https://instagram.com/stories/a/1",
        postedAt: "2026-10-24T09:00:00+0000",
        metrics: { reach: 11, replies: 1 },
        navigation: { tap_forward: 4, tap_exit: 2 },
      },
    ]);

    const totalsCall = calls.find((c) => c.q.get("metric_type") === "total_value" && c.q.get("period") === "day")!;
    const since = Number(totalsCall.q.get("since"));
    const until = Number(totalsCall.q.get("until"));
    expect(until - since).toBe(28 * 24 * 60 * 60);
    expect(totalsCall.q.get("access_token")).toBe("user-token");
  });

  it("asks one metric at a time when Instagram refuses the group, and leaves a refused metric out rather than 0", async () => {
    fakeGraph((path, q) => {
      const metric = q.get("metric") ?? "";
      if (path === "ig-1/insights" && q.get("metric_type") === "total_value" && q.get("period") === "day")
        return metric.includes(",") || metric === "follows_and_unfollows" ? undefined : { body: { data: [total(metric, 3)] } };
      if (path === "ig-1/stories") return { body: { data: [] } };
      return undefined;
    });

    const bundle = await readInstagramInsightsBundle("t", "ig-1", { now: NOW });

    expect(bundle.account.totals.reach).toBe(3);
    expect(bundle.account.totals.follows_and_unfollows).toBeUndefined();
    expect("follows_and_unfollows" in bundle.account.totals).toBe(false);
    expect(bundle.account.followerSeries).toBeNull();
    expect(bundle.account.demographics).toEqual({ country: [], age: [], gender: [] });
    expect(bundle.stories).toEqual([]);
  });

  it("says the stories edge failed (null), which is not the same as no live story ([])", async () => {
    fakeGraph(() => undefined);
    const bundle = await readInstagramInsightsBundle("t", "ig-1", { now: NOW });
    expect(bundle.stories).toBeNull();
  });

  it("throws when Instagram rejects the token, so the caller can ask for a reconnect", async () => {
    fakeGraph(() => ({ status: 400, body: { error: { code: 190, message: "Error validating access token" } } }));
    await expect(readInstagramInsightsBundle("dead", "ig-1", { now: NOW })).rejects.toBeInstanceOf(InstagramAuthError);
  });
});
