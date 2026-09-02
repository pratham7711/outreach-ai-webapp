import { laneCountFor, LANE_SECONDS_PER_POST } from "@/lib/platforms/tiktokPostSandbox";

/**
 * Lanes are capacity, not a queue. Every sandbox gets its own egress IP
 * (measured: five sandboxes, five addresses, three of them inside one region),
 * and TikTok refuses on identity rather than volume -- so the way to serve more
 * agencies is more addresses at the same polite pace, never one address asked
 * harder.
 *
 * These pin the sizing, because the failure they guard against is silent: a
 * pool that always opens one lane still works, just slowly enough that large
 * campaigns can never finish inside a run, which is exactly the ceiling this
 * replaced.
 */

describe("laneCountFor", () => {
  const BUDGET = 200;

  afterEach(() => {
    delete process.env.TIKTOK_SANDBOX_MAX_LANES;
  });

  it("opens nothing when there is no TikTok work", () => {
    expect(laneCountFor(0, BUDGET)).toBe(0);
  });

  it("opens a single lane for a small campaign", () => {
    // 20 posts is ~36s of paced work; one address covers it comfortably.
    expect(laneCountFor(20, BUDGET)).toBe(1);
  });

  it("keeps PARA PARA at a small pool when the target is loose", () => {
    // 88 posts is ~158s, just inside a 200s budget.
    expect(laneCountFor(88, BUDGET)).toBe(1);
  });

  it("beats CreatorCore at the default target", () => {
    /* Measured 2026-09-02: CreatorCore refreshed the same campaign, 118 posts on
       their side, in ~66s -- a steady 2.33 posts/sec. Matching that is the bar;
       the default target has to clear it without a faster per-address pace. */
    const CC_POSTS = 118;
    const CC_SECONDS = 66;
    const lanes = laneCountFor(CC_POSTS); // default target, no override
    const ours = (CC_POSTS * LANE_SECONDS_PER_POST) / lanes;
    expect(ours).toBeLessThan(CC_SECONDS);
  });

  it("beats CreatorCore's throughput at every campaign size we hold", () => {
    /* Sizes taken from prod. This is the assertion that forced the target from
       45s to 35s: at 45s an 88-post campaign rounded down to four lanes and
       lost. Beating a rate needs a minimum lane count, not just a time target. */
    const CC_POSTS_PER_SEC = 2.33;
    for (const posts of [88, 118, 136, 206, 223, 273, 371, 492]) {
      const lanes = laneCountFor(posts);
      const ourSeconds = (posts * LANE_SECONDS_PER_POST) / lanes;
      expect(ourSeconds).toBeLessThanOrEqual(posts / CC_POSTS_PER_SEC);
    }
  });

  it("does not throw lanes at tiny campaigns to chase a benchmark", () => {
    /* Under ~60 posts CreatorCore is faster and we accept that: the per-address
       pace is a floor, and booting sandboxes to win a twenty-post refresh costs
       more in boot latency -- which this arithmetic does not even model -- than
       the work it saves.

       Twenty posts now opens three lanes rather than two, and that is not the
       benchmark creeping back in: the default target moved 35s -> 15s because
       lane count is really the lever on how many EGRESS ADDRESSES a run holds.
       At 35s a 58-post refresh got three lanes and ~19 requests per address,
       reused across all three retry sweeps, and 15 of those posts came back
       walled. The single-lane case below is the one this test exists to
       protect, and it is unchanged. */
    expect(laneCountFor(5)).toBe(1);
    expect(laneCountFor(20)).toBeLessThanOrEqual(3);
  });

  it("scales up for a campaign that could never finish on one lane", () => {
    /* LKM/Playlists: 492 posts is ~886s of paced work. On one lane that is four
       refreshes and two hours of cooldown; the whole point of the pool is that
       it becomes one run. */
    const lanes = laneCountFor(492, BUDGET);
    expect(lanes).toBeGreaterThan(1);
    expect((492 * LANE_SECONDS_PER_POST) / lanes).toBeLessThanOrEqual(BUDGET);
  });

  it("finishes every real campaign size inside the budget", () => {
    // The five prod campaigns that overflowed a single 260s run.
    for (const posts of [492, 371, 273, 223, 206, 136, 122, 113, 88]) {
      const lanes = laneCountFor(posts, BUDGET);
      const seconds = (posts * LANE_SECONDS_PER_POST) / lanes;
      expect(seconds).toBeLessThanOrEqual(BUDGET);
    }
  });

  it("never exceeds the configured ceiling", () => {
    process.env.TIKTOK_SANDBOX_MAX_LANES = "3";
    expect(laneCountFor(5000, BUDGET)).toBe(3);
  });

  it("always opens at least one lane when there is work", () => {
    process.env.TIKTOK_SANDBOX_MAX_LANES = "0";
    expect(laneCountFor(10, BUDGET)).toBe(1);
  });

  it("grows with the work rather than staying fixed", () => {
    // The regression this catches: a pool hardcoded to one lane.
    expect(laneCountFor(1000, BUDGET)).toBeGreaterThan(laneCountFor(100, BUDGET));
  });
});
