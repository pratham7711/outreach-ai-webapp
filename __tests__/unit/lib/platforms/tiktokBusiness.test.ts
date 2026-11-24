/**
 * @jest-environment node
 */
import {
  deleteAdAuthorization,
  enableAdAuthorization,
  extendAdAuthorization,
  fetchAdAuthorization,
  fetchTikTokBusinessComments,
  fetchTikTokBusinessPosts,
  fetchTikTokBusinessProfile,
  fetchTikTokBusinessReplies,
  normaliseShares,
  parseRetention,
  parseAdAuthorization,
  parseProfile,
  tiktokBusinessMocked,
} from "@/lib/platforms/tiktokBusiness";

describe("normaliseShares", () => {
  it("reads 0-100 percentages as 0-1 and sorts largest first", () => {
    expect(normaliseShares([{ gender: "male", percentage: 40 }, { gender: "female", percentage: 60 }], "gender")).toEqual([
      { key: "female", share: 0.6 },
      { key: "male", share: 0.4 },
    ]);
  });
  it("keeps 0-1 percentages and drops rows with no key or value", () => {
    expect(normaliseShares([{ country: "IN", percentage: 0.7 }, { country: "", percentage: 0.1 }, { country: "US" }], "country")).toEqual([
      { key: "IN", share: 0.7 },
    ]);
  });
  it("is empty for anything that is not a list", () => {
    expect(normaliseShares(null, "age")).toEqual([]);
  });
});

describe("parseRetention", () => {
  it("keeps each point as its own share instead of dividing the curve by its sum", () => {
    const rows = [0, 5, 10, 15, 20].map((second) => ({ second: String(second), percentage: [1, 0.8, 0.6, 0.45, 0.3][second / 5] }));
    expect(parseRetention(rows).map((r) => r.share)).toEqual([1, 0.8, 0.6, 0.45, 0.3]);
  });
  it("reads a 0-100 curve as percentages and orders it by second", () => {
    expect(parseRetention([{ second: "10", percentage: 50 }, { second: "0", percentage: 100 }, { second: "x", percentage: 20 }])).toEqual([
      { second: 0, share: 1 },
      { second: 10, share: 0.5 },
    ]);
  });
});

describe("parseProfile", () => {
  it("names the account type from TikTok's two flags", () => {
    expect(parseProfile({ is_business_account: true, has_advanced_access: true }).accountType).toBe("business");
    expect(parseProfile({ is_business_account: false, has_advanced_access: true }).accountType).toBe("advanced");
    expect(parseProfile({}).accountType).toBe("personal");
  });
  it("keeps only dated daily rows, oldest first, and a missing figure stays null", () => {
    const p = parseProfile({
      metrics: [
        { date: "2026-11-02", video_views: 5 },
        { date: "bad", video_views: 9 },
        { date: "2026-11-01", video_views: 3, daily_new_followers: 2 },
      ],
    });
    expect(p.daily.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(p.daily[1].newFollowers).toBeNull();
  });
});

describe("parseAdAuthorization", () => {
  it("is off without a code", () => {
    expect(parseAdAuthorization(null)).toEqual({ enabled: false });
    expect(parseAdAuthorization({ auth_code_status: "NOT_USED" })).toEqual({ enabled: false });
  });
  it("reads TikTok's UTC times as ISO and an unknown status as UNKNOWN", () => {
    const a = parseAdAuthorization({ auth_code: "#abc", auth_code_start_time: "2026-11-24 10:00:00", auth_code_end_time: "nope", auth_code_status: "WEIRD" });
    expect(a).toMatchObject({ enabled: true, code: "#abc", startsAt: "2026-11-24T10:00:00Z", endsAt: null, status: "UNKNOWN" });
  });
});

describe("mock mode", () => {
  const saved = { mock: process.env.TIKTOK_BUSINESS_MOCK, env: process.env.VERCEL_ENV };
  beforeEach(() => {
    process.env.TIKTOK_BUSINESS_MOCK = "1";
    delete process.env.VERCEL_ENV;
  });
  afterAll(() => {
    if (saved.mock === undefined) delete process.env.TIKTOK_BUSINESS_MOCK;
    else process.env.TIKTOK_BUSINESS_MOCK = saved.mock;
    if (saved.env === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved.env;
  });

  it("refuses to run in production", () => {
    process.env.VERCEL_ENV = "production";
    expect(tiktokBusinessMocked()).toBe(false);
  });

  it("returns one row per day of the window, with demographics", async () => {
    const p = await fetchTikTokBusinessProfile("t", "b", 7, new Date("2026-11-24T12:00:00Z"));
    expect(p.daily).toHaveLength(7);
    expect(p.daily[6].date).toBe("2026-11-23");
    const total = p.audience.genders.reduce((s, g) => s + g.share, 0);
    expect(total).toBeCloseTo(1, 1);
  });

  it("lists posts with insights, comments and replies", async () => {
    const posts = await fetchTikTokBusinessPosts("t", "b");
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0].retention.length).toBeGreaterThan(1);
    const comments = await fetchTikTokBusinessComments("t", "b", posts[0].id);
    expect(comments.length).toBeGreaterThan(0);
    const replies = await fetchTikTokBusinessReplies("t", "b", posts[0].id, comments[0].id);
    expect(replies.length).toBeGreaterThan(0);
  });

  it("turns an ad code on, extends it and deletes it", async () => {
    const item = "7440000000000000006";
    expect(await fetchAdAuthorization("t", "b", item)).toEqual({ enabled: false });
    const on = await enableAdAuthorization("t", "b", item, 30);
    expect(on).toMatchObject({ enabled: true, status: "NOT_USED", days: 30 });
    const longer = await extendAdAuthorization("t", "b", item, 60);
    expect(longer.enabled && on.enabled && Date.parse(longer.endsAt!) > Date.parse(on.endsAt!)).toBe(true);
    await deleteAdAuthorization("t", "b", item);
    expect(await fetchAdAuthorization("t", "b", item)).toEqual({ enabled: false });
  });
});
