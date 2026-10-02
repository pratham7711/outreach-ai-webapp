import { db } from "@/lib/db";
import { mayOverwrite } from "@/lib/metrics/fieldSources";
import { trackerSourceTablesReady } from "@/lib/trackers/sourceSwitch";

/** The exit column's value for a snapshot whose follower count came from the
 *  creator's own connection rather than from an exit's public read. */
export const CONNECTED_VIA = "connected";

/**
 * The follower figure on a Creator row that a public read must leave in place
 * (plan A7), or null when the public read may write.
 *
 * Reader v2 is the one path that writes the creator's connected figure onto
 * Creator.followersCount, and it writes the same figure into a tracker snapshot
 * in the same transaction and records that snapshot's exit in
 * TrackerSnapshotSource. So the stored state already says who wrote the
 * column: when the creator's latest snapshot came from the connection, that is
 * the figure and the time it was written. Inside the field's freshness window
 * it is protected, and the caller writes only where the column does not hold
 * it -- a figure typed in or read publicly since then is someone else's and is
 * never protected, so a manual edit never blocks a reading.
 *
 * The legacy sweep records no exits, so under it nothing is ever protected and
 * the public writers behave exactly as they did. Never throws; any failure is
 * null, which is that same behaviour.
 */
export async function protectedCreatorFollowers(creatorId: string, now: Date = new Date()): Promise<number | null> {
  try {
    if (!(await trackerSourceTablesReady())) return null;
    const latest = await db.creatorTrackerSnapshot.findFirst({
      where: { creatorId },
      orderBy: { recordedAt: "desc" },
      select: { id: true, followersCount: true, recordedAt: true },
    });
    if (!latest) return null;
    const source = await db.trackerSnapshotSource.findUnique({
      where: { snapshotId: latest.id },
      select: { exitId: true },
    });
    if (source?.exitId !== CONNECTED_VIA) return null;
    const replaceable = mayOverwrite(
      "creator.followers",
      { source: "connected", writtenAt: latest.recordedAt },
      { source: "public" },
      now,
    );
    return replaceable ? null : latest.followersCount;
  } catch {
    return null;
  }
}
