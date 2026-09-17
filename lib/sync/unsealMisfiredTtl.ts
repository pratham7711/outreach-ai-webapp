import { effectiveExpiry, type PostTrackingInput } from "@/lib/sync/postTracking";

/**
 * Which seals were written by the null-TTL misfire, and are therefore wrong.
 *
 * `clampTtlDays` tested for "absent" through `Number()`, and `Number(null)` is
 * 0 rather than NaN, so a stored TTL nobody set took the 1-day floor instead of
 * the org default. Every post tracker created without an explicit TTL was
 * sealed a day after it started -- permanently, because the candidate query
 * excludes anything holding an `isFinalSnapshot` row and nothing writes that
 * back. Measured on prod 2026-09-17: 1,506 posts, and the 06:00 sweep answered
 * synced 0, sealed 900.
 *
 * The rule here is deliberately not "undo everything that source wrote". It is
 * "undo the seals the corrected rule disagrees with": a post is restored only
 * when its expiry, recomputed with the fixed clamp and the org's own
 * granularity, is still in the future. A tracker that really had run out stays
 * sealed, so running this cannot resurrect anything on grounds of the bug that
 * would not also survive the fix.
 *
 * That makes it idempotent in the way that matters -- a second run selects
 * nothing, because the first one removed the seal rows it keyed on -- and it
 * makes the blast radius a function of the corrected policy rather than of a
 * date range somebody typed.
 */

/** The seal source the sweep stamps on a TTL expiry. Only these are candidates;
 *  `cron-seal` is the older age-based seal and is not this bug. */
export const TTL_SEAL_SOURCE = "cron-seal-ttl";

export type SealedPost = {
  /** The syncSource of the post's final snapshot(s). */
  sealSources: string[];
  tracking: PostTrackingInput;
};

/**
 * True when this seal contradicts the corrected TTL rule.
 *
 * `hasFinalSnapshot` is ignored on purpose: it is what the seal set, so
 * consulting it would make every sealed post ineligible and the answer always
 * "nothing to do".
 */
export function sealedInError(post: SealedPost): boolean {
  if (!post.sealSources.includes(TTL_SEAL_SOURCE)) return false;
  return post.tracking.now.getTime() < effectiveExpiry(post.tracking).getTime();
}

/** Write in bounded chunks: the repair is one request, and a single transaction
 *  over every row would hold locks across the whole table for its duration. */
export const UNSEAL_CHUNK = 200;

export function chunk<T>(items: T[], size = UNSEAL_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
