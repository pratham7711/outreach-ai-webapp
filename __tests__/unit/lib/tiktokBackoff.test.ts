/**
 * Backing off means backing off from TikTok, not from one endpoint on it.
 *
 * The breaker paces and then stops the direct video fetch, but the oEmbed
 * fallback used to run ungated straight afterwards -- so the moment we decided
 * we were being blocked, an 88-post refresh answered by firing one unpaced
 * request per remaining post at the same host, all within a couple of seconds.
 * Production logs showed 126 "breaker open" skips in a single window, and every
 * one of those was followed by a request the breaker thought it had prevented.
 */

/* Challenge threshold 1 so a single WAF page latches the gate here, and no gap
   so the test does not spend real time waiting. In production this threshold is
   30 -- a challenge is TikTok's ordinary answer and five in a row means
   nothing -- but what is under test is what happens ONCE the gate is shut,
   which is identical either way. Read at import, hence the assignment before
   require() below. */
process.env.TIKTOK_FETCH_CHALLENGE_THRESHOLD = "1";
process.env.TIKTOK_FETCH_CHALLENGE_COOLDOWN_MS = "60000";
process.env.TIKTOK_FETCH_MIN_GAP_MS = "0";
process.env.TIKTOK_FETCH_JITTER_MS = "0";

const CHALLENGE_HTML = "<html><body>please verify you are human</body></html>";

/** TikTok's answer to a datacenter IP: 200 OK, and no rehydration payload. */
function challenged() {
  return { ok: true, status: 200, text: async () => CHALLENGE_HTML, json: async () => ({}) };
}

describe("TikTok backoff covers every path to the host", () => {
  let fetchPostMetrics: typeof import("@/lib/platforms/fetchPostMetrics").fetchPostMetrics;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    /* A fresh module means a fresh gate: the breaker is module-level state, so
       without this the first test to trip it would decide the rest. */
    jest.resetModules();
    mockFetch = jest.fn().mockResolvedValue(challenged());
    global.fetch = mockFetch as unknown as typeof fetch;
    fetchPostMetrics = require("@/lib/platforms/fetchPostMetrics").fetchPostMetrics;
  });

  it("stops calling tiktok.com at all once the breaker has latched", async () => {
    /* One challenged response is enough at threshold 1. This first post is
       allowed to make its requests -- the direct fetch, then the oEmbed
       fallback, since the gate only shuts as the direct one is recorded. */
    await fetchPostMetrics("https://www.tiktok.com/@u/video/1");
    const afterFirst = mockFetch.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    /* Everything after the latch: the whole point is that the count does not
       move. Before the fix each of these still reached tiktok.com/oembed. */
    for (let i = 2; i <= 20; i++) {
      await fetchPostMetrics(`https://www.tiktok.com/@u/video/${i}`);
    }

    expect(mockFetch.mock.calls.length).toBe(afterFirst);
  });

  it("still answers with a usable stub rather than throwing while backed off", async () => {
    await fetchPostMetrics("https://www.tiktok.com/@u/video/1");

    const m = await fetchPostMetrics("https://www.tiktok.com/@u/video/2");

    /* The caller has to be able to tell "no counts" from "crashed": syncPost
       reads hasMetricCounts and must land on no-metrics, which leaves
       lastSyncedAt alone rather than stamping a measured zero. */
    expect(m).not.toBeNull();
    expect(m!.viewsCount).toBeUndefined();
    expect(m!.likesCount).toBeUndefined();
  });

  it("does not touch tiktok.com for a post on another platform", async () => {
    await fetchPostMetrics("https://www.tiktok.com/@u/video/1");
    mockFetch.mockClear();

    await fetchPostMetrics("https://instagram.com/reel/Cabc");

    /* A TikTok breaker must not gate Instagram. It reaches its own host. */
    const hosts = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(hosts.every((h) => !h.includes("tiktok.com"))).toBe(true);
  });
});
