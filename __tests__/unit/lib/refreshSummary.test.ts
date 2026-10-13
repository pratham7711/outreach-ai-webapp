import { summariseRefresh, describeAudioRefresh, describeTrackerSweep } from "@/lib/refreshSummary";

describe("summariseRefresh", () => {
  /* Accurate, not merely reassuring (walkthrough 2026-10-13, F5): a run that
     updated 1 post of 3 said "Post updated." and named no reason for the
     other two. */
  it("gives the ratio and why the rest could not be read", () => {
    expect(
      summariseRefresh({ total: 3, measured: 1, noMetrics: 1, unfetchable: 1, reasons: { "platform-challenged": 1, "post-deleted": 1 } }),
    ).toBe("1 of 3 updated · 2 couldn't be read: 1 blocked by the platform, 1 no longer exists.");
  });

  it("still gives the count when no reason was recorded", () => {
    expect(summariseRefresh({ total: 17, measured: 3, noMetrics: 14 })).toBe("3 of 17 updated · 14 couldn't be read.");
  });

  it("says all of them when every post landed", () => {
    expect(summariseRefresh({ total: 40, measured: 40 })).toBe("All 40 posts updated.");
    expect(summariseRefresh({ total: 1, measured: 1 })).toBe("Post updated.");
  });

  it("does not claim an update when nothing was measured", () => {
    expect(summariseRefresh({ total: 62, measured: 0, noMetrics: 62, reasons: { "platform-challenged": 62 } })).toBe(
      "0 of 62 updated · 62 couldn't be read: 62 blocked by the platform.",
    );
    expect(summariseRefresh({ total: 62 })).toBe("0 of 62 updated · 62 couldn't be read.");
  });

  it("separates posts the time budget never reached from posts that failed", () => {
    expect(summariseRefresh({ total: 40, measured: 20, failed: 2, remaining: 18, reasons: { error: 2 } })).toBe(
      "20 of 40 updated · 2 couldn't be read: 2 errored · 18 not reached this time; press Refresh Data again.",
    );
  });

  it("leaves a reason it has no wording for out rather than printing a slug", () => {
    expect(summariseRefresh({ total: 2, measured: 1, reasons: { "some-new-slug": 1 } })).toBe("1 of 2 updated · 1 couldn't be read.");
  });

  it("has its own wording for a campaign with no posts yet", () => {
    expect(summariseRefresh({ total: 0 })).toBe("No posts to refresh yet.");
    expect(summariseRefresh({})).toBe("No posts to refresh yet.");
  });
});

describe("summariseRefresh audio", () => {
  it("reports an unreachable sound, which used to pass as a clean success", () => {
    expect(summariseRefresh({ total: 17, measured: 3, noMetrics: 14, sound: { failed: 1 } })).toBe(
      "3 of 17 updated · 14 couldn't be read. The campaign audio could not be reached."
    );
  });

  it("reports a snapshot that landed", () => {
    expect(summariseRefresh({ total: 2, measured: 2, sound: { snapshots: 1 } })).toBe(
      "All 2 posts updated. Campaign audio updated."
    );
  });

  it("still reports the audio when no post data landed", () => {
    expect(summariseRefresh({ total: 4, measured: 0, sound: { failed: 1 } })).toBe(
      "0 of 4 updated · 4 couldn't be read. The campaign audio could not be reached."
    );
  });

  it("still reaches the audio when the campaign has no posts", () => {
    expect(summariseRefresh({ total: 0, sound: { failed: 1 } })).toBe(
      "No posts to refresh yet. The campaign audio could not be reached."
    );
  });

  it("leaves a campaign that tracks no sound reading exactly as before", () => {
    const without = summariseRefresh({ total: 4, measured: 4 });
    expect(summariseRefresh({ total: 4, measured: 4, sound: null })).toBe(without);
    expect(summariseRefresh({ total: 4, measured: 4, sound: undefined })).toBe(without);
  });

  it("says nothing about a sound that was too fresh to re-fetch", () => {
    expect(summariseRefresh({ total: 4, measured: 4, sound: { skipped: 1 } })).toBe(
      "All 4 posts updated."
    );
  });

  it("prefers the failure over a partial success in the same run", () => {
    expect(describeAudioRefresh({ snapshots: 1, failed: 1 })).toBe(
      "The campaign audio could not be reached."
    );
  });
});

/**
 * The tracker sweep's toast.
 *
 * "Updated 1 sound" was the whole message on {snapshots: 1, failed: 40} — a
 * near-total outage reported as a success.
 */
describe("describeTrackerSweep", () => {
  it("names the failures alongside the successes", () => {
    expect(describeTrackerSweep({ snapshots: 1, failed: 40 })).toEqual({
      tone: "warning",
      text: "Updated 1 sound — TikTok returned no count for 40 others",
    });
  });

  it("stays a plain success when nothing failed", () => {
    expect(describeTrackerSweep({ snapshots: 3, failed: 0 })).toEqual({
      tone: "success",
      text: "Updated 3 sounds",
    });
  });

  it("is an error when nothing was read at all", () => {
    expect(describeTrackerSweep({ snapshots: 0, failed: 4 })).toEqual({
      tone: "error",
      text: "TikTok did not return counts for any tracked sound",
    });
  });

  it("says so plainly when the cadence gate declined everything", () => {
    // Not a failure: every sound was read recently enough that another read
    // would record the same number.
    expect(describeTrackerSweep({ snapshots: 0, failed: 0, skipped: 12 })).toEqual({
      tone: "success",
      text: "Nothing to refresh",
    });
  });
});
