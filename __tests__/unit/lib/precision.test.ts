/**
 * The ladders, against figures actually read off the live platforms.
 *
 * Every number below was measured on 2026-09-15 rather than invented: the @nba
 * video page and profile page on the same afternoon, and the stored rows on the
 * prod-shaped copy. A ladder that drifts from what the platform really renders
 * is worse than no ladder -- it refuses writes that should land.
 */
import {
  EXACT,
  followerLadder,
  isRounded,
  keepPrecise,
  postLadder,
  roundedStep,
  TIKTOK_DISPLAY,
  YOUTUBE_SUBSCRIBERS,
} from "@/lib/platforms/precision";

describe("TIKTOK_DISPLAY", () => {
  it("prints the digits below 10,000", () => {
    expect(TIKTOK_DISPLAY(9999)).toBeNull();
    expect(roundedStep(2911, TIKTOK_DISPLAY)).toBeNull(); // a live commentCount
  });

  it("steps by 100 between 10,000 and a million", () => {
    expect(TIKTOK_DISPLAY(11_700)).toBe(100);
    expect(TIKTOK_DISPLAY(692_300)).toBe(100); // live diggCount
  });

  it("steps by 100,000 in the millions and 100,000,000 in the billions", () => {
    expect(TIKTOK_DISPLAY(5_700_000)).toBe(100_000); // live playCount
    expect(TIKTOK_DISPLAY(1_500_000_000)).toBe(100_000_000);
  });

  it("scores a live video page the way the page actually reads", () => {
    // https://www.tiktok.com/@nba/video/7654752160051121422, read 2026-09-15
    expect(isRounded(5_700_000, TIKTOK_DISPLAY)).toBe(true); // playCount
    expect(isRounded(692_300, TIKTOK_DISPLAY)).toBe(true); // diggCount
    expect(isRounded(21_100, TIKTOK_DISPLAY)).toBe(true); // shareCount
    expect(isRounded(2911, TIKTOK_DISPLAY)).toBe(false); // commentCount, exact
    expect(isRounded(30_136, TIKTOK_DISPLAY)).toBe(false); // collectCount, exact
  });
});

describe("YOUTUBE_SUBSCRIBERS", () => {
  it("prints the digits below 1,000", () => {
    expect(YOUTUBE_SUBSCRIBERS(999)).toBeNull();
  });

  it("steps by one decade less than three significant figures", () => {
    expect(YOUTUBE_SUBSCRIBERS(1_000)).toBe(10);
    expect(YOUTUBE_SUBSCRIBERS(48_210)).toBe(100);
    expect(YOUTUBE_SUBSCRIBERS(1_234_567)).toBe(10_000);
  });

  it("reads the one figure a real OAuth token wrote as exact", () => {
    // @blessingjolie, CreatorSocialAccount, origin oauth, 2026-09-12.
    // 48,210 is four significant figures, so it is not off the public grid.
    expect(isRounded(48_210, YOUTUBE_SUBSCRIBERS)).toBe(false);
    expect(isRounded(48_200, YOUTUBE_SUBSCRIBERS)).toBe(true);
  });

  it("does not use TikTok's ladder, which would miss it by a decade", () => {
    expect(TIKTOK_DISPLAY(1_234_567)).toBe(100_000);
    expect(YOUTUBE_SUBSCRIBERS(1_234_567)).toBe(10_000);
  });
});

describe("choosing a ladder", () => {
  it("gives TikTok its display ladder for both followers and posts", () => {
    expect(followerLadder("TIKTOK")).toBe(TIKTOK_DISPLAY);
    expect(postLadder("TIKTOK")).toBe(TIKTOK_DISPLAY);
  });

  it("rounds YouTube's subscribers but not its posts", () => {
    expect(followerLadder("YOUTUBE")).toBe(YOUTUBE_SUBSCRIBERS);
    expect(postLadder("YOUTUBE")).toBe(EXACT);
  });

  it("treats every other platform as exact, including an unknown one", () => {
    for (const p of ["INSTAGRAM", "THREADS", "FACEBOOK", "TWITCH", "TWITTER", "", null, undefined]) {
      expect(followerLadder(p)).toBe(EXACT);
      expect(postLadder(p)).toBe(EXACT);
    }
  });

  it("is case-insensitive, because platform arrives as both enum and string", () => {
    expect(followerLadder("tiktok")).toBe(TIKTOK_DISPLAY);
    expect(postLadder("TikTok")).toBe(TIKTOK_DISPLAY);
  });
});

describe("keepPrecise on the figures that caused this", () => {
  const tt = TIKTOK_DISPLAY;

  it("refuses the video page's author figure over the profile page's", () => {
    // Both read on 2026-09-15 for @nba.
    expect(keepPrecise(27_200_000, 27_218_979, tt)).toBe(27_218_979);
  });

  it("lets the profile page's own exact figure land", () => {
    expect(keepPrecise(27_218_979, 22_000_000, tt)).toBe(27_218_979);
  });

  it("lets a genuinely grown rounded figure land", () => {
    // @mtv was stored at 4,800,000 and really has 10,845,944.
    expect(keepPrecise(10_800_000, 4_800_000, tt)).toBe(10_800_000);
  });

  it("does not block a first write onto an empty column", () => {
    expect(keepPrecise(27_200_000, 0, tt)).toBe(27_200_000);
    expect(keepPrecise(27_200_000, undefined, tt)).toBe(27_200_000);
  });

  it("never blocks anything on a platform that publishes the digits", () => {
    expect(keepPrecise(27_200_000, 27_218_979, EXACT)).toBe(27_200_000);
  });
});
