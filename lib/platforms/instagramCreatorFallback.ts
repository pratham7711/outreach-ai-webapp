import { fetchInstagramEmbedPost } from "./instagramEmbed";
import type { CreatorReadResult } from "./creatorProfile";

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
export async function readInstagramFollowersFromPost(
  handle: string,
  postUrl: string,
  signal?: AbortSignal,
): Promise<CreatorReadResult | null> {
  const post = await fetchInstagramEmbedPost(postUrl, signal).catch(() => null);
  if (!post) return null;

  /* The post has to belong to the creator we are reading. A Post row filed
     against the wrong creator would otherwise hand that creator somebody
     else's follower count, and a follower series is exactly the thing nobody
     re-checks by eye. A post whose owner does not match is not a failure of
     this creator's read -- it is evidence about that post -- so the caller
     keeps whatever the platform said. */
  const want = handle.trim().replace(/^@/, "").toLowerCase();
  const got = post.authorHandle?.trim().replace(/^@/, "").toLowerCase();
  if (!want || !got || want !== got) return null;

  if (typeof post.authorFollowers !== "number" || !Number.isFinite(post.authorFollowers)) {
    return null;
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
