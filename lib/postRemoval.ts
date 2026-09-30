/**
 * "The creator took it down" — the one fetch failure that is about the post
 * rather than about us.
 *
 * syncPost writes `fetchState: "UNAVAILABLE"` on exactly one reason,
 * `post-deleted`, and on no other: a rate limit, a timeout or a blocked region
 * all mean we could not look, which is not the same claim. It deliberately
 * leaves the last recorded counts and the thumbnail in place, because those
 * numbers were real while the post was up and a brand still bought them. So
 * "removed" is a badge over intact data, never a reason to blank a row.
 *
 * Two signals rather than one. `fetchState` is the column and is authoritative,
 * but it only exists on posts synced since the parity DDL ran; the `__lastFetch`
 * note in platformMetrics carries the same verdict with a timestamp and a
 * caller, and is what tells the client *when* we last checked. Either one alone
 * is enough to say the post is gone.
 *
 * Instagram never gets the removed pill: our Instagram reads cannot tell a
 * deleted post from a personal account, so nothing in the sync path writes
 * post-deleted for it. What it does get is its own, weaker pill (postNotice
 * below) when Business Discovery knows no Business or Creator account by the
 * post's handle -- a statement about the account, which is all we measured.
 */

import { lastFetchNote, type LastFetchNote } from "@/lib/metricDisplay";
import { timeAgo } from "@/lib/format";

/** The FetchReason slug syncPost treats as "gone at the source". */
export const REMOVED_FETCH_REASON = "post-deleted";

/** The Post.fetchState value that same path writes alongside it. */
export const REMOVED_FETCH_STATE = "UNAVAILABLE";

export type RemovablePost = {
  fetchState?: string | null;
  platformMetrics?: unknown;
};

export function isPostRemoved(post: RemovablePost | null | undefined): boolean {
  if (!post) return false;
  if (post.fetchState === REMOVED_FETCH_STATE) return true;
  return lastFetchNote(post.platformMetrics)?.reason === REMOVED_FETCH_REASON;
}

/**
 * The pill's wording. A single source so the grid card, the list row, the post
 * page and the shared report cannot drift into three different phrasings of the
 * same fact.
 *
 * Hedged on purpose ("may have been"): what we actually observed is that the
 * platform stopped serving the post. A creator deleting it is the common cause,
 * but a suspension or a switch to private looks identical from outside.
 */
export function removedPostLabel(): string {
  return "Post unavailable — it may have been deleted";
}

/**
 * "Last checked 3d ago", or null when we have no timestamp to stand behind.
 *
 * Accepts the note rather than the post so callers that already read it for
 * something else do not parse the bag twice.
 */
export function removedSince(note: LastFetchNote | null | undefined): string | null {
  if (!note?.at) return null;
  const at = new Date(note.at);
  if (Number.isNaN(at.getTime())) return null;
  return `Last checked ${timeAgo(at)}`;
}

/** The note behind a removal, for callers that want the timestamp too. */
export function removedNote(post: RemovablePost | null | undefined): LastFetchNote | null {
  if (!post) return null;
  const note = lastFetchNote(post.platformMetrics);
  return note?.reason === REMOVED_FETCH_REASON ? note : null;
}

/**
 * The FetchReason for an Instagram post whose handle Business Discovery knows
 * as no Business or Creator account (Graph #110).
 *
 * Its own pill rather than the removed one, because the platform said nothing
 * about the post. On 2026-09-30, 79 of the 80 posts carrying it no longer
 * existed on Instagram, so "may be gone" is the likely story; a personal
 * account with the post still up gives the identical answer, so the wording
 * names both and claims neither.
 */
export const NO_PUBLIC_NUMBERS_REASON = "not-a-professional-account";

export function noPublicNumbersLabel(): string {
  return "No Instagram numbers — the post or account may be gone";
}

export type PostNotice = { label: string; note: LastFetchNote | null };

/**
 * The pill a post carries, if any. Removal wins: it is the stronger claim and
 * the one the platform actually made. A later successful read clears
 * __lastFetch, so a post that starts sharing numbers loses its pill on the next
 * sync without anyone touching it.
 */
export function postNotice(post: RemovablePost | null | undefined): PostNotice | null {
  if (!post) return null;
  if (isPostRemoved(post)) return { label: removedPostLabel(), note: removedNote(post) };
  const note = lastFetchNote(post.platformMetrics);
  return note?.reason === NO_PUBLIC_NUMBERS_REASON ? { label: noPublicNumbersLabel(), note } : null;
}
