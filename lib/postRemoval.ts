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
 * Instagram is absent from all of this on purpose: our Instagram reads cannot
 * tell a deleted post from a private account from a throttled request, so
 * nothing in the sync path ever writes post-deleted for it. There is no
 * detection to surface, and inventing one would put a "deleted" badge on posts
 * that are still up.
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
