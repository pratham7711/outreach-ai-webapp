import { db } from "@/lib/db";
import { getOrgEntitlements } from "@/lib/entitlements";

/**
 * One limit, both kinds of tracker.
 *
 * lib/plans.ts is explicit that max_trackers is the ONLY finite number a plan
 * carries, and explicit about why: a tracker is a standing instruction to fetch
 * a page on a schedule, forever. A tracked creator is exactly that — the
 * creator sweep reads its profile on the same cadence the sound cron reads a
 * music page — so there is no second limit to reach for, and counting the two
 * pools separately would let a starter plan run 25 sounds AND 25 creators
 * against a cap that says 25.
 *
 * So the count is the union, and both routes gate on it.
 */
export type TrackerUsage = { used: number; max: number };

export async function trackerUsage(orgId: string): Promise<TrackerUsage> {
  const [entitlements, sounds, creators] = await Promise.all([
    getOrgEntitlements(orgId),
    db.tikTokSound.count({ where: { orgId } }),
    // trackedSince is the flag: /api/trackers/creators sets it to start a
    // tracker and clears it to stop one.
    db.creator.count({ where: { orgId, deletedAt: null, trackedSince: { not: null } } }),
  ]);
  return {
    used: sounds + creators,
    max: entitlements?.limits.maxTrackers ?? Infinity,
  };
}

/**
 * The refusal sentence, or null when there is room.
 *
 * Zero is a real limit and needs its own sentence: "remove one" is nonsense
 * advice to someone who has none, and the free tier is exactly that case.
 */
export function trackerLimitError(usage: TrackerUsage, noun: string): string | null {
  if (!Number.isFinite(usage.max) || usage.used < usage.max) return null;
  if (usage.max === 0) {
    return `Your plan does not include trackers. Upgrade to start tracking ${noun}.`;
  }
  return `Your plan includes ${usage.max} tracker${usage.max === 1 ? "" : "s"} and ${usage.used} are in use. Remove one, or ask us to raise the limit.`;
}
