import { db } from "@/lib/db";
import { accountIdTablesReady } from "@/lib/creators/accountIdTables";
import { createLogger } from "@/lib/observability/logger";
import type { CreatorProfileRead } from "@/lib/platforms/creatorProfile";

/**
 * Keeps a creator's account id beside its handle (plan A4).
 *
 * Called from the two readers that already hold a fresh profile -- the daily
 * roster refresh and the tracker sweep -- with the ids that same read carried
 * (TikTok's user.id and secUid from the profile page, Instagram's user id from
 * Business Discovery, YouTube's channel id from channels.list). It never reads
 * a platform itself, so it costs no request, and it never throws: a read that
 * worked is not allowed to fail because the id could not be kept. Absent
 * table, absent id, or a write error all end the same way -- nothing written,
 * the read untouched.
 *
 * One row per (creator, platform, id): a creator who renames keeps the row and
 * its handle column moves on; an account that is genuinely a different one (the
 * id changed under the same handle) gets a second row, which is exactly the
 * evidence a rename-vs-replacement question needs -- and is logged as it lands.
 *
 * YouTube also keeps its channel id on Creator.platformUserId, which is what
 * the sweep reads it back from; the row here is the history that column lacks.
 */
const KEPT: ReadonlySet<string> = new Set(["TIKTOK", "INSTAGRAM", "YOUTUBE"]);

const bareHandle = (h: string | null | undefined) => (h ? h.trim().replace(/^@/, "").toLowerCase() : "");

/**
 * The id this creator's handle belonged to before, when a read of the same
 * handle has just met a different account: the account that was tracked was
 * renamed or deleted, and someone else holds its name now. Null when the
 * account is one already seen, when the handle was edited in between (a
 * correction is not a replacement), and on any error.
 *
 * Reported, not acted on. A creator who deleted their account and opened a
 * new one under the same name is still the creator the agency is tracking,
 * and only a person can tell the two cases apart.
 */
export async function previousAccountUnderHandle(s: {
  creatorId: string;
  platform: string;
  handle?: string | null;
  accountId: string;
}): Promise<string | null> {
  try {
    const rows = await db.creatorPlatformAccountId.findMany({
      where: { creatorId: s.creatorId, platform: s.platform as never },
      select: { platformAccountId: true, handle: true },
      orderBy: { lastSeenAt: "desc" },
    });
    if (rows.some((r) => r.platformAccountId === s.accountId)) return null;
    const handle = bareHandle(s.handle);
    return rows.find((r) => handle && bareHandle(r.handle) === handle)?.platformAccountId ?? null;
  } catch {
    return null;
  }
}

export type AccountIdSighting = {
  creatorId: string;
  orgId: string;
  platform: string;
  handle?: string | null;
  profile: Pick<CreatorProfileRead, "accountId" | "secUid">;
  /** Which reader saw it: "profile-refresh" or "tracker". */
  source: string;
  now?: Date;
};

export async function recordPlatformAccountId(s: AccountIdSighting): Promise<boolean> {
  const platformAccountId = s.profile.accountId;
  if (!platformAccountId || !KEPT.has(s.platform)) return false;
  try {
    if (!(await accountIdTablesReady())) return false;
    const now = s.now ?? new Date();
    const handle = s.handle ? s.handle.replace(/^@/, "") : null;
    const previous = await previousAccountUnderHandle({ ...s, accountId: platformAccountId });
    if (previous) {
      createLogger({ context: { job: "creator-account-ids", platform: s.platform } }).warn(
        "tracked handle now belongs to a different account",
        { creatorId: s.creatorId, previousAccountId: previous, accountId: platformAccountId, source: s.source }
      );
    }
    await db.creatorPlatformAccountId.upsert({
      where: {
        creatorId_platform_platformAccountId: {
          creatorId: s.creatorId,
          platform: s.platform as never,
          platformAccountId,
        },
      },
      create: {
        creatorId: s.creatorId,
        orgId: s.orgId,
        platform: s.platform as never,
        platformAccountId,
        secUid: s.profile.secUid ?? null,
        handle,
        source: s.source,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        lastSeenAt: now,
        source: s.source,
        ...(handle ? { handle } : {}),
        ...(s.profile.secUid ? { secUid: s.profile.secUid } : {}),
      },
    });
    return true;
  } catch {
    return false;
  }
}
