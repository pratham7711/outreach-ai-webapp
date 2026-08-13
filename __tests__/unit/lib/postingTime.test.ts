import {
  formatSlot,
  localSlot,
  medianOf,
  postingTimeReport,
  type TimedPost,
} from "@/lib/analytics/postingTime";

function post(iso: string, viewsCount: number, platform = "TIKTOK"): TimedPost {
  return { postedAt: iso, platform, viewsCount };
}

describe("medianOf", () => {
  it("is 0 for nothing", () => {
    expect(medianOf([])).toBe(0);
  });

  it("averages the middle pair on even counts", () => {
    expect(medianOf([10, 20, 30, 40])).toBe(25);
  });

  it("ignores a viral outlier that would wreck a mean", () => {
    // mean is 250_075; the typical post in this slot is 100.
    expect(medianOf([50, 100, 150, 1_000_000])).toBe(125);
  });
});

describe("localSlot", () => {
  it("buckets in the requested zone, not UTC", () => {
    // 2026-08-13T20:00Z is Thu 01:30 in Kolkata (+5:30).
    const d = new Date("2026-08-13T20:00:00.000Z");
    expect(localSlot(d, "UTC")).toEqual({ day: 4, hour: 20 });
    expect(localSlot(d, "Asia/Kolkata")).toEqual({ day: 5, hour: 1 });
  });

  it("reports midnight as hour 0, never 24", () => {
    expect(localSlot(new Date("2026-08-13T00:00:00.000Z"), "UTC")).toEqual({ day: 4, hour: 0 });
  });

  it("returns null on an unparseable date", () => {
    expect(localSlot(new Date("nonsense"), "UTC")).toBeNull();
  });
});

describe("postingTimeReport", () => {
  it("always covers the full week", () => {
    const r = postingTimeReport([], { timeZone: "UTC" });
    expect(r.buckets).toHaveLength(168);
    expect(r.totalPosts).toBe(0);
  });

  it("recommends nothing when every slot is below the sample floor", () => {
    // Three posts, three different hours — no slot has enough to be evidence.
    const r = postingTimeReport(
      [
        post("2026-08-13T10:00:00.000Z", 900),
        post("2026-08-13T11:00:00.000Z", 800),
        post("2026-08-13T12:00:00.000Z", 700),
      ],
      { timeZone: "UTC", minSample: 3 },
    );
    expect(r.totalPosts).toBe(3);
    expect(r.best).toEqual([]);
    expect(r.scaleMax).toBe(0);
  });

  it("ranks qualifying slots by median views", () => {
    const posts = [
      // Thu 10:00 — three posts, median 100
      post("2026-08-06T10:00:00.000Z", 50),
      post("2026-08-13T10:00:00.000Z", 100),
      post("2026-08-20T10:00:00.000Z", 400),
      // Thu 19:00 — three posts, median 900
      post("2026-08-06T19:00:00.000Z", 800),
      post("2026-08-13T19:00:00.000Z", 900),
      post("2026-08-20T19:00:00.000Z", 950),
    ];
    const r = postingTimeReport(posts, { timeZone: "UTC", minSample: 3 });
    expect(r.best).toHaveLength(2);
    expect(formatSlot(r.best[0])).toBe("Thu 19:00");
    expect(r.best[0].medianViews).toBe(900);
    expect(r.scaleMax).toBe(900);
  });

  it("keeps thin slots visible on the chart even though it will not recommend them", () => {
    const r = postingTimeReport([post("2026-08-13T10:00:00.000Z", 900)], {
      timeZone: "UTC",
      minSample: 3,
    });
    const thu10 = r.buckets.find((b) => b.day === 4 && b.hour === 10);
    expect(thu10).toMatchObject({ count: 1, medianViews: 900 });
    expect(r.best).toEqual([]);
  });

  it("separates platforms", () => {
    const posts = [
      post("2026-08-06T10:00:00.000Z", 10, "TIKTOK"),
      post("2026-08-13T10:00:00.000Z", 10, "TIKTOK"),
      post("2026-08-06T15:00:00.000Z", 500, "INSTAGRAM"),
      post("2026-08-13T15:00:00.000Z", 500, "INSTAGRAM"),
    ];
    expect(postingTimeReport(posts, { timeZone: "UTC", minSample: 2, platform: "INSTAGRAM" }))
      .toMatchObject({ totalPosts: 2, scaleMax: 500 });
    expect(postingTimeReport(posts, { timeZone: "UTC", minSample: 2, platform: "ALL" }).totalPosts)
      .toBe(4);
  });

  it("skips unusable rows instead of counting them as zero-view posts", () => {
    const r = postingTimeReport(
      [post("not-a-date", 500), { postedAt: "2026-08-13T10:00:00.000Z", platform: "TIKTOK", viewsCount: NaN }],
      { timeZone: "UTC" },
    );
    expect(r.totalPosts).toBe(0);
  });
});
