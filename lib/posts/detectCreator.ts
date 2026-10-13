import { db } from "@/lib/db";
import { NOT_REMOVED } from "@/lib/posts/removed";
import type { Platform } from "@/lib/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { createLogger } from "@/lib/observability/logger";
import { ensureCreatorForHandle, findExistingPosts } from "@/lib/posts/addPostChecks";
import { isUnattributedCreator, UNATTRIBUTED_CREATOR_WHERE } from "@/lib/posts/unattributedName";
import { INSTAGRAM_HANDLE_SELECT, instagramLookupHandle } from "@/lib/platforms/instagramToken";
import { findInstagramPostOwner } from "@/lib/platforms/instagramBusinessDiscovery";
import { readWithDiscoveryToken } from "@/lib/platforms/instagramDiscoveryTokens";
import { readInstagramPostPageOwner } from "@/lib/platforms/instagramPostPage";

/**
 * Finding whose post it is, for a post filed with no creator.
 *
 * A post whose link names nobody, and whose platform would not say who posted
 * it when it was added, goes under the org's Unattributed holding row
 * (lib/posts/unattributedCreator) so it is tracked at all. Nobody is ever asked
 * to fill the creator in: the agency adds links, and the app works out whose
 * they are. That is the rule, and this is where it is kept -- every read of
 * such a post tries again, four ways, cheapest first:
 *
 *   1. post-read     The read that just ran named the owner. Instagram's embed
 *                    carries the username beside the counters, and a post it
 *                    would not show at add time often shows minutes or hours
 *                    later (measured 2026-10-10: one of six such posts on prod
 *                    had come back).
 *   2. same-post     Another copy of the same post in this org already has a
 *                    creator. The same reel is routinely added to two
 *                    campaigns.
 *   3. post-page     The post's public Instagram page names its owner even when
 *                    the owner has switched embedding off, which the embed
 *                    reports exactly like a deleted post (see
 *                    lib/platforms/instagramPostPage). One plain page fetch, no
 *                    Graph quota.
 *   4. creator-media The post is in one of the campaign's own creators' newest
 *                    Instagram media. Business Discovery lists a professional
 *                    account's posts whether or not the embed will show them.
 *
 * Found, the creator is taken from the roster or added to it, exactly as for a
 * link that named its creator, and the post -- with every other unattributed
 * copy of it in the org -- moves there. The move is audited as the system's
 * doing. Not found, nothing changes and the next read asks again.
 */

export type CreatorDetectionSource = "post-read" | "same-post" | "post-page" | "creator-media";

export type CreatorDetection = {
  creatorId: string;
  /** The account name the post can now be read under. */
  handle: string;
  source: CreatorDetectionSource;
  /** The roster entry was created for this post. */
  created: boolean;
  /** Every post moved, this one first. */
  movedPostIds: string[];
};

/** How many of the campaign's creators the media lookup will ask about, per post. */
export const MAX_OWNER_CANDIDATES = 8;

type DetectInput = {
  id: string;
  postUrl: string;
  /** The owner a read just named, when one did. */
  authorHandle?: string | null;
  /** A background caller's Meta usage ceiling; see readWithDiscoveryToken. */
  stopAtPercent?: number;
  /** The whole media lookup's budget. A person waiting on an add gets less
   *  than a sweep; running out is a miss, and the next read asks again. */
  timeoutMs?: number;
};

const log = () => createLogger({ context: { module: "detectCreator" } });

function bare(handle: string | null | undefined): string {
  return (handle ?? "").trim().replace(/^@/, "");
}

/**
 * Detects and files the creator of a post that sits under the holding row.
 * Writes only a post.creator_detected audit line, which no notification
 * listens for: nothing is sent to anyone when a creator is found.
 * Null when the post is not under the holding row, or when no source could
 * name its owner this time.
 */
export async function detectPostCreator(post: DetectInput, orgId: string): Promise<CreatorDetection | null> {
  /* Never the reason a read fails. Detection rides along on a read that has
     its own job -- the counters -- and a throw here (a DB blip, a profile read
     that errored) used to be able to cost that read; now it is a miss, and the
     next read tries again. */
  try {
    return await detect(post, orgId);
  } catch (err) {
    log().warn("creator detection failed; the next read tries again", {
      postId: post.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function detect(post: DetectInput, orgId: string): Promise<CreatorDetection | null> {
  const row = await db.post.findFirst({
    where: { id: post.id, campaign: { orgId } },
    select: {
      id: true,
      campaignId: true,
      platform: true,
      creatorId: true,
      creator: { select: { name: true, handle: true } },
    },
  });
  if (!row || !isUnattributedCreator(row.creator)) return null;
  const platform = row.platform as Platform;

  const named = bare(post.authorHandle);
  if (named) {
    const { creator, created } = await ensureCreatorForHandle(orgId, named, platform);
    return file(row, orgId, post.postUrl, { creatorId: creator.id, handle: bare(creator.handle) || named, created }, "post-read");
  }

  const copy = (await findExistingPosts(orgId, post.postUrl)).find(
    (e) => e.id !== row.id && !isUnattributedCreator({ name: e.creatorName, handle: e.creatorHandle }),
  );
  if (copy) {
    return file(row, orgId, post.postUrl, { creatorId: copy.creatorId, handle: bare(copy.creatorHandle), created: false }, "same-post");
  }

  if (platform === "INSTAGRAM") {
    const pageOwner = await readInstagramPostPageOwner(post.postUrl, Math.min(post.timeoutMs ?? 6000, 6000));
    if (pageOwner) {
      const { creator, created } = await ensureCreatorForHandle(orgId, pageOwner, platform);
      return file(row, orgId, post.postUrl, { creatorId: creator.id, handle: bare(creator.handle) || pageOwner, created }, "post-page");
    }

    const owner = await findOwnerInCampaignMedia(orgId, row.campaignId, post.postUrl, {
      stopAtPercent: post.stopAtPercent,
      timeoutMs: post.timeoutMs,
    });
    if (owner) {
      return file(row, orgId, post.postUrl, { creatorId: owner.creatorId, handle: owner.handle, created: false }, "creator-media");
    }
  }
  return null;
}

/**
 * The campaign creator whose newest Instagram media holds this post, if any.
 *
 * Asks only about creators already in the campaign -- whoever has posts or an
 * activation there -- because those are the people the post was delivered by,
 * and a creator outside it would be a guess. Any failure (no token, a rate
 * limit, a slow page) is a miss for this read, not an error: the post stays
 * tracked and the next read asks again.
 */
export async function findOwnerInCampaignMedia(
  orgId: string,
  campaignId: string,
  postUrl: string,
  { stopAtPercent, timeoutMs = 20_000 }: { stopAtPercent?: number; timeoutMs?: number } = {},
): Promise<{ creatorId: string; handle: string } | null> {
  const candidates = await campaignInstagramCreators(orgId, campaignId, postUrl);
  if (candidates.length === 0) return null;

  try {
    const read = await readWithDiscoveryToken(
      (cred) =>
        findInstagramPostOwner(
          candidates.map((c) => c.handle),
          postUrl,
          cred.token,
          AbortSignal.timeout(timeoutMs),
          { rateLimitThrows: true, ...cred.graphOptions },
        ),
      { stopAtPercent, orgId },
    );
    if (!read.ok || !read.value) return null;
    const handle = read.value.handle.toLowerCase();
    const match = candidates.find((c) => c.handle.toLowerCase() === handle);
    return match ? { creatorId: match.creatorId, handle: match.handle } : null;
  } catch (err) {
    log().warn("creator media lookup did not answer; the next read asks again", {
      campaignId,
      error: err instanceof Error ? err.name : String(err),
    });
    return null;
  }
}

/** The campaign's Instagram creators, most recently active first, one entry per account name. */
async function campaignInstagramCreators(
  orgId: string,
  campaignId: string,
  postUrl: string,
): Promise<{ creatorId: string; handle: string }[]> {
  const creatorSelect = { id: true, name: true, ...INSTAGRAM_HANDLE_SELECT } as const;
  const notHolding = { orgId, deletedAt: null, NOT: UNATTRIBUTED_CREATOR_WHERE };
  const [posted, activated] = await Promise.all([
    db.post.findMany({
      where: { campaignId, campaign: { orgId }, platform: "INSTAGRAM", ...NOT_REMOVED, creator: notHolding },
      orderBy: { createdAt: "desc" },
      distinct: ["creatorId"],
      take: MAX_OWNER_CANDIDATES,
      select: { creator: { select: creatorSelect } },
    }),
    db.activation.findMany({
      where: { campaignId, deletedAt: null, creator: notHolding },
      orderBy: { updatedAt: "desc" },
      take: MAX_OWNER_CANDIDATES,
      select: { creator: { select: creatorSelect } },
    }),
  ]);

  const out: { creatorId: string; handle: string }[] = [];
  const seen = new Set<string>();
  for (const { creator } of [...posted, ...activated]) {
    if (out.length >= MAX_OWNER_CANDIDATES) break;
    const handle = bare(
      instagramLookupHandle({
        postUrl,
        profileLink: creator.profileLinks[0]?.handle,
        creatorHandle: creator.handle,
        creatorPlatform: creator.platform,
      }),
    );
    if (!handle || seen.has(handle.toLowerCase())) continue;
    seen.add(handle.toLowerCase());
    out.push({ creatorId: creator.id, handle });
  }
  return out;
}

async function file(
  row: { id: string; campaignId: string; platform: string; creatorId: string },
  orgId: string,
  postUrl: string,
  found: { creatorId: string; handle: string; created: boolean },
  source: CreatorDetectionSource,
): Promise<CreatorDetection | null> {
  /* Every unattributed copy of the same post in the org, so a reel added to
     two campaigns is not found twice. */
  const copies = (await findExistingPosts(orgId, postUrl))
    .filter((e) => e.id !== row.id && isUnattributedCreator({ name: e.creatorName, handle: e.creatorHandle }))
    .map((e) => ({ id: e.id, campaignId: e.campaignId, creatorId: e.creatorId }));
  const moved: string[] = [];
  for (const post of [row, ...copies]) {
    /* Conditional on the holding row, so a post another read has already
       filed is left where that read put it. */
    const { count } = await db.post.updateMany({
      where: { id: post.id, creatorId: post.creatorId },
      data: { creatorId: found.creatorId },
    });
    if (count === 0) continue;
    moved.push(post.id);
    await logAudit({
      orgId,
      actorType: "system:creator-detection",
      action: "post.creator_detected",
      entityType: "post",
      entityId: post.id,
      entityLabel: found.handle,
      metadata: {
        campaignId: post.campaignId,
        platform: row.platform,
        postUrl,
        source,
        creatorCreated: found.created,
      },
      before: { creatorId: post.creatorId },
      after: { creatorId: found.creatorId },
    });
  }
  if (!moved.includes(row.id)) return null;
  log().info("filed a post under the creator its platform named", {
    postId: row.id,
    source,
    copies: moved.length - 1,
    creatorCreated: found.created,
  });
  return { ...found, source, movedPostIds: moved };
}
