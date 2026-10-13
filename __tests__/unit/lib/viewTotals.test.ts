/**
 * @jest-environment node
 *
 * A views total over posts: only the views a post has, how many posts that
 * covers, and the newest reading behind it. The song screens summed viewsCount
 * off the rows, so a song none of whose posts was read said "0 views".
 */
import { viewTotals } from "@/lib/posts/viewTotals";
import { MEASURED_FIELDS_KEY } from "@/lib/metricDisplay";

const READ = new Date("2026-10-12T06:00:00Z");
const LATER = new Date("2026-10-13T07:50:00Z");

describe("viewTotals", () => {
  it("is null, not 0, when no post has a view count", () => {
    const t = viewTotals([
      { viewsCount: 0, lastSyncedAt: null },
      { viewsCount: 0, lastSyncedAt: READ, platformMetrics: { [MEASURED_FIELDS_KEY]: ["likes"] } },
    ]);
    expect(t).toEqual({ views: null, viewsKnown: 0, posts: 2, asOf: READ.toISOString() });
  });

  it("sums only the known views and counts the posts it covers", () => {
    const t = viewTotals([
      { viewsCount: 1_000, lastSyncedAt: READ },
      { viewsCount: 0, lastSyncedAt: null },
      { viewsCount: 250, lastSyncedAt: null, lastFreshAt: LATER },
    ]);
    expect(t.views).toBe(1_250);
    expect(t.viewsKnown).toBe(2);
    expect(t.posts).toBe(3);
  });

  it("keeps a measured zero as a known zero", () => {
    const t = viewTotals([{ viewsCount: 0, lastSyncedAt: READ, platformMetrics: { [MEASURED_FIELDS_KEY]: ["views"] } }]);
    expect(t.views).toBe(0);
    expect(t.viewsKnown).toBe(1);
  });

  it("dates the total by the newest reading, synced or imported", () => {
    expect(viewTotals([{ viewsCount: 5, lastSyncedAt: READ }, { viewsCount: 7, lastFreshAt: LATER }]).asOf).toBe(
      LATER.toISOString(),
    );
    expect(viewTotals([{ viewsCount: 5 }]).asOf).toBeNull();
    expect(viewTotals([])).toEqual({ views: null, viewsKnown: 0, posts: 0, asOf: null });
  });
});
