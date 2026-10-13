import { db } from "@/lib/db";
import { trackerSourceTablesReady } from "@/lib/trackers/sourceSwitch";

/**
 * Files a tracker reading the validation gate refused (plan A3) in
 * TrackerReadingQuarantine, the table the reader-v2 gate already keeps its
 * holds and rejections in -- so the ops report and the canary, which count
 * that table, see these too rather than only a log line that ages out.
 *
 * Best effort by design. The reading is already refused by the time this
 * runs; failing to file it must not turn a refusal into a failed run, so a
 * missing table, a missing client model or a write error all end the same
 * way: nothing filed, nothing thrown.
 */
export async function quarantineTrackerReading(input: {
  creator: { id: string; orgId: string; platform: string };
  followersCount: number | null;
  postsCount: number | null;
  previousFollowers: number | null;
  reason: string;
  via: string | null;
}): Promise<void> {
  try {
    if (!(await trackerSourceTablesReady())) return;
    await db.trackerReadingQuarantine.create({
      data: {
        creatorId: input.creator.id,
        orgId: input.creator.orgId,
        platform: input.creator.platform,
        followersCount:
          typeof input.followersCount === "number" && Number.isFinite(input.followersCount) ? input.followersCount : null,
        postsCount:
          typeof input.postsCount === "number" && Number.isFinite(input.postsCount) ? Math.round(input.postsCount) : null,
        previousFollowers: input.previousFollowers,
        verdict: "rejected",
        reason: input.reason.slice(0, 500),
        via: input.via,
        recordedAt: new Date(),
      },
      select: { id: true },
    });
  } catch {
    /* See above: a refusal that could not be filed is still a refusal. */
  }
}
