/**
 * The MCP post shape rates a post only when its likes were read, the rule every
 * screen uses (postEngagementPercent, rollupEngagement).
 */
import { shapePost } from "@/lib/mcp/serialize";

const base = {
  id: "p1",
  platform: "INSTAGRAM",
  postUrl: "https://example.test/p/1",
  postedAt: "2026-10-01T00:00:00.000Z",
  viewsCount: 2_000,
  likesCount: 0,
  commentsCount: 1,
  sharesCount: 0,
  savesCount: 0,
  lastSyncedAt: "2026-10-02T00:00:00.000Z",
};

describe("shapePost engagement rate", () => {
  it("has no rate for a post whose like count was hidden", () => {
    const shaped = shapePost({ ...base, platformMetrics: { __measured: ["views", "comments"] } });
    const metrics = shaped.metrics as Record<string, number | null>;
    expect(metrics.likes).toBeNull();
    expect(metrics.engagementRatePercent).toBeNull();
  });

  it("rates a post whose likes were read, a measured zero included", () => {
    const shaped = shapePost({ ...base, platformMetrics: { __measured: ["views", "likes", "comments"] } });
    expect((shaped.metrics as Record<string, number | null>).engagementRatePercent).toBe(0.05);
  });
});
