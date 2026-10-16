import { db } from "@/lib/db";
import { alertOps } from "@/lib/alerts";
import { trackerSweepableWhere } from "@/lib/creators/handleCheck";
import { trackerSourceTablesReady, type TrackerPosition } from "./sourceSwitch";

/**
 * The reader's alarms (plan T8). They go to the operator only, through
 * alertOps -- ALERT_EMAIL_TO, at most once a day per alert. Nothing here, or
 * anywhere in the tracker, ever reaches a creator.
 *
 * None of them flips the switch. An alert says what is wrong and the ops page
 * is where a person decides; a reader that moved itself could walk straight
 * around a deliberate block, which is exactly what TikTok's terms forbid
 * (plan §07, rule S14).
 */

export const DAILY_PROPER_FLOOR = 0.97;
export const WALL_STREAK_ALERT = 3;
export const QUEUE_STALE_MS = 24 * 60 * 60 * 1000;
export const PLAN_B_SILENT_MS = 48 * 60 * 60 * 1000;

export type AlertFinding = { source: string; title: string; facts: Record<string, unknown>; severity: "warn" | "critical" };

/** Pure: which alarms a run's numbers raise. */
export function readerFindings(input: {
  plan: TrackerPosition;
  maxWallStreak: number;
  day: { reads: number; proper: number } | null;
  oldestAttemptAt: Date | null | undefined;
  planBLastCheck: { at: Date; ok: boolean } | null;
  nowMs: number;
}): AlertFinding[] {
  const out: AlertFinding[] = [];
  if (input.maxWallStreak >= WALL_STREAK_ALERT) {
    out.push({
      source: "tracker-reader",
      title: `Tracker reader ${input.plan}: ${input.maxWallStreak} profile reads in a row walled on every address`,
      facts: { plan: input.plan, streak: input.maxWallStreak },
      severity: "warn",
    });
  }
  if (input.day && input.day.reads >= 50 && input.day.proper / input.day.reads < DAILY_PROPER_FLOOR) {
    out.push({
      source: "tracker-reader",
      title: `Tracker reader ${input.plan} answered ${Math.round((input.day.proper / input.day.reads) * 100)}% in 24h, under 97%`,
      facts: { plan: input.plan, reads: input.day.reads, proper: input.day.proper },
      severity: "critical",
    });
  }
  if (input.oldestAttemptAt !== undefined) {
    const stale = input.oldestAttemptAt === null || input.nowMs - input.oldestAttemptAt.getTime() > QUEUE_STALE_MS;
    if (stale) {
      out.push({
        source: "tracker-reader",
        title: `Tracker queue not drained: a tracked creator has waited over 24h for a read`,
        facts: { plan: input.plan, oldestAttemptAt: input.oldestAttemptAt?.toISOString() ?? "never" },
        severity: "warn",
      });
    }
  }
  if (input.planBLastCheck && input.nowMs - input.planBLastCheck.at.getTime() > PLAN_B_SILENT_MS) {
    out.push({
      source: "tracker-plan-b",
      title: `Plan B's daily check has not reported for over 48h`,
      facts: { lastCheck: input.planBLastCheck.at.toISOString() },
      severity: "warn",
    });
  }
  return out;
}

/** Reads what the findings need and sends whatever they raise. Never throws. */
export async function checkReaderAlerts(input: {
  plan: TrackerPosition;
  maxWallStreak: number;
  scopeOrgIds: string[];
  nowMs?: number;
}): Promise<AlertFinding[]> {
  const nowMs = input.nowMs ?? Date.now();
  try {
    const tables = await trackerSourceTablesReady();
    const since = new Date(nowMs - 24 * 60 * 60 * 1000);
    const day = tables
      ? await db.trackerSourceHealth
          .aggregate({ where: { plan: input.plan, kind: "run", startedAt: { gte: since } }, _sum: { reads: true, proper: true } })
          .then((a) => ({ reads: a._sum.reads ?? 0, proper: a._sum.proper ?? 0 }))
          .catch(() => null)
      : null;
    /* Never-attempted rows are left out: Track all stamps new rows "now"
       (plan F3), so a null here is a row from before that, not a stuck queue.
       So is an account the platform said is gone: the sweep asks it weekly by
       design (DEAD_ACCOUNT_RECHECK_MS), and that wait is not a stuck queue. */
    const oldest = await db.creator
      .findFirst({
        where: {
          deletedAt: null,
          trackedSince: { not: null },
          trackerLastAttemptAt: { not: null },
          AND: [trackerSweepableWhere(nowMs)],
          ...(input.scopeOrgIds.length ? { orgId: { in: input.scopeOrgIds } } : {}),
        },
        orderBy: { trackerLastAttemptAt: "asc" },
        select: { trackerLastAttemptAt: true },
      })
      .catch(() => undefined);
    const lastB = tables
      ? await db.trackerSourceHealth
          .findFirst({ where: { plan: "B", kind: "daily-check" }, orderBy: { startedAt: "desc" }, select: { finishedAt: true, ok: true } })
          .catch(() => null)
      : null;
    const findings = readerFindings({
      plan: input.plan,
      maxWallStreak: input.maxWallStreak,
      day,
      oldestAttemptAt: oldest === undefined ? undefined : oldest?.trackerLastAttemptAt ?? undefined,
      planBLastCheck: lastB ? { at: lastB.finishedAt, ok: lastB.ok } : null,
      nowMs,
    });
    for (const f of findings) await alertOps(f);
    return findings;
  } catch {
    return [];
  }
}

/** A daily check passes when it read at least 12 pages and 90% of them were
 *  TikTok answering -- one wall in fifteen is noise, two is not. */
export function dailyCheckPassed(reads: number, proper: number): boolean {
  return reads >= 12 && proper / reads >= 0.9;
}

/** Plan B's daily check: two failures in a row is the alarm (plan §07). */
export function planBCheckFinding(latest: { ok: boolean }, previous: { ok: boolean } | null): AlertFinding | null {
  if (latest.ok || !previous || previous.ok) return null;
  return {
    source: "tracker-plan-b",
    title: "Plan B's daily check failed two days in a row",
    facts: { note: "The ops page will refuse to switch to B until a check passes." },
    severity: "critical",
  };
}
