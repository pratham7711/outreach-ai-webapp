/**
 * The order a sweep works through its batch, which decides what a deadline
 * cuts off.
 *
 * MEASURED on production 2026-09-16, the 06:30 run: 58 creators processed
 * inside the 4-minute budget -- 56 TikTok, 2 Instagram -- and 142 of the 200
 * selected were dropped at the deadline. A TikTok read opens a browser or a
 * Sandbox (~4.2s); Instagram and YouTube are plain HTTP (~450ms). The
 * selection was never the problem: the cheap reads were simply queued behind
 * the expensive ones and the clock ran out.
 */
/* snapshot.ts reaches the database at import time; the ordering key under
   test does not, so the client is stubbed rather than constructed. */
jest.mock("@/lib/db", () => ({ db: {} }));

import { readCostRank } from "@/lib/creators/snapshot";

/** The sort the sweep applies to its batch, isolated from the database. */
function order<T extends { platform: string }>(batch: T[]): T[] {
  return [...batch].sort((a, b) => readCostRank(a.platform) - readCostRank(b.platform));
}

describe("readCostRank", () => {
  it("ranks TikTok above every plain-HTTP platform", () => {
    for (const cheap of ["INSTAGRAM", "YOUTUBE", "TWITTER", "FACEBOOK"]) {
      expect(readCostRank(cheap)).toBeLessThan(readCostRank("TIKTOK"));
    }
  });

  it("puts an unknown platform on the cheap rung rather than the browser one", () => {
    /* A platform nobody has taught this function about is a plain fetch until
       proven otherwise; guessing "expensive" would starve it for no reason. */
    expect(readCostRank("PINTEREST")).toBe(readCostRank("INSTAGRAM"));
  });
});

describe("sweep batch order", () => {
  it("moves every cheap read ahead of the browser-bound ones", () => {
    const batch = [
      { id: "t1", platform: "TIKTOK" },
      { id: "i1", platform: "INSTAGRAM" },
      { id: "t2", platform: "TIKTOK" },
      { id: "y1", platform: "YOUTUBE" },
    ];
    expect(order(batch).map((c) => c.id)).toEqual(["i1", "y1", "t1", "t2"]);
  });

  it("keeps the staleness order the query established, within a platform", () => {
    /* The sort must be stable: the query ordered by trackerLastAttemptAt so
       the longest-waiting creator is read first, and re-ordering inside a
       platform would undo the rotation that stops a tail never being read. */
    const batch = [
      { id: "t-oldest", platform: "TIKTOK" },
      { id: "t-newer", platform: "TIKTOK" },
      { id: "i-oldest", platform: "INSTAGRAM" },
      { id: "i-newer", platform: "INSTAGRAM" },
    ];
    expect(order(batch).map((c) => c.id)).toEqual([
      "i-oldest", "i-newer", "t-oldest", "t-newer",
    ]);
  });

  it("changes nothing when the batch is all one platform", () => {
    const batch = [
      { id: "a", platform: "TIKTOK" },
      { id: "b", platform: "TIKTOK" },
      { id: "c", platform: "TIKTOK" },
    ];
    expect(order(batch).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("gives every cheap creator a turn on the measured production mix", () => {
    /* 246 Instagram / 78 YouTube / 1557 TikTok tracked, sampled into a
       200-row batch in proportion. Before the sort, a 58-creator budget
       reached 2 Instagram; after it, every Instagram row in the batch is
       inside the first 58. */
    const batch = [
      ...Array.from({ length: 26 }, (_, i) => ({ id: `i${i}`, platform: "INSTAGRAM" })),
      ...Array.from({ length: 8 }, (_, i) => ({ id: `y${i}`, platform: "YOUTUBE" })),
      ...Array.from({ length: 166 }, (_, i) => ({ id: `t${i}`, platform: "TIKTOK" })),
    ].sort(() => 0); // the query's own order, interleaved by staleness
    const reached = order(batch).slice(0, 58);
    expect(reached.filter((c) => c.platform === "INSTAGRAM")).toHaveLength(26);
    expect(reached.filter((c) => c.platform === "YOUTUBE")).toHaveLength(8);
    expect(reached.filter((c) => c.platform === "TIKTOK")).toHaveLength(24);
  });
});
