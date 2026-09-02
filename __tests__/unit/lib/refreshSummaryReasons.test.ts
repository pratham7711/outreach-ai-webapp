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

  /* This reason arrived with a merge and had no wording, which the "drops
     reasons it has no wording for" rule above would have hidden completely --
     the one outcome on the list with something a person can actually do about
     it, silently absent from the breakdown. REASON_LABEL is now typed against
     the reason union so the build fails without wording; this is the assertion
     that the wording is the right wording. */
  it("names a rejected credential as something a person can fix", () => {
    expect(describeReasons({ "credentials-rejected": 12 }))
      .toBe("12 need Instagram reconnected");
  });
});

describe("summariseRefresh with reasons", () => {
  /* The breakdown is collected, counted and logged -- and deliberately not
     shown. describeReasons above is where the wording lives for whoever is
     reading a run record; the campaign screen gets the count and stops. */
  /* This assertion is the reverse of what it was, deliberately.
   *
   * The breakdown was removed from here on the grounds that a brand reading a
   * campaign screen can do nothing about a TikTok challenge page. That holds
   * for the shared report, which renders its own summary and never calls this.
   * It does not hold for the operator's dashboard, where withholding the cause
   * made "41 of 62 posts updated" a question that could only be answered by
   * reading platform logs -- with the reason sitting unused in the response
   * body the whole time. */
  it("says why, when some posts did not land", () => {
    const text = summariseRefresh({
      total: 88,
      measured: 22,
      noMetrics: 62,
      unfetchable: 4,
      reasons: { "platform-challenged": 62, "post-deleted": 4 },
    });

    expect(text).toBe("22 of 88 posts updated. 62 blocked by the platform, 4 no longer exist.");
  });

  it("stays a single clean sentence when everything landed", () => {
    // Nothing to explain, so nothing is appended -- the breakdown is for the
    // posts that did not make it, not decoration on a clean run.
    const text = summariseRefresh({
      total: 40,
      measured: 40,
      reasons: {},
    });

    expect(text).toBe("40 of 40 posts updated.");
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
    /* The subject of this test is `remaining`, which is still not announced --
       the reason breakdown that now follows the count is a different thing. */
    expect(text).toBe("20 of 88 posts updated. 5 blocked by the platform.");
    expect(text).not.toMatch(/63|remaining/);
  });
});
