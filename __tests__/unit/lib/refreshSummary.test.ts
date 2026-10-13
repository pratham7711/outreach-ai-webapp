import { summariseRefresh, describeAudioRefresh, describeTrackerSweep } from "@/lib/refreshSummary";

describe("summariseRefresh", () => {
  it("says a refresh happened and nothing more", () => {
    expect(summariseRefresh({ total: 17, measured: 3, noMetrics: 14 })).toBe("Posts updated.");
  });

  it("does not give the ratio either", () => {
    /* The count went the same way as the reasons, and for the same reason:
       "3 of 17" invited the question the breakdown used to answer badly. How
       fresh any single post is already sits on that post's own row, which is
       where the reader can act on it. */
    const text = summariseRefresh({ total: 17, measured: 3, noMetrics: 14 });
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/of 17|3 of/);
  });

  it("says nothing about the posts that came back empty", () => {
    /* Deliberate. The reader cannot act on "14 returned no metrics" and it read
       as the product apologising in the middle of their campaign; the numbers
       are still on CampaignRefreshRun for whoever is debugging the run. */
    const text = summariseRefresh({ total: 5, measured: 1, noMetrics: 2, unfetchable: 2 });
    expect(text).toBe("Post updated.");
    expect(text).not.toMatch(/no metrics|unfetchable/i);
  });

  it("says post, not posts, when exactly one landed", () => {
    expect(summariseRefresh({ total: 1, measured: 1 })).toBe("Post updated.");
    expect(summariseRefresh({ total: 40, measured: 1 })).toBe("Post updated.");
  });

  it("does not claim an update when nothing was measured", () => {
    /* The one line the shortened wording must not cross. A run that read no new
       numbers has not updated anything, and "Posts updated." there would be the
       toolbar telling the user something false. Still no cause named -- that
       stays in the run record -- but not a false claim either. */
    expect(summariseRefresh({ total: 62, measured: 0, noMetrics: 62 })).toBe("No new data yet.");
    expect(summariseRefresh({ total: 62 })).toBe("No new data yet.");
  });

  it("does not mention failures or a deferred batch either", () => {
    expect(summariseRefresh({ total: 40, measured: 20, failed: 2, remaining: 18 })).toBe(
      "Posts updated."
    );
  });

  it("has its own wording for a campaign with no posts yet", () => {
    expect(summariseRefresh({ total: 0 })).toBe("No posts to refresh yet.");
    expect(summariseRefresh({})).toBe("No posts to refresh yet.");
  });
});

describe("summariseRefresh audio", () => {
  it("reports an unreachable sound, which used to pass as a clean success", () => {
    expect(summariseRefresh({ total: 17, measured: 3, noMetrics: 14, sound: { failed: 1 } })).toBe(
      "Posts updated. The campaign audio could not be reached."
    );
  });

  it("reports a snapshot that landed", () => {
    expect(summariseRefresh({ total: 2, measured: 2, sound: { snapshots: 1 } })).toBe(
      "Posts updated. Campaign audio updated."
    );
  });

  it("still reports the audio when no post data landed", () => {
    expect(summariseRefresh({ total: 4, measured: 0, sound: { failed: 1 } })).toBe(
      "No new data yet. The campaign audio could not be reached."
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
      "Posts updated."
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
