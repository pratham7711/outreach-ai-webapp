import type { Platform, Prisma } from "@/lib/generated/prisma/client";
import { ACCOUNT_ORIGINS } from "@/lib/platforms/accountOrigin";
import { connectionForRead } from "@/lib/creators/connectionGate";
import type { WriterCandidate } from "@/lib/metrics/fieldSources";

/**
 * The creator's own connection as a candidate writer of their follower count
 * (plan A7), for the tracker's reader v2.
 *
 * Read through the grant gate, so only a connection THIS org holds a live
 * grant for is ever a source. And only a connection that has actually reported
 * stats: `statsSyncedAt` is stamped by the identity read alone
 * (lib/platforms/accountSync), which a hand-entered row never gets, and the
 * origin clause drops manual and dev rows outright for the case where the gate
 * is still open and would otherwise hand one back.
 *
 * Only the same account as the roster row's: matched on the platform's own id
 * or the handle, so a creator who connected a second account on the platform
 * does not have its figures written over the one being tracked.
 *
 * `after` is the previous snapshot's time. A connection reading taken before
 * it has already had its chance to be recorded; offering it again would write
 * the same number twice and draw a plateau into the series between two
 * connection refreshes. Never throws; any failure is "no candidate".
 */
export async function connectedFollowerReading(
  creator: { id: string; orgId: string; platform: string; handle: string; platformUserId: string | null },
  after: Date | null,
): Promise<(WriterCandidate & { source: "connected" }) | null> {
  try {
    const bare = creator.handle.trim().replace(/^@/, "");
    const sameAccount: Prisma.CreatorSocialAccountWhereInput[] = [
      ...(creator.platformUserId ? [{ platformUserId: creator.platformUserId }] : []),
      ...(bare
        ? [
            { handle: { equals: bare, mode: "insensitive" as const } },
            { handle: { equals: `@${bare}`, mode: "insensitive" as const } },
          ]
        : []),
    ];
    if (sameAccount.length === 0) return null;

    const read = await connectionForRead(creator.orgId, creator.id, creator.platform as Platform, {
      where: {
        statsSyncedAt: { not: null },
        followersCount: { gt: 0 },
        AND: [
          { OR: [{ origin: null }, { origin: { notIn: [ACCOUNT_ORIGINS.MANUAL, ACCOUNT_ORIGINS.DEV] } }] },
          { OR: sameAccount },
        ],
      },
      order: "newest",
    });
    if (!read.ok) return null;
    const { followersCount, statsSyncedAt } = read.connection;
    if (!statsSyncedAt) return null;
    if (after && statsSyncedAt.getTime() <= after.getTime()) return null;
    return { source: "connected", value: followersCount, measuredAt: statsSyncedAt };
  } catch {
    return null;
  }
}
