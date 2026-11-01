import { db } from "@/lib/db";
import type { FollowerReading } from "./submissionRules";

/**
 * The creator's latest follower count on one platform, for the minimum-followers
 * rule. A roster row is one account on one platform, so a post on any other
 * platform has no reading. The tracker's newest non-zero snapshot wins because
 * it carries its date; the roster column is the fallback, undated. A 0 is
 * "never read" (Creator.followersCount defaults to it), never a measurement.
 */
export async function followerReading(creatorId: string, platform: string): Promise<FollowerReading> {
  const creator = await db.creator.findUnique({ where: { id: creatorId }, select: { platform: true, followersCount: true } });
  if (!creator || creator.platform !== platform) return null;
  const snap = await db.creatorTrackerSnapshot.findFirst({
    where: { creatorId, followersCount: { gt: 0 } },
    orderBy: { recordedAt: "desc" },
    select: { followersCount: true, recordedAt: true },
  });
  if (snap) return { count: snap.followersCount, at: snap.recordedAt.toISOString() };
  return creator.followersCount > 0 ? { count: creator.followersCount, at: null } : null;
}
