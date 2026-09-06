import { PLATFORMS, PLATFORM_KEYS, type PlatformKey } from "@/lib/platforms/registry";
import { detectPlatform } from "@/lib/platforms/fetchPostMetrics";

/**
 * A platform advertised as "auto" that nothing can fetch is not a feature.
 *
 * This is the mirror image of the failure fetcherWiring.test.ts was written
 * for. There the helper existed and nothing called it; here the registry makes
 * a PROMISE to the user and nothing honours it.
 *
 * `tracking: "auto"` is not decoration. registry.ts defines it as "a free
 * official API fetcher exists (metrics sync automatically)", and the UI derives
 * its affordances from it -- a post on an "auto" platform is presented as
 * something the product will keep up to date by itself.
 *
 * The chain that has to hold for that promise to be true:
 *
 *   fetchPostMetrics(url) -> detectPlatform(url) -> switch (detected.platform)
 *
 * detectPlatform returns null for anything it does not recognise, and
 * fetchPostMetrics returns null immediately when it does. So an "auto" platform
 * that detectPlatform cannot recognise silently produces no metrics, forever,
 * with no error anywhere -- which is exactly the shape of failure that is
 * invisible to a test that mocks the fetcher it is verifying.
 *
 * Found 2026-09-06: FACEBOOK, TWITCH, THREADS and PINTEREST were all declared
 * "auto" while PostMetrics["platform"] was the hand-written 3-union
 * "TIKTOK" | "INSTAGRAM" | "YOUTUBE" -- the precise drift registry.ts was
 * written to prevent ("add a platform once, here, not in 30 scattered arrays").
 */

/**
 * A representative post URL per platform, shaped to that platform's own
 * urlPatterns in the registry. Kept here rather than generated from the regexes
 * because a sample derived from the pattern would pass whatever the pattern
 * said, including a wrong pattern.
 */
const SAMPLE_URL: Record<PlatformKey, string> = {
  TIKTOK: "https://www.tiktok.com/@someone/video/7412345678901234567",
  INSTAGRAM: "https://www.instagram.com/p/DTsyXWBDkxN/",
  YOUTUBE: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  TWITTER: "https://x.com/someone/status/1812345678901234567",
  FACEBOOK: "https://www.facebook.com/someone/posts/1234567890",
  TWITCH: "https://www.twitch.tv/videos/123456789",
  THREADS: "https://www.threads.net/@someone/post/C8ZQ1XKSMPq",
  PINTEREST: "https://www.pinterest.com/pin/1234567890123/",
  SNAPCHAT: "https://www.snapchat.com/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYbnJ7Wp",
  LINKEDIN: "https://www.linkedin.com/posts/someone-1234567890123456789",
};

describe("registry tracking flags are honest", () => {
  /**
   * Guards the guard: if a platform is added to PLATFORM_KEYS without a sample
   * URL here, every assertion below would silently skip it.
   */
  it("has a sample URL for every platform in the registry", () => {
    const missing = PLATFORM_KEYS.filter((k) => !SAMPLE_URL[k]);
    expect(missing).toEqual([]);
  });

  const autoPlatforms = PLATFORMS.filter((p) => p.tracking === "auto");

  it("declares at least one auto platform (otherwise the check below is vacuous)", () => {
    expect(autoPlatforms.length).toBeGreaterThan(0);
  });

  it.each(autoPlatforms.map((p) => p.key))(
    '%s is declared tracking:"auto", so detectPlatform must recognise it',
    (key) => {
      const detected = detectPlatform(SAMPLE_URL[key]);
      expect(detected).not.toBeNull();
      expect(detected?.platform).toBe(key);
    },
  );

  /**
   * The other direction. A platform detectPlatform DOES handle but the registry
   * calls "manual" is a quieter bug -- the metrics arrive, but the UI tells the
   * user to type them in by hand.
   */
  it.each(PLATFORMS.filter((p) => p.tracking === "manual").map((p) => p.key))(
    '%s is declared tracking:"manual", so detectPlatform must NOT claim it',
    (key) => {
      expect(detectPlatform(SAMPLE_URL[key])).toBeNull();
    },
  );
});
