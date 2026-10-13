import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * "Remove from campaign" is a soft remove, and this file is the one definition
 * of what that hides.
 *
 * A removed post keeps its row, its readings (PostMetricSnapshot), its fraud
 * flags and any earnings recorded against it, so an Undo -- right away from the
 * toast, or later from the Posts tab's Removed view -- brings back exactly the
 * post that went, numbers and history included. The price is that every read
 * of a campaign's posts has to leave it out, and a literal `removedAt: null`
 * pasted into forty queries is forty places to forget it. So every reader
 * spreads NOT_REMOVED (Prisma) or notRemovedSql (raw SQL), and a grep for
 * those names finds them all.
 *
 * Kept free of the database import so client code and pure helpers can use it.
 *
 * What deliberately does NOT filter on it:
 *   - lookups of one post by id (post page, its sync/track/flag routes): the
 *     post still exists and the page says it was removed;
 *   - admin/repair/platform-ops routes that count or fix rows as rows;
 *   - the creator merge, which moves every row whatever its state;
 *   - the duplicate check on add, which wants to SEE a removed copy so it can
 *     restore it instead of creating a second row (lib/posts/addPostChecks).
 */

/** Spread into a Post `where` to leave removed posts out. */
export const NOT_REMOVED = { removedAt: null } satisfies Prisma.PostWhereInput;

/** Only the removed posts -- the Posts tab's Removed view. */
export const ONLY_REMOVED = { removedAt: { not: null } } satisfies Prisma.PostWhereInput;

/**
 * NOT_REMOVED for raw SQL. `alias` is the Post table's alias in the query
 * (`p`), or omitted when the query reads "Post" unaliased. Returns a plain
 * string to interpolate into a $queryRawUnsafe string; it carries no user
 * input, so that is not an injection path. In a tagged $queryRaw write the
 * same text out instead of wrapping this in Prisma.raw(): under next dev the
 * fragment was bound as a parameter and the query failed (2026-10-14; see
 * lib/reports/campaignPerformance#campaignReportStamp). Tests pin those
 * written-out copies to this function.
 */
export function notRemovedSql(alias?: string): string {
  return `${alias ? `${alias}.` : ""}"removedAt" IS NULL`;
}

/** True when a post row (any shape carrying removedAt) was removed from its
 *  campaign. Not lib/postRemoval#isPostRemoved, which is the PLATFORM saying
 *  the post is gone -- a different fact with a different badge. */
export function isRemovedFromCampaign(post: { removedAt?: Date | string | null } | null | undefined): boolean {
  return post?.removedAt != null;
}

/**
 * What a write on one removed post answers (sync, track, approve/reject): 409
 * with this body. Those routes look the post up by id, which still finds it,
 * so without the refusal a stale tab could read or approve a post the
 * campaign no longer shows -- and a sync would quietly start reading it again.
 */
export const REMOVED_POST_REFUSAL = {
  error: "post_removed",
  message: "This post was removed from the campaign. Restore it to change it.",
} as const;
