/**
 * The audience a campaign's posts were put in front of: the latest follower
 * count of every creator who has posted on it.
 *
 * A follower count of 0 is how an unread count is stored on Creator, so it is
 * treated as unknown and left out rather than summed in. `counted` and
 * `posting` let the tile say how much of the roster the figure covers.
 */
export function followersReached(
  roster: readonly { posts: number; creator: { followersCount: number | null } }[],
): { followers: number; counted: number; posting: number } {
  let followers = 0;
  let counted = 0;
  let posting = 0;
  for (const row of roster) {
    if (row.posts <= 0) continue;
    posting += 1;
    const n = row.creator.followersCount;
    if (n == null || !Number.isFinite(n) || n <= 0) continue;
    followers += n;
    counted += 1;
  }
  return { followers, counted, posting };
}
