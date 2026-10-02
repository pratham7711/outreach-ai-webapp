import { CRON_JOBS, cronCadenceMinutes, type CronJobName } from "./cronJobs";
import { cronKillKey, readKillSwitches } from "./killSwitch";
import { opsDb, opsTablesReady } from "./opsTables";

/**
 * Which crons have missed their heartbeat, for the backup scheduler on the
 * Plan B server (plan §13 B; scripts/creator-worker/backup-scheduler.mjs).
 * That box polls GET /api/ops/overdue-crons and calls each listed cron route
 * with the cron secret, the same request Vercel's scheduler makes -- so a
 * Vercel cron outage does not stop the jobs, and the box never reads TikTok.
 *
 * Missed means: last started more than one cadence plus SCHEDULER_GRACE_MINUTES
 * ago. One cadence, not the canary's two (HEARTBEAT_OVERDUE_FACTOR), on
 * purpose: the backup steps in after one missed firing, and the canary alerts
 * a person only if the backup has not fixed it by the second. The grace
 * covers Vercel starting a job a few minutes late.
 *
 * A job with no heartbeat at all counts once the canary has itself been
 * running for that long (the canary's own "watching since" rule), so the
 * first deploy after the tables land does not trigger every daily and weekly
 * job at once. A job switched off on /platform/ops is never listed.
 *
 * What leaves here is job names, their cron paths and minutes -- no tenant
 * data, no error text, nothing read from any platform.
 *
 * recheckInMinutes is when the next job could first become overdue. Every
 * poll reads the heartbeat table, and a poll every 10 minutes would wake Neon
 * at minutes no cron uses -- standing compute for a list that is empty almost
 * always. The scheduler sleeps until this instead (capped at an hour, so a
 * switch turned back on is seen), and polls every tick only while something
 * is overdue.
 */

export const SCHEDULER_GRACE_MINUTES = 15;
export const MAX_RECHECK_MINUTES = 60;

export type OverdueCron = { job: CronJobName; path: string; minutesOverdue: number };

export type HeartbeatTimes = { job: string; firstSeenAt: Date; lastStartedAt: Date | null };

export type OverdueInput = {
  nowMs: number;
  heartbeats: HeartbeatTimes[];
  killed: ReadonlySet<string>;
};

/** Each live job's reference time: its last start, or for a job with no
 *  heartbeat, when the canary started watching. Killed and unknown are left out. */
function referenceTimes(input: OverdueInput) {
  const byJob = new Map(input.heartbeats.map((h) => [h.job, h]));
  const watchingSince = byJob.get("ops-canary")?.firstSeenAt ?? null;
  const out: { job: CronJobName; path: string; since: Date }[] = [];
  for (const { job, path } of CRON_JOBS) {
    if (input.killed.has(cronKillKey(job))) continue;
    const since = byJob.get(job)?.lastStartedAt ?? watchingSince;
    if (since) out.push({ job, path, since });
  }
  return out;
}

/** Pure: the overdue jobs, most overdue first. */
export function selectOverdueCrons(input: OverdueInput): OverdueCron[] {
  const out: OverdueCron[] = [];
  for (const { job, path, since } of referenceTimes(input)) {
    const late = Math.floor((input.nowMs - since.getTime()) / 60_000) - cronCadenceMinutes(job);
    if (late > SCHEDULER_GRACE_MINUTES) out.push({ job, path, minutesOverdue: late });
  }
  return out.sort((a, b) => b.minutesOverdue - a.minutesOverdue);
}

/** Pure: whole minutes until the next job could first be overdue, 0 to MAX_RECHECK_MINUTES. */
export function recheckInMinutes(input: OverdueInput): number {
  let soonest = MAX_RECHECK_MINUTES;
  for (const { job, since } of referenceTimes(input)) {
    const dueAtMs = since.getTime() + (cronCadenceMinutes(job) + SCHEDULER_GRACE_MINUTES + 1) * 60_000;
    soonest = Math.min(soonest, Math.max(0, Math.ceil((dueAtMs - input.nowMs) / 60_000)));
  }
  return soonest;
}

export type OverdueReport = { overdue: OverdueCron[]; recheckInMinutes: number };

/** Reads heartbeats and switches. Nothing listed while the ops tables are absent. */
export async function readOverdueCrons(nowMs = Date.now()): Promise<OverdueReport> {
  if (!(await opsTablesReady())) return { overdue: [], recheckInMinutes: MAX_RECHECK_MINUTES };
  const db = await opsDb();
  const [heartbeats, switches] = await Promise.all([
    db.opsCronHeartbeat.findMany({ select: { job: true, firstSeenAt: true, lastStartedAt: true } }),
    readKillSwitches(nowMs),
  ]);
  const killed = new Set([...switches.values()].filter((s) => s.off).map((s) => s.key));
  const input = { nowMs, heartbeats, killed };
  return { overdue: selectOverdueCrons(input), recheckInMinutes: recheckInMinutes(input) };
}
