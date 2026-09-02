import { summariseRefresh, describeAudioRefresh } from "@/lib/refreshSummary";

describe("summariseRefresh", () => {
  it("leads with what actually landed", () => {
    expect(summariseRefresh({ total: 17, measured: 3, noMetrics: 14 })).toBe(
      "3 of 17 posts updated."
    );
  });

  it("says nothing about the posts that came back empty", () => {
    /* Deliberate. The reader cannot act on "14 returned no metrics" and it read
       as the product apologising in the middle of their campaign; the numbers
       are still on CampaignRefreshRun for whoever is debugging the run. */
    const text = summariseRefresh({ total: 5, measured: 1, noMetrics: 2, unfetchable: 2 });
    expect(text).toBe("1 of 5 posts updated.");
    expect(text).not.toMatch(/no metrics|unfetchable/i);
  });

  it("says post, not posts, for a campaign with one", () => {
    expect(summariseRefresh({ total: 1, measured: 1 })).toBe("1 of 1 post updated.");
  });

  it("does not mention failures or a deferred batch either", () => {
    expect(summariseRefresh({ total: 40, measured: 20, failed: 2, remaining: 18 })).toBe(
      "20 of 40 posts updated."
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
      "3 of 17 posts updated. The campaign audio could not be reached."
    );
  });

  it("reports a snapshot that landed", () => {
    expect(summariseRefresh({ total: 2, measured: 2, sound: { snapshots: 1 } })).toBe(
      "2 of 2 posts updated. Campaign audio updated."
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
      "4 of 4 posts updated."
    );
  });

  it("prefers the failure over a partial success in the same run", () => {
    expect(describeAudioRefresh({ snapshots: 1, failed: 1 })).toBe(
      "The campaign audio could not be reached."
    );
  });
});
