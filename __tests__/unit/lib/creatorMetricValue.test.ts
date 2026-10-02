/**
 * @jest-environment node
 *
 * Plan §13 A1: "unknown" is never shown as 0. Creator.followersCount and
 * averageViews are Float @default(0), so a creator nobody has read and a
 * creator with no audience store the same number; lib/creators/metricValue is
 * where every screen and export tells them apart, and says why.
 */
import {
  avgViewsValue,
  compareMetricDesc,
  creatorEngagementValue,
  followersValue,
  isUnknownMetric,
  knownMetric,
  metricExportCell,
  metricReason,
  metricText,
  postCounterValue,
  postEngagementValue,
  unknownMetric,
  unknownNotes,
  type MetricValue,
} from "@/lib/creators/metricValue";
import { readFailureText, rosterAvgViews, rosterFollowers, linkFollowers } from "@/lib/creators/rosterMetrics";

const reasonOf = (v: MetricValue) => (isUnknownMetric(v) ? v.reason : null);

describe("followersValue", () => {
  it("passes a measured count through", () => {
    expect(followersValue(150_000)).toBe(150_000);
  });

  it("never returns 0: a stored zero is unknown", () => {
    const v = followersValue(0, { attemptedAt: null });
    expect(isUnknownMetric(v)).toBe(true);
    expect(reasonOf(v)).toBe("Not read from the platform yet. The 0 on file is a placeholder, not a follower count.");
  });

  it("treats null, negative and non-finite as unknown too", () => {
    for (const bad of [null, undefined, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isUnknownMetric(followersValue(bad))).toBe(true);
    }
  });

  it("leads with a worded failure, the one thing an operator can act on", () => {
    const v = followersValue(0, { readError: "Instagram only shares figures for Business accounts.", attemptedAt: "2026-10-01T00:00:00Z" });
    expect(reasonOf(v)).toBe("Instagram only shares figures for Business accounts.");
  });

  it("says the last read failed when only the stored error is to hand", () => {
    expect(reasonOf(followersValue(0, { lastError: "unreadable: login wall" }))).toMatch(/last read of this account failed/);
  });

  it("names a reading that came back without the count", () => {
    expect(reasonOf(followersValue(0, { readings: 3 }))).toBe("The last reading did not include a follower count.");
  });

  it("dates a read that returned nothing", () => {
    expect(reasonOf(followersValue(0, { attemptedAt: "2026-09-30T10:00:00Z" }))).toBe(
      "The last read (30 Sept 2026) did not return a follower count.",
    );
  });

  it("does not claim 'never read' for a screen that holds no read history", () => {
    expect(reasonOf(followersValue(0))).toBe("No follower count on record yet.");
  });
});

describe("avgViewsValue", () => {
  it("passes a measured mean through", () => {
    expect(avgViewsValue(225_000)).toBe(225_000);
  });

  it("speaks about the tracked posts when there are some", () => {
    expect(reasonOf(avgViewsValue(null, { trackedPosts: 12 }))).toMatch(/^None of their 12 tracked posts has a view count yet/);
    expect(reasonOf(avgViewsValue(null, { trackedPosts: 1 }))).toMatch(/^Their one tracked post has no view count yet/);
  });

  it("falls back to the read when there are no tracked posts", () => {
    expect(reasonOf(avgViewsValue(null, { trackedPosts: 0 }))).toMatch(/^No tracked posts with views/);
    expect(reasonOf(avgViewsValue(0, { trackedPosts: 0, readError: "We could not find this handle." }))).toBe(
      "We could not find this handle.",
    );
  });
});

describe("engagement", () => {
  const read = "2026-09-01T00:00:00Z";
  // 30 + 5 + 3 + 2 = 40 engagements over 1,000 views = 4%.
  const measured = { viewsCount: 1000, likesCount: 30, commentsCount: 5, sharesCount: 3, savesCount: 2, lastSyncedAt: read };
  const unread = { viewsCount: 0, likesCount: 0, commentsCount: 0, lastSyncedAt: null };

  it("rates a post from its counters, the campaign rate's four terms", () => {
    expect(postEngagementValue(measured)).toBeCloseTo(4, 10);
  });

  it("never prints the stored column, which holds CreatorCore's fraction on imported rows", () => {
    // An imported 10% post stores 0.1 there; the counters say 10%.
    const imported = { engagementRate: 0.1, viewsCount: 2000, likesCount: 180, commentsCount: 20, lastSyncedAt: read };
    expect(postEngagementValue(imported)).toBeCloseTo(10, 10);
  });

  it("weights a creator's rate by views across measured posts -- unread zeroes do not dilute it", () => {
    const big = { viewsCount: 9000, likesCount: 540, lastSyncedAt: read }; // 6%
    // (40 + 540) / (1,000 + 9,000) = 5.8%, the campaign tile's ratio of totals.
    expect(creatorEngagementValue([measured, big, unread, unread])).toBeCloseTo(5.8, 10);
  });

  it("is unknown, not 0.0%, when no post was read", () => {
    const v = creatorEngagementValue([unread, unread]);
    expect(isUnknownMetric(v)).toBe(true);
    expect(reasonOf(v)).toBe("None of their 2 posts has had its views and likes read yet.");
    expect(reasonOf(creatorEngagementValue([]))).toBe("No posts are tracked for this creator yet.");
  });

  it("keeps a measured zero on a read post", () => {
    expect(postEngagementValue({ viewsCount: 500, likesCount: 0, commentsCount: 0, lastSyncedAt: read })).toBe(0);
    expect(isUnknownMetric(postEngagementValue(unread))).toBe(true);
  });

  it("has no rate when the read did not measure views or likes", () => {
    // A partial read: likes measured, views not -- not a 0% post.
    const noViews = { viewsCount: 0, likesCount: 12, lastSyncedAt: read, platformMetrics: { __measured: ["likes", "comments"] } };
    expect(isUnknownMetric(postEngagementValue(noViews))).toBe(true);
    // Likes hidden by the creator: comments alone would understate the rate.
    const hiddenLikes = { viewsCount: 800, likesCount: 0, commentsCount: 9, lastSyncedAt: read, platformMetrics: { __measured: ["views", "comments"] } };
    expect(isUnknownMetric(postEngagementValue(hiddenLikes))).toBe(true);
  });

  it("reads a post's counters by lib/metricDisplay's per-field rule", () => {
    expect(postCounterValue(12, { lastSyncedAt: null }, "likes")).toBe(12);
    expect(reasonOf(postCounterValue(0, { lastSyncedAt: null }, "likes"))).toMatch(/not been read/);
    expect(postCounterValue(0, { lastSyncedAt: "2026-09-01T00:00:00Z" }, "likes")).toBe(0);
    expect(
      reasonOf(postCounterValue(0, { lastSyncedAt: "2026-09-01T00:00:00Z", platformMetrics: { __measured: ["views"] } }, "shares")),
    ).toBe("The platform did not report shares for this post.");
  });
});

describe("rendering", () => {
  const unknown = unknownMetric("Not read from the platform yet.");

  it("prints a dash for unknown and the formatted number otherwise", () => {
    expect(metricText(unknown)).toBe("—");
    expect(metricText(1234567)).toBe("1,234,567");
    expect(metricText(4.25, (n) => `${n.toFixed(1)}%`)).toBe("4.3%");
    expect(metricReason(unknown)).toBe("Not read from the platform yet.");
    expect(metricReason(10)).toBeUndefined();
  });

  it("exports a dash, never an empty cell or 0", () => {
    expect(metricExportCell(unknown)).toBe("—");
    expect(metricExportCell(150_000)).toBe(150_000);
    expect(metricExportCell(followersValue(0))).toBe("—");
  });

  it("writes one note per reason", () => {
    expect(
      unknownNotes([
        ["TikTok followers", unknown],
        ["Followers (primary)", unknown],
        ["Avg views", unknownMetric("No tracked posts with views.")],
        ["Instagram followers", 8000],
      ]),
    ).toBe("TikTok followers, Followers (primary): Not read from the platform yet. Avg views: No tracked posts with views.");
    expect(unknownNotes([["Followers", 5]])).toBe("");
  });

  it("sorts unknowns last whichever side they are on", () => {
    const values: MetricValue[] = [unknown, 5, 900, unknownMetric("x"), 40];
    expect([...values].sort(compareMetricDesc).map(knownMetric)).toEqual([900, 40, 5, null, null]);
  });
});

describe("the roster's figures", () => {
  it("words a stored failure with the reader's own copy", () => {
    expect(readFailureText("no-such-account: statusCode 10221")).toMatch(/could not find this handle/);
    expect(readFailureText("not-a-professional-account\nlooked at 3 posts")).toMatch(/Business and Creator accounts/);
    expect(readFailureText("something-new")).toBe("The last read of this account failed.");
    expect(readFailureText(null)).toBeNull();
  });

  it("explains a missing count from the primary account's read first", () => {
    const v = rosterFollowers({
      followersCount: 0,
      trackerLastError: null,
      trackerLastAttemptAt: null,
      primaryLink: { refreshedAt: "2026-10-01T00:00:00Z", refreshError: "no-such-account" },
    });
    expect(reasonOf(v)).toMatch(/could not find this handle/);
  });

  it("calls a never-read creator never read", () => {
    expect(reasonOf(rosterFollowers({ followersCount: 0, trackerLastAttemptAt: null, primaryLink: null }))).toMatch(
      /^Not read from the platform yet/,
    );
  });

  it("keeps a count it has", () => {
    expect(rosterFollowers({ followersCount: 50_000 })).toBe(50_000);
    expect(rosterAvgViews(1200, 3, {})).toBe(1200);
    expect(linkFollowers({ followersCount: 8000, refreshedAt: null })).toBe(8000);
  });
});
