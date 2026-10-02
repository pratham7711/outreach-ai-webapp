import { db } from "@/lib/db";
import { trackerSourceTablesReady } from "./sourceSwitch";

/**
 * The validation gate in front of every reader-v2 tracker write (plan A3).
 *
 * A backup that copies a wrong number spreads it, so correctness comes before
 * the second reader: a reading that cannot be right is never written, and one
 * that is surprising waits for a second read to say the same thing. Either
 * way the good figure already on screen stays there (plan §14 rule 6).
 *
 *   reject -- a count that is not a count, or a count that fell to 0 from
 *             something. TikTok renders a missing account as "no such user",
 *             not as 0 followers; a 0 after a real figure is a parse of a page
 *             that was not the profile.
 *   hold   -- a drop of more than half, or a jump of more than three times,
 *             against the last good figure. Real, sometimes (a viral week, a
 *             purge of bots), so it is written once a second read agrees
 *             within 10%. The next hourly run is that second read: a held
 *             creator is still due, because no snapshot landed.
 *
 * Small accounts are exempt from the hold: 40 to 130 followers is a normal
 * week, not an anomaly.
 */

export const HOLD_DROP_RATIO = 0.5;
export const HOLD_JUMP_RATIO = 3;
export const HOLD_FLOOR_FOLLOWERS = 100;
export const CONFIRM_TOLERANCE = 0.1;
/** A held reading older than this no longer confirms anything. */
export const HELD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type GateVerdict =
  | { action: "write"; confirmsHeldId?: string }
  | { action: "hold"; reason: string }
  | { action: "reject"; reason: string };

export type HeldReading = { id: string; followersCount: number | null; recordedAt: Date };

function agrees(a: number, b: number): boolean {
  const base = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / base <= CONFIRM_TOLERANCE;
}

/** Pure: the verdict for one reading. `held` is the latest unresolved held
 *  reading for the creator, if the caller looked one up. */
export function judgeFollowerReading(
  previous: { followersCount: number } | null,
  next: { followersCount: number },
  held: HeldReading | null = null,
  nowMs = Date.now()
): GateVerdict {
  const n = next.followersCount;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return { action: "reject", reason: "not a count" };
  const p = previous?.followersCount;
  if (p === undefined || !Number.isFinite(p)) return { action: "write" };
  if (p > 0 && n === 0) return { action: "reject", reason: `fell to 0 from ${Math.round(p)}` };
  if (p < HOLD_FLOOR_FOLLOWERS) return { action: "write" };

  const ratio = n / p;
  const surprising = ratio < 1 - HOLD_DROP_RATIO || ratio > HOLD_JUMP_RATIO;
  if (!surprising) return { action: "write" };

  const freshHeld =
    held && held.followersCount !== null && nowMs - held.recordedAt.getTime() <= HELD_MAX_AGE_MS ? held : null;
  if (freshHeld && agrees(n, freshHeld.followersCount as number)) {
    return { action: "write", confirmsHeldId: freshHeld.id };
  }
  return {
    action: "hold",
    reason: ratio < 1 ? `drop of ${Math.round((1 - ratio) * 100)}%` : `jump of ${ratio.toFixed(1)}x`,
  };
}

export type GateInput = {
  creator: { id: string; orgId: string; platform: string };
  previous: { followersCount: number } | null;
  next: { followersCount: number; postsCount: number };
  via: string | null;
};

/**
 * The verdict, with the quarantine kept. Looks the held reading up only when
 * the figure is surprising, so the common case costs no query. Without the
 * quarantine table a hold cannot be confirmed later, so it degrades to a write
 * -- today's behaviour -- rather than freezing a creator who really did grow.
 */
export async function gateFollowerReading(input: GateInput, nowMs = Date.now()): Promise<GateVerdict> {
  const quick = judgeFollowerReading(input.previous, input.next, null, nowMs);
  if (quick.action === "write") return quick;

  const tables = await trackerSourceTablesReady();
  if (quick.action === "hold" && !tables) return { action: "write" };

  let verdict: GateVerdict = quick;
  if (quick.action === "hold") {
    const held = await db.trackerReadingQuarantine
      .findFirst({
        where: { creatorId: input.creator.id, verdict: "held", resolvedAt: null },
        orderBy: { recordedAt: "desc" },
        select: { id: true, followersCount: true, recordedAt: true },
      })
      .catch(() => null);
    verdict = judgeFollowerReading(input.previous, input.next, held, nowMs);
  }

  if (!tables) return verdict;
  const at = new Date(nowMs);
  if (verdict.action === "write" && verdict.confirmsHeldId) {
    await db.trackerReadingQuarantine
      .updateMany({
        where: { creatorId: input.creator.id, verdict: "held", resolvedAt: null },
        data: { resolvedAt: at, resolution: "confirmed" },
      })
      .catch(() => {});
    return verdict;
  }
  if (verdict.action === "hold") {
    /* One open hold per creator: the newest replaces the last, which is what
       the next read is compared against. */
    await db.trackerReadingQuarantine
      .updateMany({
        where: { creatorId: input.creator.id, verdict: "held", resolvedAt: null },
        data: { resolvedAt: at, resolution: "superseded" },
      })
      .catch(() => {});
  }
  if (verdict.action !== "write") {
    await db.trackerReadingQuarantine
      .create({
        data: {
          creatorId: input.creator.id,
          orgId: input.creator.orgId,
          platform: input.creator.platform,
          followersCount: Number.isFinite(input.next.followersCount) ? input.next.followersCount : null,
          postsCount: Number.isFinite(input.next.postsCount) ? Math.round(input.next.postsCount) : null,
          previousFollowers: input.previous?.followersCount ?? null,
          verdict: verdict.action === "hold" ? "held" : "rejected",
          reason: verdict.reason,
          via: input.via,
          recordedAt: at,
        },
        select: { id: true },
      })
      .catch(() => {});
  }
  return verdict;
}
