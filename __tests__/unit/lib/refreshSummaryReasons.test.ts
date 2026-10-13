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

  it("names a hidden post as hidden, not gone", () => {
    expect(describeReasons({ "post-hidden": 5 })).toBe("5 were hidden by their creator");
  });

  it("says an Instagram account shares no numbers, not that the post is gone", () => {
    expect(describeReasons({ "not-a-professional-account": 40 }))
      .toBe("40 are on Instagram accounts that share no numbers");
  });
});

describe("summariseRefresh with reasons", () => {
  /* The reasons are back in the toolbar sentence (walkthrough 2026-10-13, F5),
     failure reasons only and biggest first, in describeReasons' wording. */
  it("names the causes of what could not be read, biggest first", () => {
    const text = summariseRefresh({
      total: 88,
      measured: 22,
      noMetrics: 62,
      unfetchable: 4,
      reasons: { "post-deleted": 4, "platform-challenged": 62 },
    });

    expect(text).toBe("22 of 88 updated · 66 couldn't be read: 62 blocked by the platform, 4 no longer exist.");
  });

  it("stays a single clean sentence when everything landed", () => {
    expect(summariseRefresh({ total: 40, measured: 40, reasons: {} })).toBe("All 40 posts updated.");
  });

  it("keeps a partial reading out of the failure list and says it after", () => {
    expect(summariseRefresh({ total: 3, measured: 2, reasons: { "views-unavailable": 1, "post-hidden": 1 } })).toBe(
      "2 of 3 updated · 1 couldn't be read: 1 was hidden by their creator · 1 without new views.",
    );
  });

  it("still reports the campaign audio", () => {
    expect(summariseRefresh({ total: 4, measured: 1, reasons: { "post-deleted": 3 }, sound: { failed: 1 } }))
      .toBe("1 of 4 updated · 3 couldn't be read: 3 no longer exist. The campaign audio could not be reached.");
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
