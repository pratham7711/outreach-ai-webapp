/**
 * The trackers page's velocity bars and the songs pages' one-copy-per-video
 * totals -- two aggregations that used to read rows as if every one were a
 * fresh, distinct measurement.
 */
jest.mock("recharts", () => ({}));
jest.mock("@/lib/db", () => ({ db: {} }));

import { velocityBars } from "@/app/(dashboard)/trackers/SoundCharts";
import { oneCopyPerVideo, postVideoKey } from "@/lib/posts/duplicates";

const DAY = 86_400_000;
const START = Date.UTC(2026, 8, 1, 4);
const reading = (day: number, value: number, rounded = false) => ({
  value,
  recordedAt: new Date(START + day * DAY).toISOString(),
  rounded,
});

describe("velocityBars", () => {
  it("is one bar per day between the first and last reading, with nothing invented for a gap", () => {
    const bars = velocityBars([reading(0, 100), reading(1, 130), reading(4, 190)], "daily");
    expect(bars.map((b) => b.delta)).toEqual([30, null, null, null]);
    // The bars sit on a time axis, one per UTC day; an empty day's bar sits at its midnight.
    expect(bars.map((b) => Math.floor(b.t / DAY) - Math.floor(START / DAY))).toEqual([1, 2, 3, 4]);
  });

  it("draws no bar across a rounded figure", () => {
    const bars = velocityBars([reading(0, 73_812), reading(1, 74_000, true), reading(2, 74_013), reading(3, 74_160)], "daily");
    expect(bars.map((b) => b.delta)).toEqual([null, null, 147]);
  });

  it("keeps the last reading of a day", () => {
    const bars = velocityBars(
      [reading(0, 100), { value: 140, recordedAt: new Date(START + DAY + 3_600_000).toISOString() }, reading(1, 120)],
      "daily",
    );
    expect(bars.map((b) => b.delta)).toEqual([40]);
  });

  it("needs two readings", () => {
    expect(velocityBars([reading(0, 100)], "daily")).toEqual([]);
  });

  /* Scale: a year of daily readings stays inside the slot cap
     and costs one bar per day, not a bar per raw row. */
  it("charts a year of daily readings as one bar per day", () => {
    const series = Array.from({ length: 365 }, (_, d) => reading(d, 1_000 + 7 * d));
    const bars = velocityBars(series, "daily");
    expect(bars).toHaveLength(364);
    expect(bars.every((b) => b.delta === 7)).toBe(true);
  });
});

describe("oneCopyPerVideo", () => {
  it("keys a video the same however its link is written", () => {
    expect(postVideoKey("TIKTOK", "https://www.tiktok.com/@a/video/7551234567890?lang=en")).toBe(
      postVideoKey("TIKTOK", "https://vm.tiktok.com/x/../@b/video/7551234567890"),
    );
    expect(postVideoKey("INSTAGRAM", "https://www.instagram.com/reel/AbC_1-2/")).toBe(
      postVideoKey("INSTAGRAM", "https://instagram.com/p/AbC_1-2/?igsh=x"),
    );
    expect(postVideoKey("YOUTUBE", "https://youtu.be/abcdefghijk")).toBe(
      postVideoKey("YOUTUBE", "https://www.youtube.com/shorts/abcdefghijk?feature=share"),
    );
    expect(postVideoKey("TIKTOK", "https://www.tiktok.com/@a/video/1")).not.toBe(
      postVideoKey("TIKTOK", "https://www.tiktok.com/@a/video/2"),
    );
  });

  /* Production's one duplicate on the songs pages: 18 posts, 17 videos -- the
     same video added to two campaigns and summed twice. */
  it("counts a video in two campaigns once, at its freshest read", () => {
    const posts = [
      { id: "a", platform: "TIKTOK", postUrl: "https://www.tiktok.com/@x/video/1", viewsCount: 900 },
      { id: "b", platform: "TIKTOK", postUrl: "https://www.tiktok.com/@x/video/1?is_from_webapp=1", viewsCount: 1_200 },
      { id: "c", platform: "TIKTOK", postUrl: "https://www.tiktok.com/@y/video/2", viewsCount: 50 },
    ];
    const kept = oneCopyPerVideo(posts);
    expect(kept.map((p) => p.id).sort()).toEqual(["b", "c"]);
    expect(kept.reduce((s, p) => s + p.viewsCount, 0)).toBe(1_250);
  });

  it("dedupes hundreds of posts in one pass", () => {
    const posts = Array.from({ length: 900 }, (_, i) => ({
      platform: "TIKTOK",
      postUrl: `https://www.tiktok.com/@c${i % 7}/video/${7_500_000_000 + (i % 300)}`,
      viewsCount: i,
    }));
    const kept = oneCopyPerVideo(posts);
    expect(kept).toHaveLength(300);
    // Each video keeps its highest read: the copy at i + 600.
    expect(Math.min(...kept.map((p) => p.viewsCount))).toBe(600);
  });
});
