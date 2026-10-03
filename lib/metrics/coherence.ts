/**
 * The one rule every post counter writer applies: nothing that was engaged with
 * more often than it was viewed.
 *
 * A like, a comment, a share and a save each need a view first, so a reading
 * where any of them exceeds views has at least one wrong number in it. Two ways
 * it reached production, both measured:
 *
 *  - a live read. TikTok's rehydration parser sometimes returns a neighbouring
 *    video's stats -- three unrelated videos came back with likes clustered at
 *    1,084-1,092 over 313-836 views (b52f8ba). There the LIKES were the wrong
 *    number, so a live reading that contradicts itself is refused whole.
 *  - the CreatorCore import. 191 TikTok videos on 2026-10-03, every one from
 *    cc-apply-stats, with likes a median 2.7x views against 0.07x on the other
 *    13,361 imported videos, and no sign of the neighbour clustering (likes
 *    shared with another post in the campaign: 9.6% against 17% elsewhere).
 *    There the VIEWS were the wrong number -- a counter TikTok stopped moving --
 *    so an import keeps its engagement and records views as unknown.
 *
 * Views are compared only when they are known. A reading that carried no views
 * (an Instagram image, an embed) says nothing about the others.
 */

export type EngagementCounts = {
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
};

/** True when views are a number and some engagement counter is larger. */
export function engagementExceedsViews(views: number | null | undefined, counts: EngagementCounts): boolean {
  if (typeof views !== "number") return false;
  return [counts.likes, counts.comments, counts.shares, counts.saves].some(
    (n) => typeof n === "number" && n > views,
  );
}

/** The same test over a reading or a row in column names. */
export function countsContradict(c: {
  viewsCount?: number | null;
  likesCount?: number | null;
  commentsCount?: number | null;
  sharesCount?: number | null;
  savesCount?: number | null;
}): boolean {
  return engagementExceedsViews(c.viewsCount, {
    likes: c.likesCount,
    comments: c.commentsCount,
    shares: c.sharesCount,
    saves: c.savesCount,
  });
}
