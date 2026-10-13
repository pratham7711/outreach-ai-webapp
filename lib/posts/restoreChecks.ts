import { db } from "@/lib/db";
import { postVideoKey } from "@/lib/posts/duplicates";
import { NOT_REMOVED } from "@/lib/posts/removed";

/**
 * The removed posts that cannot come back because the campaign already holds
 * a live copy of the same post.
 *
 * The add route restores a removed copy rather than creating a second row
 * (POST .../posts), so this is normally empty. It is not always: the
 * CreatorCore importer, the creator portal's submissions and any row added
 * before the soft remove existed all create rows without asking. Restoring a
 * post beside its own live copy would count its views twice in this campaign
 * -- the one duplicate the add route refuses -- so the restore refuses it too.
 *
 * Identity is postVideoKey (the platform's video id read out of the URL), the
 * same key the org totals use to count each video once, because platformPostId
 * is not reliable across importers (lib/posts/duplicates).
 */
export async function duplicateLiveCopies(
  campaignId: string,
  removed: readonly { id: string; platform: string; postUrl: string }[],
): Promise<string[]> {
  if (removed.length === 0) return [];
  const live = await db.post.findMany({
    where: { campaignId, ...NOT_REMOVED },
    select: { platform: true, postUrl: true },
  });
  const liveKeys = new Set(live.map((p) => postVideoKey(p.platform, p.postUrl)));
  /* A key is claimed as each post is admitted, so two removed copies of one
     video in the same selection cannot both come back either. */
  const clashes: string[] = [];
  for (const post of removed) {
    const key = postVideoKey(post.platform, post.postUrl);
    if (liveKeys.has(key)) clashes.push(post.id);
    else liveKeys.add(key);
  }
  return clashes;
}
