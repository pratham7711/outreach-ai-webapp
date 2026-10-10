import { db } from "@/lib/db";
import type { Platform } from "@/lib/generated/prisma/client";
import { UNATTRIBUTED_CREATOR_NAMES, UNATTRIBUTED_CREATOR_WHERE, isUnattributedCreator, unattributedCreatorName } from "@/lib/posts/unattributedName";

export { UNATTRIBUTED_CREATOR_NAMES, UNATTRIBUTED_CREATOR_WHERE, isUnattributedCreator, unattributedCreatorName };

/**
 * Where a post goes when nobody can say who posted it.
 *
 * Adding a post is a request to track it. It used to stop and ask for a creator
 * whenever neither the link nor the platform named one -- an Instagram reel URL
 * carries no handle, and Instagram's public embed names nobody for a post it
 * calls removed or private (MEASURED 2026-10-05 on the three links an operator
 * retried four times that day: the embed said "the post may have been removed"
 * and Instagram's oEmbed answered 403). There was nothing the operator could
 * type that the platform would confirm, so the question only ever cost them the
 * post.
 *
 * `Post.creatorId` is required, and every report, export and per-creator total
 * reads `post.creator` -- 73 type errors across 21 files when it was made
 * optional, plus raw SQL that would silently drop such posts from totals. So
 * the post is filed under one holding row per org and platform instead. It is a
 * roster row, so every total keeps counting the post's views, and it is never
 * tracked, never read by handle and never mailed:
 *
 *   - `handle` is "" and `trackedSince` is null, which keeps it out of the
 *     tracker sweep, top posts and the canary (all filter trackedSince), and out
 *     of every profile read (all of them skip an empty handle).
 *   - no contactEmail and no creatorUser, so nothing can reach it.
 *   - the avatar refresh and the post sync's follower write exclude it by
 *     UNATTRIBUTED_CREATOR_WHERE, because both would otherwise copy one real
 *     author's picture or follower count onto it.
 *
 * Identified by the empty handle AND the exact reserved name, not either alone,
 * so a roster row that merely lacks a handle is never mistaken for it.
 */

const NOTE =
  "Holds posts added without a known creator: the link named nobody and the platform would not say who posted them. Not a real account, and never tracked.";

/**
 * The org's holding row for this platform, created on first use.
 *
 * A pasted batch is submitted ten at a time, so two unattributed links can ask
 * for the same missing row in the same instant. The schema has no unique
 * constraint to lean on, so the create runs under a transaction-scoped advisory
 * lock keyed on the org and platform: the second caller waits, then finds the
 * row the first one made. Transaction-scoped on purpose -- it is released at
 * commit, so nothing outlives the request on a pooled connection.
 */
export async function getUnattributedCreator(
  orgId: string,
  platform: Platform,
): Promise<{ id: string; name: string; handle: string }> {
  const name = unattributedCreatorName(platform);
  const where = { orgId, platform, handle: "", name, deletedAt: null };
  const select = { id: true, name: true, handle: true } as const;

  const existing = await db.creator.findFirst({ where, orderBy: { id: "asc" }, select });
  if (existing) return existing;

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`unattributed-creator:${orgId}:${platform}`}))) AS held`;
    const again = await tx.creator.findFirst({ where, orderBy: { id: "asc" }, select });
    if (again) return again;
    return tx.creator.create({ data: { orgId, platform, handle: "", name, notes: NOTE }, select });
  });
}
