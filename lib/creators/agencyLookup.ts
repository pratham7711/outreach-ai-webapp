import { db } from "@/lib/db";
import { stripAt } from "@/lib/format";
import { readCreatorProfile, type CreatorReadFailure } from "@/lib/platforms/creatorProfile";
import { getAgencyDiscoveryCredential } from "@/lib/platforms/instagramAgencyCredential";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { recordPlatformAccountId } from "@/lib/creators/accountIds";
import { captureLatestAvatar } from "@/lib/creators/avatarStore";
import { SOURCE_PROFILE_READ, SOURCE_TRACKER_READ, type FigureTime } from "@/lib/creators/figureTime";

export type AddCreatorLookup =
  | {
      ok: true;
      followersCount: number;
      postsCount: number;
      avgViews: number | null;
      /** Set when the org's own Instagram account answered. */
      via: { username: string } | null;
    }
  | { ok: false; reason: CreatorReadFailure };

/**
 * Add creator, for an org that has connected its own Instagram account: the
 * handle is looked up through that account at once, and its public figures
 * land on the new creator the way the daily profile read would put them there.
 *
 * Null for every other org and platform, which add a creator exactly as before
 * and wait for the scheduled reads. A figure typed into the form is kept.
 */
export async function lookupNewCreatorViaAgency(input: {
  orgId: string;
  creatorId: string;
  platform: string;
  handle: string;
  typedFollowers?: number | null;
  typedViews?: number | null;
  now?: Date;
}): Promise<AddCreatorLookup | null> {
  if (input.platform !== "INSTAGRAM") return null;
  if (!(await getAgencyDiscoveryCredential(input.orgId))) return null;

  const handle = stripAt(input.handle).trim();
  if (!handle) return null;
  const read = await readCreatorProfile("INSTAGRAM", handle, { orgId: input.orgId });
  if (!read.ok) return { ok: false, reason: read.reason };

  const now = input.now ?? new Date();
  const { followersCount, postsCount, avgViews, sampledPosts, avatarUrl } = read.profile;
  const views = sampledPosts > 0 ? { averageViews: avgViews } : {};
  const where = { id: input.creatorId, orgId: input.orgId };

  await db.creator.updateMany({
    where,
    data: {
      ...(input.typedFollowers ? {} : { followersCount }),
      ...(input.typedViews ? {} : views),
    },
  });
  if (await rosterTablesReady()) {
    await db.creatorProfileLink.createMany({
      data: [
        {
          creatorId: input.creatorId,
          orgId: input.orgId,
          platform: "INSTAGRAM",
          handle,
          url: `https://www.instagram.com/${handle}/`,
          followersCount,
          ...views,
          isPrimary: true,
          refreshedAt: now,
        },
      ],
      skipDuplicates: true,
    });
  }
  await recordPlatformAccountId({
    creatorId: input.creatorId,
    orgId: input.orgId,
    platform: "INSTAGRAM",
    handle,
    profile: read.profile,
    source: "profile-refresh",
    now,
  });
  await captureLatestAvatar(where, avatarUrl, now.getTime()).catch(() => false);

  return {
    ok: true,
    followersCount,
    postsCount,
    avgViews: sampledPosts > 0 ? avgViews : null,
    via: read.via ?? null,
  };
}

/**
 * The org's own Instagram account, when it is what read this figure: a public
 * read of an Instagram account, dated after the account was connected. While
 * an org's account works its reads use no other, and a rejected one is
 * stamped expired at once, so the date decides.
 */
export async function readThroughOwnAccount(
  orgId: string,
  platform: string,
  figure: Pick<FigureTime, "at" | "source">,
): Promise<{ username: string } | null> {
  if (platform !== "INSTAGRAM" || !figure.at) return null;
  if (figure.source !== SOURCE_PROFILE_READ && figure.source !== SOURCE_TRACKER_READ) return null;
  const own = await getAgencyDiscoveryCredential(orgId);
  return own && figure.at >= own.connectedAt ? { username: own.username } : null;
}
