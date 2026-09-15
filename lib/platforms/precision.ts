/**
 * How much of a counter each platform is actually willing to tell us.
 *
 * Two different facts get confused constantly in this codebase, so they are
 * named apart here:
 *
 *   - which FIELD to read, when a payload carries the same counter twice at
 *     different precision (TikTok's `stats` vs `statsV2`) -- that lives in each
 *     platform's reader;
 *   - what a number MEANS once read, when the platform will only ever publish a
 *     rendered figure -- that lives here.
 *
 * The second one has no fix at the fetch layer. TikTok's video page serves
 * `playCount: 11700` and `statsV2.playCount: "11700"` for the same post; its
 * author block serves `"27200000"` for an account the profile page reports as
 * 27,218,979 -- measured live on 2026-09-15, on @nba's own video pages.
 * YouTube's Data API rounds the public `subscriberCount` to three significant
 * figures for every channel above 1,000 (measured 2026-09-06); a channel's own
 * OAuth token may do better, since the one row this app has written that way
 * holds 48,210, which is four significant figures. Where there is nothing more
 * precise to read, the only thing left to protect is the precision we ALREADY
 * hold.
 *
 * Measured 2026-09-15 on the prod-shaped copy (ep-green-shadow-aub0yhjc):
 * 75 of the 76 `Creator.followersCount` rows at or above 10,000 sat exactly on
 * TikTok's display ladder -- 838,800 / 801,800 / 685,900 / 611,400 / 2,600,000 --
 * because an hourly post sync wrote the video page's rounded author figure over
 * whatever the profile read had learned. The one exception was an Instagram row
 * (215,293), from a platform that publishes the digits.
 */

/** The bucket a platform's rendered figure stands for, or null where it prints the digits. */
export type RoundingLadder = (value: number) => number | null;

/**
 * TikTok: abbreviated from 10,000 up, always to one decimal place -- 11.1K,
 * 563.3K, 15.5M -- so the step is a hundredth of the unit being shown.
 */
export const TIKTOK_DISPLAY: RoundingLadder = (value) => {
  if (!Number.isFinite(value) || value < 10_000) return null;
  if (value < 1_000_000) return 100;
  if (value < 1_000_000_000) return 100_000;
  return 100_000_000;
};

/**
 * YouTube: the public `subscriberCount` is rounded to three significant figures
 * for every channel above 1,000 (measured 2026-09-06). Per-video `viewCount`,
 * `likeCount` and `commentCount` are exact -- measured 2026-09-15, 10 of 750
 * stored YouTube post view counts above 10,000 land on a step, which is the
 * coincidence rate -- so this ladder is for the subscriber column and nothing
 * else. A figure that is NOT on the 3-s.f. grid is treated as exact, which is
 * what a channel's own OAuth token appears to return.
 *
 * Digit count off the string rather than log10 -- log10(1000) is exactly 3 in
 * IEEE754 but the identity is not guaranteed for every power, and being one
 * decade out here silently changes the step by 10x.
 */
export const YOUTUBE_SUBSCRIBERS: RoundingLadder = (value) => {
  if (!Number.isFinite(value) || value < 1000) return null;
  return 10 ** Math.max(0, Math.floor(value).toString().length - 3);
};

/** Platforms that publish the integer: Instagram, Threads, Facebook, Twitch, and TikTok's own Display API. */
export const EXACT: RoundingLadder = () => null;

/** The ladder for a follower/subscriber figure read from `platform`. */
export function followerLadder(platform: string | null | undefined): RoundingLadder {
  switch ((platform ?? "").toUpperCase()) {
    case "TIKTOK":
      return TIKTOK_DISPLAY;
    case "YOUTUBE":
      return YOUTUBE_SUBSCRIBERS;
    default:
      return EXACT;
  }
}

/**
 * The ladder for a post counter read from `platform`.
 *
 * Deliberately not the same map as followerLadder: YouTube rounds the channel's
 * subscribers and nothing else, so its posts take the exact ladder.
 */
export function postLadder(platform: string | null | undefined): RoundingLadder {
  return (platform ?? "").toUpperCase() === "TIKTOK" ? TIKTOK_DISPLAY : EXACT;
}

/**
 * The step this value looks rounded to, or null when it carries full precision.
 *
 * "Looks" is the whole caveat: an exact count that happens to land on a step is
 * indistinguishable from a rounded one, and roughly 1% of TikTok counts in the
 * 10K-1M band will. Everything downstream is written so that guessing wrong in
 * that direction costs a no-op, never a wrong number.
 */
export function roundedStep(value: number | undefined, ladder: RoundingLadder): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const step = ladder(value);
  return step !== null && value % step === 0 ? step : null;
}

/** Whether a counter is at the platform's display precision rather than exact. */
export function isRounded(value: number | undefined, ladder: RoundingLadder): boolean {
  return roundedStep(value, ladder) !== null;
}

/**
 * A rounded read must not destroy an exact figure we already hold.
 *
 * A rounded read of R with step s says only that the true count is near R. If
 * what we already hold is inside that window, it is the same fact at higher
 * precision and there is nothing to learn; outside it, the count has genuinely
 * moved and the new figure -- rounded or not -- is the better answer. Counts
 * only grow, so "outside, below" is the ordinary case for something still being
 * watched, and the guard gets out of the way.
 *
 * The window is deliberately the union of both roundings a platform could be
 * doing: truncation puts the true count in [R, R+s), round-to-nearest in
 * [R-s/2, R+s/2). TikTok was measured doing round-to-nearest on 2026-09-15 --
 * a profile reporting 1,363,722 renders as 1,400,000 -- but the union costs
 * nothing and covers a platform that does the other.
 */
export function keepPrecise(
  incoming: number | undefined,
  stored: number | undefined,
  ladder: RoundingLadder,
): number | undefined {
  if (typeof incoming !== "number") return incoming;
  if (typeof stored !== "number" || !Number.isFinite(stored) || stored <= 0) return incoming;
  const step = roundedStep(incoming, ladder);
  if (step === null) return incoming;
  /* Both rounded is not a precision question -- take the newer one. */
  if (isRounded(stored, ladder)) return incoming;
  return stored >= incoming - step / 2 && stored < incoming + step ? stored : incoming;
}
