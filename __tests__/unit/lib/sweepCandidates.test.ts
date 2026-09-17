/**
 * @jest-environment node
 *
 * The sweep's fairness, which had none.
 *
 * Production, 2026-09-17: 17,972 tracked posts -- 14,837 TikTok, 2,237 YouTube,
 * 898 Instagram -- all switched on in one action two days earlier. Each platform
 * had a 100-read budget per run. The next 300 candidates were 243 TikTok, 57
 * Instagram and 0 YouTube, so YouTube's budget was unspent on every run and its
 * posts had gone unread for days with a perfectly working reader.
 */
import {
  CANDIDATE_CEILING,
  CANDIDATE_MULTIPLE,
  SWEEP_PLATFORMS,
  candidateTake,
  roundRobin,
} from "@/lib/sync/sweepCandidates";

describe("candidateTake", () => {
  it("asks for more rows than the budget, so throttled ones do not waste it", () => {
    /* Taking exactly the budget is the same unspent-budget bug one layer down:
       a run where two-thirds are cadence-throttled would read a third of what
       it was allowed to. */
    expect(candidateTake(100)).toBe(100 * CANDIDATE_MULTIPLE);
    expect(candidateTake(100)).toBeGreaterThan(100);
  });

  it("bounds one platform's backlog", () => {
    expect(candidateTake(10_000)).toBe(CANDIDATE_CEILING);
  });

  it("asks for nothing when a platform may read nothing", () => {
    // SYNC_BUDGET_TIKTOK=0 means "do not read TikTok"; fetching rows to decide
    // against them costs a query and a decision per row for nothing.
    expect(candidateTake(0)).toBe(0);
  });
});

describe("roundRobin", () => {
  it("gives every platform a turn before any takes a second", () => {
    const out = roundRobin([
      ["yt1", "yt2"],
      ["tt1", "tt2"],
      ["ig1", "ig2"],
    ]);
    expect(out).toEqual(["yt1", "tt1", "ig1", "yt2", "tt2", "ig2"]);
  });

  it("keeps a large backlog from pushing a small one past the deadline", () => {
    /* The run stops at a four-minute deadline. With the lists concatenated, a
       TikTok backlog spends the whole clock and the cheap platforms are never
       reached -- the starvation this fixes, moved from the query to the loop. */
    const tiktok = Array.from({ length: 300 }, (_, i) => `tt${i}`);
    const youtube = ["yt0", "yt1"];
    const order = roundRobin([youtube, tiktok]);
    const firstTwenty = order.slice(0, 20);
    expect(firstTwenty).toContain("yt0");
    expect(firstTwenty).toContain("yt1");
  });

  it("handles empty and ragged lists", () => {
    expect(roundRobin([])).toEqual([]);
    expect(roundRobin([[], [], []])).toEqual([]);
    expect(roundRobin([["a"], [], ["b", "c"]])).toEqual(["a", "b", "c"]);
  });

  it("loses nothing", () => {
    const lists = [["a", "b", "c"], ["d"], ["e", "f"]];
    expect(roundRobin(lists).sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});

describe("SWEEP_PLATFORMS", () => {
  it("names every platform with a reader, and none without one", () => {
    /* A platform missing from this list is read zero times a day and nothing
       reports it -- which is precisely how YouTube was starved. TWITTER is
       excluded because no reader exists for it, not as an oversight. */
    expect([...SWEEP_PLATFORMS].sort()).toEqual(["INSTAGRAM", "TIKTOK", "YOUTUBE"]);
  });
});
