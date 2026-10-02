import { db } from "@/lib/db";
import { accountIdTablesReady } from "@/lib/creators/accountIdTables";
import type { CreatorProfileRead } from "@/lib/platforms/creatorProfile";

/**
 * Keeps a creator's TikTok or Instagram account id beside its handle (plan A4).
 *
 * Called from the two readers that already hold a fresh profile -- the daily
 * roster refresh and the tracker sweep -- with the ids that same read carried
 * (TikTok's user.id and secUid from the profile page, Instagram's user id from
 * Business Discovery). It never reads a platform itself, so it costs no
 * request, and it never throws: a read that worked is not allowed to fail
 * because the id could not be kept. Absent table, absent id, or a write error
 * all end the same way -- nothing written, the read untouched.
 *
 * One row per (creator, platform, id): a creator who renames keeps the row and
 * its handle column moves on; an account that is genuinely a different one (the
 * id changed under the same handle) gets a second row, which is exactly the
 * evidence a rename-vs-replacement question needs.
 */
const KEPT: ReadonlySet<string> = new Set(["TIKTOK", "INSTAGRAM"]);

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
