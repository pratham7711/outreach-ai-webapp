import { db } from "@/lib/db";
import type { Platform } from "@/lib/generated/prisma/client";
import { readCreatorProfile, type CreatorReadResult } from "@/lib/platforms/creatorProfile";
import { TRACKER_SWEEP_STOP_PERCENT } from "@/lib/platforms/instagramDiscoveryTokens";
import { captureLatestAvatar } from "@/lib/creators/avatarStore";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { recordPlatformAccountId } from "@/lib/creators/accountIds";
import { protectedCreatorFollowers } from "@/lib/creators/followerWriter";
import { createLogger } from "@/lib/observability/logger";

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
 * no longer exists cannot hold the head of the queue.
 */

export const PROFILE_REFRESH_MS = 24 * 60 * 60 * 1000;

const READABLE: Platform[] = ["TIKTOK", "INSTAGRAM", "YOUTUBE"];

export type ProfileRefreshCounts = {
  considered: number;
  refreshed: number;
  failed: number;
  avatars: number;
  skipped: number;
};

export async function refreshRosterProfiles({
  limit = 150,
  deadlineMs = 4 * 60 * 1000,
  readTikTokProfileRemote,
  nowMs = Date.now(),
}: {
  limit?: number;
  deadlineMs?: number;
  readTikTokProfileRemote?: (handle: string) => Promise<CreatorReadResult>;
  nowMs?: number;
} = {}): Promise<ProfileRefreshCounts> {
  const log = createLogger({ context: { job: "refresh-roster-profiles" } });
  const counts: ProfileRefreshCounts = { considered: 0, refreshed: 0, failed: 0, avatars: 0, skipped: 0 };
  if (!(await rosterTablesReady())) {
    log.warn("roster tables missing; apply /api/admin/migrate-creator-roster");
    return counts;
  }

  const deadline = Date.now() + deadlineMs;
  const due = await db.creatorProfileLink.findMany({
    where: {
      platform: { in: READABLE },
      creator: { deletedAt: null },
      OR: [{ refreshedAt: null }, { refreshedAt: { lt: new Date(nowMs - PROFILE_REFRESH_MS) } }],
    },
    orderBy: [{ refreshedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: limit,
    select: { id: true, creatorId: true, orgId: true, platform: true, handle: true, isPrimary: true },
  });

  // A platform that says "too many requests" is left alone for the rest of the
  // run: its limit is app-wide, so every further read spends quota the
  // campaign post sync needs, and the account is simply due again next hour.
  const limited = new Set<string>();

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

    const { followersCount, avgViews, sampledPosts, avatarUrl } = read.profile;
    // A mean over no posts is not a measurement; keep what is held.
    const views = sampledPosts > 0 ? { averageViews: avgViews } : {};
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
        if (sampledPosts > 0) await db.creator.update({ where, data: views });
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
