/**
 * @jest-environment node
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Two protections live in the harness rather than in app code, so nothing in the
 * suite fails when they are dropped — the tests just quietly start lying. Both
 * were lost once already to a merge that took one branch wholesale, and stayed
 * green while doing it. These assertions make that loud.
 */
describe("integration harness guards", () => {
  it("neutralises the TikTok rate gate under the node environment", () => {
    // The gate is module-level in fetchPostMetrics, so production defaults here
    // mean a 1.5s minimum gap and a breaker that opens after 5 blocked fetches
    // and stays open 15 minutes — leaking across suites. campaignPosts and
    // postMetrics both exercise the real fetcher, so this is not hypothetical.
    expect(process.env.TIKTOK_FETCH_MIN_GAP_MS).toBe("0");
    expect(process.env.TIKTOK_FETCH_JITTER_MS).toBe("0");
    expect(Number(process.env.TIKTOK_FETCH_BREAKER_THRESHOLD)).toBeGreaterThan(1000);
  });

  it("keeps the integration config out of nested worktrees", () => {
    // Run from webapp/ with a peer session's worktree nested inside, jest
    // otherwise collects that checkout's suites too: 135 suites instead of 67,
    // with phantom failures belonging to someone else's branch.
    const config = readFileSync(join(process.cwd(), "jest.integration.config.js"), "utf8");
    expect(config).toContain("modulePathIgnorePatterns");
    expect(config).toContain("testPathIgnorePatterns");
    expect(config).toContain(".claude/worktrees/");
  });
});
