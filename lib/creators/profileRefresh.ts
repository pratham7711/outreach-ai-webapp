import { db } from "@/lib/db";
import type { Platform } from "@/lib/generated/prisma/client";
import { readCreatorProfile, type CreatorReadResult } from "@/lib/platforms/creatorProfile";
import { embedHtmlVia, readTikTokTopPostsEmbed } from "@/lib/platforms/tiktokTopPostsEmbed";
import { TRACKER_SWEEP_STOP_PERCENT } from "@/lib/platforms/instagramDiscoveryTokens";
import { captureLatestAvatar } from "@/lib/creators/avatarStore";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { boundAccountIds, recordPlatformAccountId } from "@/lib/creators/accountIds";
import { describeVerdict, logVerdict, validateReading } from "@/lib/acquisition/validate";
import { protectedCreatorFollowers } from "@/lib/creators/followerWriter";
import { createLogger } from "@/lib/observability/logger";
import { DEAD_ACCOUNT_RECHECK_MS, HANDLE_PROBLEM_WHERE } from "@/lib/creators/handleCheck";

/**
 * Keeps every roster account's follower count and picture current.
 *
 * One read per account per day gives both: the profile page that carries the
 * follower count also carries the picture, so the picture costs an image
 * download only when the picture is new or stale (captureLatestAvatar), never a
 * second platform call. The primary account's figures are also written onto
 * the Creator row, which is what every list and table reads.
 *
 * The tracker sweep reads tracked creators four times a day for trends; this is
 * the lighter pass for everyone else on the roster, who only need to be right
 * when someone opens the page. Accounts are taken least recently read first,
 * so a big import is worked through across runs and then settles into a daily
 * rotation. A failed read is stamped too and waits a day, so an account that
 * no longer exists cannot hold the head of the queue -- and a week when the
 * platform said the account is gone, since asking daily changes nothing.
 */

export const PROFILE_REFRESH_MS = 24 * 60 * 60 * 1000;

const READABLE: Platform[] = ["TIKTOK", "INSTAGRAM", "YOUTUBE"];

/* Consecutive empty embed reads before the rest of the run stops asking. Five,
   as the post reader's worker lane does: one account with no public videos is
   ordinary, five in a row is TikTok refusing the egress, and every further read
   would spend the run's clock on the same refusal. */
export const EMBED_GIVE_UP_STREAK = 5;

export type ProfileRefreshCounts = {
  considered: number;
  refreshed: number;
  failed: number;
  avatars: number;
  skipped: number;
  /** TikTok accounts whose Avg. views came from their embed page this run. */
  embedViews: number;
  /** Reads the validation gate refused (plan A3): nothing written, the stored figures kept. */
  rejected: number;
};

export async function refreshRosterProfiles({
  limit = 150,
  deadlineMs = 4 * 60 * 1000,
  readTikTokProfileRemote,
  readTikTokEmbedHtml,
  nowMs = Date.now(),
}: {
  limit?: number;
  deadlineMs?: number;
  readTikTokProfileRemote?: (handle: string) => Promise<CreatorReadResult>;
  /** TikTok's embed page from an egress it answers, for the views the profile page lacks. */
  readTikTokEmbedHtml?: (handle: string) => Promise<string | null>;
  nowMs?: number;
} = {}): Promise<ProfileRefreshCounts> {
  const log = createLogger({ context: { job: "refresh-roster-profiles" } });
  const counts: ProfileRefreshCounts = { considered: 0, refreshed: 0, failed: 0, avatars: 0, skipped: 0, embedViews: 0, rejected: 0 };
  if (!(await rosterTablesReady())) {
    log.warn("roster tables missing; apply /api/admin/migrate-creator-roster");
    return counts;
  }

  const deadline = Date.now() + deadlineMs;
  const due = await db.creatorProfileLink.findMany({
    where: {
      platform: { in: READABLE },
      creator: { deletedAt: null },
      /* An account the platform says is gone waits a week, not a day (see
         DEAD_ACCOUNT_RECHECK_MS). The OR spells out a NULL refreshError rather
         than leaving it to NOT, which a NULL would turn false. */
      OR: [
        { refreshedAt: null },
        { refreshedAt: { lt: new Date(nowMs - DEAD_ACCOUNT_RECHECK_MS) } },
        {
          refreshedAt: { lt: new Date(nowMs - PROFILE_REFRESH_MS) },
          OR: [{ refreshError: null }, { NOT: HANDLE_PROBLEM_WHERE }],
        },
      ],
    },
    orderBy: [{ refreshedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: limit,
    select: {
      id: true,
      creatorId: true,
      orgId: true,
      platform: true,
      handle: true,
      isPrimary: true,
      /* The figures already held, read only for the validation gate below. */
      followersCount: true,
      averageViews: true,
      creator: { select: { trackedSince: true, followersCount: true, averageViews: true } },
    },
  });

  // A platform that says "too many requests" is left alone for the rest of the
  // run: its limit is app-wide, so every further read spends quota the
  // campaign post sync needs, and the account is simply due again next hour.
  const limited = new Set<string>();
  let embedMisses = 0;

  for (let i = 0; i < due.length; i++) {
    if (Date.now() > deadline) {
      counts.skipped += due.length - i;
      break;
    }
    const link = due[i];
    if (limited.has(link.platform)) {
      counts.skipped++;
      continue;
    }
    counts.considered++;
    const now = new Date(nowMs);

    let read: CreatorReadResult = await readCreatorProfile(link.platform, link.handle, {
      instagramStopAtPercent: TRACKER_SWEEP_STOP_PERCENT,
      orgId: link.orgId,
    }).catch(
      (e): CreatorReadResult => ({ ok: false, reason: "unreadable", detail: String(e) }),
    );
    // Function egress gets TikTok's login shell; the sandbox gets the page.
    if (!read.ok && link.platform === "TIKTOK" && readTikTokProfileRemote) {
      const remote = await readTikTokProfileRemote(link.handle).catch(() => null);
      if (remote) read = remote;
    }

    if (!read.ok && read.reason === "rate-limited") {
      limited.add(link.platform);
      counts.skipped++;
      continue;
    }

    if (!read.ok) {
      counts.failed++;
      await db.creatorProfileLink.update({
        where: { id: link.id },
        data: { refreshedAt: now, refreshError: read.detail ? `${read.reason}: ${read.detail}`.slice(0, 500) : read.reason },
      });
      continue;
    }

    const { followersCount, avatarUrl } = read.profile;
    let { avgViews, sampledPosts } = read.profile;
    /* TikTok's profile page carries the follower count but no per-video views,
       so on its own this read never measured a TikTok average: 59 of LKM's
       roster rows showed none (prod, 2026-10-03), every one an untracked
       creator nothing else reads. The embed page lists their recent videos
       with play counts -- the tracker's own source -- so the average comes
       from there. A tracked creator is skipped: the tracker already reads it. */
    if (
      link.platform === "TIKTOK" &&
      sampledPosts === 0 &&
      !link.creator.trackedSince &&
      embedMisses < EMBED_GIVE_UP_STREAK &&
      Date.now() <= deadline
    ) {
      const embed = await readTikTokTopPostsEmbed(link.handle, (h) => embedHtmlVia(h, readTikTokEmbedHtml)).catch(() => null);
      if (embed && embed.sampledPosts > 0) {
        avgViews = embed.avgViews;
        sampledPosts = embed.sampledPosts;
        embedMisses = 0;
        counts.embedViews++;
      } else {
        embedMisses++;
      }
    }
    /* The shared validation gate (plan A3, lib/acquisition/validate). This is
       the busiest follower writer in the product -- every roster account,
       daily -- and it used to take whatever the page said: a login shell's 0
       over a real figure, or the audience of whoever holds a handle now that
       the creator renamed. Judged against the link's own figures, or for the
       primary account the creator's when the link was never read. A refusal
       is stamped like a failed read (refreshError, so the age on the creator
       page says "last read failed") and waits a day; the figures stay. */
    const bound = read.profile.accountId
      ? await boundAccountIds({ creatorId: link.creatorId, platform: link.platform, handle: link.handle })
      : null;
    const held = (own: number | null, creator: number | null) => (own !== null && own > 0 ? own : link.isPrimary ? creator : own);
    const verdict = validateReading(
      {
        kind: "creator",
        platform: link.platform,
        ...(read.profile.accountId ? { accountId: read.profile.accountId } : {}),
        counts: { followers: followersCount, ...(sampledPosts > 0 ? { avgViews } : {}) },
      },
      {
        platform: link.platform,
        boundAccountIds: bound,
        counts: {
          followers: held(link.followersCount, link.creator.followersCount),
          avgViews: held(link.averageViews, link.creator.averageViews),
        },
      },
    );
    logVerdict(
      { writer: "profile-refresh", kind: "creator", platform: link.platform, rowId: link.id, orgId: link.orgId },
      verdict,
    );
    if (verdict.rejected) {
      counts.rejected++;
      await db.creatorProfileLink.update({
        where: { id: link.id },
        data: { refreshedAt: now, refreshError: `reading-rejected: ${describeVerdict(verdict)}`.slice(0, 500) },
      });
      continue;
    }
    /* A mean over no posts is not a measurement, and one the gate dropped is
       not one either; keep what is held. */
    const views = sampledPosts > 0 && !verdict.dropFields.includes("avgViews") ? { averageViews: avgViews } : {};
    await db.creatorProfileLink.update({
      where: { id: link.id },
      data: { followersCount, ...views, refreshedAt: now, refreshError: null },
    });
    /* The account's stable id, from this same read (plan A4). Never throws and
       never reads anything itself; a missing table or id writes nothing. */
    await recordPlatformAccountId({
      creatorId: link.creatorId,
      orgId: link.orgId,
      platform: link.platform,
      handle: link.handle,
      profile: read.profile,
      source: "profile-refresh",
      now,
    });
    if (link.isPrimary) {
      const where = { id: link.creatorId, orgId: link.orgId };
      /* This read is public, so it yields to the creator's own connection
         (plan A7): a connected figure the tracker put on the row inside its
         freshness window stays, and only the averages land. The WHERE decides
         whether the row still holds that figure at the moment of the write, so
         one typed or read over it since is not protected. */
      const keep = await protectedCreatorFollowers(link.creatorId, now);
      if (keep === null) {
        await db.creator.update({ where, data: { followersCount, ...views } });
      } else {
        await db.creator.updateMany({ where: { ...where, NOT: { followersCount: keep } }, data: { followersCount } });
        if ("averageViews" in views) await db.creator.update({ where, data: views });
      }
      if (await captureLatestAvatar({ id: link.creatorId, orgId: link.orgId }, avatarUrl, nowMs).catch(() => false)) {
        counts.avatars++;
      }
    }
    counts.refreshed++;
  }

  log.info("roster profile refresh complete", { ...counts, due: due.length });
  return counts;
}
