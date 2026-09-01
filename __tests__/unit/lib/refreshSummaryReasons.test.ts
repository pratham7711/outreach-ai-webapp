import { describeReasons, summariseRefresh } from "@/lib/refreshSummary";

/**
 * "87 of 88 posts did not update" was true and useless.
 *
 * Almost all of that 87 is TikTok answering a datacenter address with a
 * challenge page, a handful is posts that no longer exist, and some of it is
 * posts the time budget never reached. Those have three different answers and
 * the old sentence collapsed them into one number, so the only way to tell them
 * apart was to read the platform logs by hand.
 */
describe("describeReasons", () => {
  it("is null when there is nothing to explain", () => {
    expect(describeReasons(undefined)).toBeNull();
    expect(describeReasons({})).toBeNull();
  });

  it("leads with the reason that accounts for the most posts", () => {
    expect(describeReasons({ "post-deleted": 4, "platform-challenged": 62 }))
      .toBe("62 blocked by the platform, 4 no longer exist");
  });

  /* A slug in the UI is worse than a shorter sentence. */
  it("drops reasons it has no wording for rather than printing the slug", () => {
    expect(describeReasons({ "platform-challenged": 3, "some-new-thing": 9 }))
      .toBe("3 blocked by the platform");
  });

  it("ignores zero counts", () => {
    expect(describeReasons({ "platform-challenged": 0 })).toBeNull();
  });
});

describe("summariseRefresh with reasons", () => {
  it("explains the shortfall instead of only counting it", () => {
    const text = summariseRefresh({
      total: 88,
      measured: 22,
      noMetrics: 62,
      unfetchable: 4,
      reasons: { "platform-challenged": 62, "post-deleted": 4 },
    });

    expect(text).toBe(
      "22 of 88 posts updated, 62 blocked by the platform, 4 no longer exist.",
    );
  });

  /* Runs recorded before reasons existed still have to read sensibly. */
  it("falls back to the old wording when a run carries no reasons", () => {
    const text = summariseRefresh({ total: 10, measured: 3, noMetrics: 7 });
    expect(text).toBe("3 of 10 posts updated, 7 returned no metrics.");
  });

  it("still reports what the next run will pick up", () => {
    const text = summariseRefresh({
      total: 88,
      measured: 20,
      noMetrics: 5,
      remaining: 63,
      reasons: { "platform-challenged": 5 },
    });
    expect(text).toContain("63 left for the next run");
  });
});
