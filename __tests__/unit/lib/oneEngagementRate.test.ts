/**
 * @jest-environment node
 *
 * One engagement rate, and shares that a platform never published.
 *
 * The product printed four per-post rates for the same post: a two-term one on
 * the Posts tab card (engagementRateValue), a five-term total on the Posts strip,
 * a likes-or-comments rate on the client report's post rows, and the four-term
 * postEngagementPercent on the post page and exports. Every path now runs
 * through postEngagementPercent; these tests pin that.
 *
 * And YouTube publishes no share count, nor does Instagram outside a connected
 * account's insights -- yet old importer rows list "shares" in __measured, so a
 * stored 0 read as "0 shares". fieldMetricValue's platform argument makes it
 * unknown regardless of __measured, without touching a real connected count.
 */
import {
  engagementRateValue,
  fieldMetricValue,
  MEASURED_FIELDS_KEY,
  postEngagementPercent,
  sharesPublished,
  summarizePostMetrics,
} from "@/lib/metricDisplay";
import { engRatePct } from "@/lib/posts/postDisplay";
import { METRIC_WRITERS_KEY } from "@/lib/metrics/postWriters";

const SYNCED = new Date("2026-08-22T00:00:00Z");
const measured = (fields: string[], extra: Record<string, unknown> = {}) => ({ [MEASURED_FIELDS_KEY]: fields, ...extra });
const connectedShares = { [METRIC_WRITERS_KEY]: { shares: { source: "connected", at: "2026-08-22T00:00:00Z" } } };
const publicShares = { [METRIC_WRITERS_KEY]: { shares: { source: "public", at: "2026-08-22T00:00:00Z" } } };

describe("sharesPublished", () => {
  it("is false for YouTube, whatever the row says", () => {
    expect(sharesPublished("YOUTUBE", measured(["shares"]))).toBe(false);
    expect(sharesPublished("YOUTUBE", connectedShares)).toBe(false);
  });

  it("is true for Instagram only when a connected account wrote the shares", () => {
    expect(sharesPublished("INSTAGRAM", measured(["views", "shares"]))).toBe(false);
    expect(sharesPublished("INSTAGRAM", publicShares)).toBe(false);
    expect(sharesPublished("INSTAGRAM", null)).toBe(false);
    expect(sharesPublished("INSTAGRAM", connectedShares)).toBe(true);
  });

  it("leaves every other platform to the per-field rule", () => {
    expect(sharesPublished("TIKTOK", null)).toBe(true);
    expect(sharesPublished("TWITTER", null)).toBe(true);
  });
});

describe("fieldMetricValue with a platform", () => {
  it("reads a YouTube 0 as unknown even when an importer listed shares as measured", () => {
    expect(fieldMetricValue(0, SYNCED, measured(["views", "likes", "shares"]), "shares", "YOUTUBE")).toBeNull();
  });

  it("reads an Instagram 0 as unknown unless a connected account wrote it", () => {
    expect(fieldMetricValue(0, SYNCED, measured(["shares"]), "shares", "INSTAGRAM")).toBeNull();
    expect(fieldMetricValue(0, SYNCED, connectedShares, "shares", "INSTAGRAM")).toBe(0);
  });

  it("always keeps a positive count -- something did write it", () => {
    expect(fieldMetricValue(12, SYNCED, measured(["views"]), "shares", "YOUTUBE")).toBe(12);
    expect(fieldMetricValue(12, SYNCED, null, "shares", "INSTAGRAM")).toBe(12);
  });

  it("does not change TikTok, or any other field", () => {
    expect(fieldMetricValue(0, SYNCED, measured(["shares"]), "shares", "TIKTOK")).toBe(0);
    expect(fieldMetricValue(0, SYNCED, measured(["likes"]), "likes", "YOUTUBE")).toBe(0);
  });

  it("behaves exactly as before when no platform is passed", () => {
    expect(fieldMetricValue(0, SYNCED, measured(["shares"]), "shares")).toBe(0);
    expect(fieldMetricValue(0, SYNCED, measured(["views"]), "shares")).toBeNull();
  });
});

describe("the one per-post rate", () => {
  const post = {
    viewsCount: 10_000,
    likesCount: 900,
    commentsCount: 60,
    sharesCount: 30,
    savesCount: 15,
    lastSyncedAt: SYNCED,
  };

  it("is (likes + comments + shares + saves) / views, in percent", () => {
    expect(postEngagementPercent(post)).toBeCloseTo(((900 + 60 + 30 + 15) / 10_000) * 100, 10);
  });

  it("engagementRateValue keeps its signature and returns the same number", () => {
    expect(
      engagementRateValue(post.likesCount, post.commentsCount, post.viewsCount, post.lastSyncedAt, {
        shares: post.sharesCount,
        saves: post.savesCount,
      }),
    ).toBeCloseTo(postEngagementPercent(post)!, 10);
  });

  it("the Posts tab's engRatePct is the same number", () => {
    expect(engRatePct(post)).toBe(postEngagementPercent(post));
  });

  it("is null, not 0, when the views or the likes were never read", () => {
    expect(postEngagementPercent({ ...post, viewsCount: 0, lastSyncedAt: null })).toBeNull();
    expect(postEngagementPercent({ ...post, platformMetrics: measured(["views", "comments"]), likesCount: 0 })).toBeNull();
  });
});

describe("summarizePostMetrics and unpublished shares", () => {
  const base = { commentsCount: 5, savesCount: 0, downloadsCount: 0, lastSyncedAt: SYNCED };

  it("totals no shares for a YouTube-only selection, even from importer rows that claimed them", () => {
    const s = summarizePostMetrics([
      { ...base, platform: "YOUTUBE", viewsCount: 1_000, likesCount: 50, sharesCount: 0, platformMetrics: measured(["views", "likes", "comments", "shares"]) },
    ]);
    expect(s.shares).toBeNull();
  });

  it("still totals a connected Instagram account's real shares", () => {
    const s = summarizePostMetrics([
      { ...base, platform: "INSTAGRAM", viewsCount: 1_000, likesCount: 50, sharesCount: 0, platformMetrics: connectedShares },
      { ...base, platform: "INSTAGRAM", viewsCount: 1_000, likesCount: 50, sharesCount: 7, platformMetrics: connectedShares },
    ]);
    expect(s.shares).toBe(7);
  });
});
