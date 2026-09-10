import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";
import type { OAuthPlatform, PlatformEnumValue } from "@/lib/oauth/providers";
import { fetchTikTokUserInfo } from "./tiktokDisplay";
import { fetchInstagramAccount } from "./instagramAccount";
import { fetchInstagramLoginProfile } from "./instagramLogin";
import { fetchYouTubeChannel } from "./youtube";
import { fetchFacebookPage } from "./facebookPage";
import { fetchThreadsProfile } from "./threads";

/**
 * One shape for "who this connected account is", and one place that writes it.
 *
 * Before this existed only TikTok fetched an identity after OAuth, and it wrote
 * the result onto the `Creator` row — `platformUserId`, `followersCount`,
 * `avatarUrl`, `bio`. Creator holds exactly one of each, so the second platform
 * a creator connected would have overwritten the first one's identity.
 *
 * Every platform now resolves an identity, and it is persisted on the
 * creator's own `CreatorSocialAccount` row. The identity is also what makes
 * several accounts on ONE platform possible: `platformUserId` is part of that
 * table's unique key, so it is what distinguishes a creator's second TikTok
 * handle from a reconnect of their first.
 */

export type AccountIdentity = {
  /** The real handle at the platform, never the portal username. */
  handle: string;
  platformUserId: string | null;
  avatarUrl: string | null;
  bio: string | null;
  profileUrl: string | null;
  isVerified: boolean;
  /**
   * `null` means the platform would not tell us — a YouTube channel hiding its
   * subscriber count — and is not the same as a real zero.
   */
  followersCount: number | null;
  followingCount: number | null;
  mediaCount: number | null;
  totalLikes: number | null;
};

/**
 * Reads the account behind a freshly authorised token.
 *
 * Returns null when the platform gave us nothing usable. The OAuth callback
 * treats that as a failed connection and stores nothing, because
 * `platformUserId` is part of the account's unique key: a row without one
 * cannot be told apart from the creator's other accounts on that platform, and
 * every reconnect would add another undistinguishable duplicate.
 */
export async function fetchAccountIdentity(
  platform: OAuthPlatform,
  token: string,
): Promise<AccountIdentity | null> {
  if (platform === "tiktok") {
    const info = await fetchTikTokUserInfo(token);
    if (!info) return null;
    return {
      handle: info.username,
      platformUserId: info.openId,
      avatarUrl: info.avatarUrl,
      bio: info.bio,
      profileUrl: info.profileLink,
      isVerified: info.isVerified,
      followersCount: info.followerCount,
      followingCount: info.followingCount,
      mediaCount: info.videoCount,
      totalLikes: info.likesCount,
    };
  }

  if (platform === "instagram") {
    const info = await fetchInstagramAccount(token);
    if (!info) return null;
    return {
      handle: info.username,
      platformUserId: info.igUserId,
      avatarUrl: info.avatarUrl,
      bio: info.bio,
      profileUrl: info.profileLink,
      isVerified: info.isVerified,
      followersCount: info.followerCount,
      followingCount: info.followingCount,
      mediaCount: info.mediaCount,
      /* Instagram publishes no lifetime like total for an account, so this
         stays null rather than being summed from a 12-post sample and
         presented as a career figure. */
      totalLikes: null,
    };
  }

  if (platform === "instagram-login") {
    const info = await fetchInstagramLoginProfile(token);
    if (!info) return null;
    return {
      handle: info.username,
      /* The Instagram account id, the same value the Page path stores — so the
         same account connected either way updates one row instead of creating
         a second one that double-counts the creator's followers. */
      platformUserId: info.igUserId,
      avatarUrl: info.avatarUrl,
      bio: info.bio,
      profileUrl: info.profileLink,
      isVerified: info.isVerified,
      followersCount: info.followerCount,
      followingCount: info.followingCount,
      mediaCount: info.mediaCount,
      /* No lifetime like total on either Instagram path. */
      totalLikes: null,
    };
  }

  if (platform === "youtube") {
    const info = await fetchYouTubeChannel(token);
    if (!info) return null;
    return {
      handle: info.username,
      platformUserId: info.channelId,
      avatarUrl: info.avatarUrl,
      bio: info.bio,
      profileUrl: info.profileLink,
      isVerified: info.isVerified,
      followersCount: info.followerCount,
      /* YouTube exposes no subscription count for the authorised channel. */
      followingCount: null,
      mediaCount: info.mediaCount,
      totalLikes: null,
    };
  }

  if (platform === "facebook") {
    const info = await fetchFacebookPage(token);
    if (!info) return null;
    return {
      handle: info.username,
      platformUserId: info.pageId,
      avatarUrl: info.avatarUrl,
      bio: info.bio,
      profileUrl: info.profileLink,
      isVerified: info.isVerified,
      followersCount: info.followerCount,
      /* A Page follows nothing, publishes no post count, and has no lifetime
         reaction total — three fields Facebook simply does not answer. */
      followingCount: null,
      mediaCount: info.mediaCount,
      totalLikes: null,
    };
  }

  if (platform === "threads") {
    const info = await fetchThreadsProfile(token);
    if (!info) return null;
    return {
      handle: info.username,
      platformUserId: info.threadsUserId,
      avatarUrl: info.avatarUrl,
      bio: info.bio,
      profileUrl: info.profileLink,
      isVerified: info.isVerified,
      followersCount: info.followerCount,
      followingCount: null,
      mediaCount: info.mediaCount,
      totalLikes: null,
    };
  }

  return null;
}

/**
 * The identity columns as a Prisma write payload.
 *
 * Shared by the OAuth callback's create and update branches and by any later
 * stats refresh, so the mapping from platform response to columns lives once.
 *
 * A `null` counter is written through as null, so "the platform would not say"
 * stays distinguishable from a real zero. `followersCount` is the exception:
 * the column predates this module, is non-nullable, and is read by the
 * agency-side roster and stats queries, so a null leaves whatever was there
 * rather than forcing a 0 over it.
 */
export function identityWriteData(identity: AccountIdentity) {
  return {
    ...(identity.handle ? { handle: identity.handle } : {}),
    platformUserId: identity.platformUserId,
    avatarUrl: identity.avatarUrl,
    bio: identity.bio,
    profileUrl: identity.profileUrl,
    isVerified: identity.isVerified,
    ...(identity.followersCount !== null
      ? { followersCount: identity.followersCount }
      : {}),
    followingCount: identity.followingCount,
    mediaCount: identity.mediaCount,
    totalLikes: identity.totalLikes,
    statsSyncedAt: new Date(),
  };
}

/** Refreshes the stored identity and stats for an account already connected. */
export async function persistAccountIdentity(
  accountId: string,
  identity: AccountIdentity,
): Promise<void> {
  await db.creatorSocialAccount.update({
    where: { id: accountId },
    data: identityWriteData(identity),
  });
}

/**
 * Reads the account behind a token and writes it onto an existing row.
 *
 * Never throws: a refresh that fails must not disturb a working connection.
 */
export async function refreshAccountIdentity(
  platform: OAuthPlatform,
  platformEnum: PlatformEnumValue,
  accountId: string,
  token: string,
): Promise<AccountIdentity | null> {
  const log = createLogger({
    context: { platform: platformEnum, call: "account.refresh" },
  });
  try {
    const identity = await fetchAccountIdentity(platform, token);
    if (!identity) {
      log.warn("No identity could be read for a connected account", { accountId });
      return null;
    }
    await persistAccountIdentity(accountId, identity);
    return identity;
  } catch (err) {
    log.warn("Identity refresh failed", {
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
