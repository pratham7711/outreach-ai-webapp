import { fetchInstagramEmbedPost } from "./instagramEmbed";

/**
 * Why one post could not answer, so a sweep can say something better than
 * nothing.
 *
 * The caller keeps returning null on failure -- the platform's own reason must
 * not be downgraded by a rung that is only corroboration. But null alone loses
 * the one fact worth having. MEASURED against production on 2026-09-16, over
 * 40 tracked creators walking up to twelve of their own posts each: 24
 * resolved, 8 had no post still available, 5 had every readable post owned by a
 * DIFFERENT account, and 3 had no post on record at all. Those are three
 * different jobs for whoever reads the tracker -- wait, fix the handle, or add
 * a post -- and the stored error said only "Error validating access token",
 * which is the Business Discovery failure and points at none of them.
 */
export type InstagramPostRead =
  | { ok: true; profile: CreatorProfileFromPost }
  | { ok: false; why: "post-unavailable" | "owner-mismatch" | "no-count"; owner?: string };

type CreatorProfileFromPost = {
  followersCount: number;
  postsCount: number;
  avgViews: number;
  sampledPosts: number;
};

/**
 * A tracked Instagram creator's follower count, read off one of their own posts.
 *
 * Business Discovery is the only credentialled reader we have, and it answers
 * for nobody without a Meta token and for no personal or private account even
 * with one. MEASURED on production 2026-09-15: 246 Instagram creators tracked,
 * 246 never snapshotted, every one of the 50 attempts failed -- so the follower
 * column for that platform has never once been a measurement.
 *
 * The captioned embed carries `owner.edge_followed_by.count`, needs no
 * credential, and this app already parses it for post metrics.
 * MEASURED 2026-09-15 against three tracked creators: iamswarat 113,932 /
 * danikmma1 214,412 / the_cinematic.01 55,803.
 *
 * What it cannot give is as important as what it can. The embed describes ONE
 * post, so there is no lifetime post count and no view mean behind it -- those
 * come back as 0 with sampledPosts 0, which is this codebase's existing way of
 * saying "not measured" (the snapshot column's own comment says as much, and
 * the writer only copies avgViews onto the creator when sampledPosts > 0).
 * Anything else would file a gap as a measured zero.
 */
export async function readInstagramPostForFollowers(
  handle: string,
  postUrl: string,
  signal?: AbortSignal,
): Promise<InstagramPostRead> {
  const post = await fetchInstagramEmbedPost(postUrl, signal).catch(() => null);
  /* Deleted, private, or the embed refused: the captioned page still answers
     ~222KB with "contextJSON":null, which the embed reader already turns into
     a null post. */
  if (!post) return { ok: false, why: "post-unavailable" };

  /* The post has to belong to the creator we are reading. A Post row filed
     against the wrong creator would otherwise hand that creator somebody
     else's follower count, and a follower series is exactly the thing nobody
     re-checks by eye. A post whose owner does not match is not a failure of
     this creator's read -- it is evidence about that post -- so the caller
     keeps whatever the platform said. */
  const want = handle.trim().replace(/^@/, "").toLowerCase();
  const got = post.authorHandle?.trim().replace(/^@/, "").toLowerCase();
  if (!want || !got || want !== got) {
    return { ok: false, why: "owner-mismatch", ...(got ? { owner: got } : {}) };
  }

  if (typeof post.authorFollowers !== "number" || !Number.isFinite(post.authorFollowers)) {
    return { ok: false, why: "no-count" };
  }

  return {
    ok: true,
    profile: {
      followersCount: post.authorFollowers,
      postsCount: 0,
      avgViews: 0,
      sampledPosts: 0,
    },
  };
}

/**
 * What the walk over a creator's own posts saw, as one line for the tracker.
 *
 * A note, not a reason: the platform's own failure still stands, and this only
 * says what the rung found on the way. It exists because the stored error was
 * "Error validating access token" for every unreadable Instagram creator on
 * production, which sends whoever reads it to re-authenticate Meta -- and that
 * fixes nothing for a creator whose handle was renamed or whose posts have all
 * been deleted. MEASURED 2026-09-16 over 40 tracked creators: of the 16 the
 * walk could not answer for, 3 had no post on record, 5 had every readable
 * post owned by one other account, and 8 had no post still standing. Three
 * different jobs, one indistinguishable error.
 */
export function describeInstagramPostReads(reads: InstagramPostRead[]): string {
  const tried = reads.length;
  if (tried === 0) return "no post of theirs is on record to read a follower count from";

  const failures = reads.filter((r) => !r.ok) as Extract<InstagramPostRead, { ok: false }>[];
  const owners = [...new Set(failures.flatMap((r) => (r.owner ? [r.owner] : [])))];

  /* Every post that still renders names the same other account: that is a
     rename, and the fix is one field rather than anything a sweep can do. */
  if (owners.length === 1 && failures.every((r) => r.why === "owner-mismatch")) {
    return `${tried} post(s) tried; every readable one is owned by @${owners[0]} — the handle may have been renamed`;
  }
  if (failures.every((r) => r.why === "post-unavailable")) {
    return `${tried} post(s) tried; none is still available on Instagram`;
  }
  if (owners.length > 0) {
    return `${tried} post(s) tried; none answered for this handle (saw @${owners.join(", @")})`;
  }
  return `${tried} post(s) tried; none carried a follower count`;
}
