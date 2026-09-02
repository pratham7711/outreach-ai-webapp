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
  /* The breakdown is collected, counted and logged -- and deliberately not
     shown. describeReasons above is where the wording lives for whoever is
     reading a run record; the campaign screen gets the count and stops. */
  it("keeps the breakdown out of the sentence the user reads", () => {
    const text = summariseRefresh({
      total: 88,
      measured: 22,
      noMetrics: 62,
      unfetchable: 4,
      reasons: { "platform-challenged": 62, "post-deleted": 4 },
    });

    expect(text).toBe("22 of 88 posts updated.");
    expect(text).not.toMatch(/blocked by the platform|no longer exist/);
  });

  it("reads the same whether or not the run recorded reasons", () => {
    expect(summariseRefresh({ total: 10, measured: 3, noMetrics: 7 })).toBe(
      "3 of 10 posts updated.",
    );
  });

  it("does not announce the batch the next run will pick up", () => {
    const text = summariseRefresh({
      total: 88,
      measured: 20,
      noMetrics: 5,
      remaining: 63,
      reasons: { "platform-challenged": 5 },
    });
    expect(text).toBe("20 of 88 posts updated.");
  });
});
