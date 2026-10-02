/**
 * @jest-environment node
 *
 * The Trackers page ranks every creator on five anchor readings and computes
 * the page's rows on the window plus those anchors (lib/trackers/creatorPage).
 * Both are only right if the anchors are the readings the full computation
 * would have picked. This checks that claim against the full computation on
 * generated histories, rather than on the handful a reader thinks of.
 */
jest.mock("@/lib/db", () => ({ db: { $queryRawUnsafe: jest.fn() } }));

import {
  figuresFor,
  mergeReadings,
  parsePaging,
  parseSearch,
  type Reading,
} from "@/lib/trackers/creatorPage";
import { LATEST_TEN_SINCE } from "@/lib/trackers/recentViews";
import { windowBounds } from "@/lib/trackers/creatorMetrics";
import type { TrackerWindow } from "@/lib/trackers/metrics";
import {
  BULK_TRACK_UNGATED_MAX,
  bulkTrackSummary,
  TRACK_ALL_CLOSED,
  trackAllGate,
} from "@/lib/trackers/trackAll";
import type { ResolvedTrackerPlan } from "@/lib/trackers/sourceSwitch";

const HOUR = 3600_000;

/** Small deterministic generator, so a failure names a reproducible seed. */
function rng(seed: number) {
  // Scrambled first: an LCG's first output barely moves between neighbouring
  // seeds, which made every history start at the same age.
  let s = Math.imul(seed ^ 0x5bd1e995, 0x9e3779b1) >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  for (let i = 0; i < 4; i++) next();
  return next;
}

/** A creator's whole history, newest first: gaps, unmeasured readings, outages. */
function history(seed: number, now: Date): Reading[] {
  const r = rng(seed);
  const out: Reading[] = [];
  let t = now.getTime() - r() * 60 * HOUR; // last read up to 60 hours ago
  const n = Math.floor(r() * 40);
  let followers = 1000 + Math.floor(r() * 100_000);
  for (let i = 0; i < n; i++) {
    out.push({
      recordedAt: new Date(t),
      followersCount: followers,
      // Most readings between daily post reads carry 0 views.
      avgViews: r() < 0.4 ? Math.floor(r() * 80_000) + 1 : 0,
    });
    followers -= Math.floor(r() * 500) - 100;
    t -= (r() < 0.1 ? 120 : 12) * HOUR * (0.5 + r());
  }
  return out;
}

/** The five LATERAL probes of readAnchorReadings, written over an array. */
function anchorsOf(all: Reading[], windowStart: Date): Reading[] {
  const viewsFrom = windowStart > LATEST_TEN_SINCE ? windowStart : LATEST_TEN_SINCE;
  const measured = all.filter((s) => s.avgViews > 0);
  const firstInWindow = [...measured].reverse().find((s) => s.recordedAt >= viewsFrom);
  return mergeReadings([all[0], all[1], measured[0], measured[1], firstInWindow].filter(Boolean) as Reading[]);
}

describe("anchorsCoverTheSortKeys", () => {
  const NOW = new Date(LATEST_TEN_SINCE.getTime() + 20 * 24 * HOUR);
  const windows: TrackerWindow[] = ["7d", "14d", "30d"];

  it.each(windows)("ranks the way the full history would, over %s", (period) => {
    const start = windowBounds(period, NOW).current;
    let changes = 0;
    let stale = 0;
    let fallbacks = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const all = history(seed, NOW);
      const full = figuresFor(all, null, period, NOW);
      const anchored = figuresFor(anchorsOf(all, start), null, period, NOW);
      if (full.views.changePercent !== null) changes++;
      if (full.health === "regressed") stale++;
      const inWindow = all.filter((x) => x.avgViews > 0 && x.recordedAt >= start && x.recordedAt >= LATEST_TEN_SINCE);
      if (full.views.changePercent !== null && inWindow.length < 2) fallbacks++;
      const keys = (f: typeof full) => ({
        followers: f.followersCount,
        views: f.views.avgViews,
        change: f.views.changePercent,
        health: f.health,
        lastReadAt: f.lastReadAt?.getTime() ?? null,
      });
      expect({ seed, ...keys(anchored) }).toEqual({ seed, ...keys(full) });
    }
    // Not vacuous: the histories reach the cases the claim is about.
    expect(changes).toBeGreaterThan(50);
    expect(stale).toBeGreaterThan(50);
    // ...including a baseline from before the window, changeOverWindow's
    // fallback. Not over 30d here: that window opens before LATEST_TEN_SINCE,
    // so every comparable reading is inside it.
    if (period !== "30d") expect(fallbacks).toBeGreaterThan(0);
  });

  it.each(windows)("computes the page's row the way the full history would, over %s", (period) => {
    const start = windowBounds(period, NOW).current;
    let followerChanges = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const all = history(seed, NOW);
      // What the page reads: the window from the table, the anchors from the probes.
      const page = mergeReadings(
        all.filter((s) => s.recordedAt >= start),
        anchorsOf(all, start)
      );
      const full = figuresFor(all, null, period, NOW);
      const paged = figuresFor(page, null, period, NOW);
      if (full.followersChangePercent !== null) followerChanges++;
      expect({ seed, ...paged, followerHistory: null }).toEqual({ seed, ...full, followerHistory: null });
    }
    expect(followerChanges).toBeGreaterThan(50);
  });
});

describe("mergeReadings", () => {
  it("keeps one reading per instant, newest first", () => {
    const a = { recordedAt: new Date("2026-10-05T00:00:00Z"), followersCount: 1, avgViews: 0 };
    const b = { recordedAt: new Date("2026-10-06T00:00:00Z"), followersCount: 2, avgViews: 5 };
    expect(mergeReadings([a, b], [{ ...b }], [])).toEqual([b, a]);
  });
});

describe("figuresFor", () => {
  it("falls back to the stored follower count only when nothing was ever read", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    expect(figuresFor([], 2_891_236, "7d", now)).toMatchObject({ followersCount: 2_891_236, health: "pending" });
    // The column's 0 default is not an audience of zero.
    expect(figuresFor([], 0, "7d", now).followersCount).toBeNull();
  });
});

describe("paging and search parameters", () => {
  const p = (qs: string) => parsePaging(new URLSearchParams(qs));
  it("defaults, caps and refuses nonsense", () => {
    expect(p("")).toEqual({ page: 1, pageSize: 50 });
    expect(p("page=3&pageSize=20")).toEqual({ page: 3, pageSize: 20 });
    expect(p("pageSize=5000")).toEqual({ page: 1, pageSize: 200 });
    expect(p("page=0&pageSize=0")).toEqual({ page: 1, pageSize: 50 });
    expect(p("page=-2&pageSize=x")).toEqual({ page: 1, pageSize: 50 });
  });
  it("trims a search and bounds its length", () => {
    expect(parseSearch("  fake  ")).toBe("fake");
    expect(parseSearch(null)).toBe("");
    expect(parseSearch("x".repeat(500))).toHaveLength(100);
  });
});

describe("trackAllGate", () => {
  const plan = (over: Partial<ResolvedTrackerPlan>): ResolvedTrackerPlan => ({
    position: "A",
    effective: "A",
    scopeOrgIds: [],
    percent: 100,
    changedAt: null,
    changedBy: null,
    reason: null,
    ...over,
  });

  it("is shut on legacy, including a B that fell back to legacy", () => {
    expect(trackAllGate(plan({ position: "legacy", effective: "legacy" }), "org-1")).toEqual({ open: false, reason: TRACK_ALL_CLOSED });
    expect(trackAllGate(plan({ position: "B", effective: "legacy" }), "org-1").open).toBe(false);
  });

  it("is shut for an agency outside the scope, and below 100%", () => {
    expect(trackAllGate(plan({ scopeOrgIds: ["org-2"] }), "org-1").open).toBe(false);
    expect(trackAllGate(plan({ percent: 99 }), "org-1").open).toBe(false);
  });

  it("is open for every agency when the scope is empty, or for one named in it", () => {
    expect(trackAllGate(plan({}), "org-1")).toEqual({ open: true, reason: null });
    expect(trackAllGate(plan({ position: "B", effective: "B", scopeOrgIds: ["org-1"] }), "org-1").open).toBe(true);
  });

  it("keeps the ungated maximum at the starter plan's allowance", () => {
    expect(BULK_TRACK_UNGATED_MAX).toBe(25);
  });
});

describe("bulkTrackSummary", () => {
  it("reads as the plan words it", () => {
    expect(bulkTrackSummary({ added: 700, alreadyTracked: 1850, roomLeft: 1450, skippedForLimit: 0 })).toBe(
      "Added 700 · already tracked 1,850 · room left 1,450"
    );
  });
  it("says what the limit left out, and drops room on an unlimited plan", () => {
    expect(bulkTrackSummary({ added: 3, alreadyTracked: 0, roomLeft: 0, skippedForLimit: 9 })).toBe(
      "Added 3 · already tracked 0 · 9 over the plan's limit · room left 0"
    );
    expect(bulkTrackSummary({ added: 3, alreadyTracked: 1, roomLeft: null, skippedForLimit: 0 })).toBe(
      "Added 3 · already tracked 1"
    );
  });
});
