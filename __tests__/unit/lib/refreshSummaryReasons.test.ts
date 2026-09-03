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
     shown. Owner's call, 2026-09-03.

     This assertion has moved twice in a day, so it is worth pinning why it
     ended up here: the reasons are not missing, they are addressed to someone
     else. A person watching a refresh is told it happened; a person debugging a
     bad run reads CampaignRefreshRun.reasons, Post.platformMetrics.__lastFetch,
     or the "campaign refresh finished" log line, and describeReasons() --
     tested above -- is where the wording for those lives. */
  it("never names the cause, however bad the run was", () => {
    const text = summariseRefresh({
      total: 88,
      measured: 22,
      noMetrics: 62,
      unfetchable: 4,
      reasons: { "platform-challenged": 62, "post-deleted": 4 },
    });

    expect(text).toBe("Posts updated.");
    expect(text).not.toMatch(/blocked|no longer exist|refused|platform/i);
  });

  it("stays a single clean sentence when everything landed", () => {
    const text = summariseRefresh({
      total: 40,
      measured: 40,
      reasons: {},
    });

    expect(text).toBe("Posts updated.");
  });

  it("reads the same whether or not the run recorded reasons", () => {
    const withReasons = summariseRefresh({
      total: 10,
      measured: 3,
      noMetrics: 7,
      reasons: { "platform-challenged": 7 },
    });
    const without = summariseRefresh({ total: 10, measured: 3, noMetrics: 7 });

    expect(withReasons).toBe("Posts updated.");
    expect(withReasons).toBe(without);
  });

  it("does not announce the batch the next run will pick up", () => {
    const text = summariseRefresh({
      total: 88,
      measured: 20,
      noMetrics: 5,
      remaining: 63,
      reasons: { "platform-challenged": 5 },
    });

    expect(text).toBe("Posts updated.");
    expect(text).not.toMatch(/63|remaining/);
  });

  /* Withholding the cause must not become claiming a success that did not
     happen. A run where every post was blocked says so -- in the reader's
     terms, not the platform's -- and the reasons still stay out of it. */
  it("does not read as a success when every post was blocked", () => {
    const text = summariseRefresh({
      total: 88,
      measured: 0,
      noMetrics: 88,
      reasons: { "platform-challenged": 88 },
    });

    expect(text).toBe("No new data yet.");
    expect(text).not.toMatch(/blocked|platform/i);
  });

  /* The audio half is not a failure reason and is not covered by the rule
     above: a campaign built around a sound needs to know the sound was missed,
     and that is a fact about the run, not an apology for a platform. */
  it("still reports the campaign audio", () => {
    expect(summariseRefresh({ total: 4, measured: 1, reasons: { "post-deleted": 3 }, sound: { failed: 1 } }))
      .toBe("Post updated. The campaign audio could not be reached.");
  });
});

/**
 * The wording still matters -- it just has a different audience now. These
 * assertions moved off summariseRefresh, which no longer renders any of it,
 * onto describeReasons, which is what a person debugging a run record reads.
 *
 * The distinction being protected: "blocked by the platform" for OUR own outage
 * sends that person to ask TikTok why, which is the wrong place, and is the
 * reason `reader-unavailable` exists as a separate reason at all.
 */
describe("reader-unavailable wording", () => {
  it("says we could not read it, not that the platform blocked it", () => {
    const text = describeReasons({
      "reader-unavailable": 16,
      "post-deleted": 3,
      "platform-refused": 2,
    });

    expect(text).toContain("16 we could not read, retrying");
    expect(text).not.toContain("16 blocked by the platform");
  });

  it("still blames the platform when the platform is what refused us", () => {
    expect(describeReasons({ "platform-challenged": 6 })).toContain("6 blocked by the platform");
  });
});
