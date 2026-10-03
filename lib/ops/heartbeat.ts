import { createLogger } from "@/lib/observability/logger";
import type { CronJobName } from "./cronJobs";
import { opsDb, opsTablesReady } from "./opsTables";

/**
 * Heartbeats per cron (plan §13 C): when each job last started, last finished,
 * how it ended and how long it took. The canary reads them; the job never does.
 *
 * Every write is caught and logged. A heartbeat that cannot be written is a
 * monitoring gap, and the canary will report the job as overdue -- which is
 * the right alarm for it. A heartbeat failure that failed the job would be the
 * monitor taking down the thing it watches.
 */

export const HEARTBEAT_ERROR_MAX = 500;

export type HeartbeatStart = { job: CronJobName; startedAt: Date };

function warn(message: string, job: string, e: unknown) {
  createLogger({ context: { lib: "ops/heartbeat", job } }).warn(message, {
    error: e instanceof Error ? e.message : String(e),
  });
}

export function truncateError(text: string | null | undefined, max = HEARTBEAT_ERROR_MAX): string | null {
  if (!text) return null;
  const t = String(text).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * The first time the canary sees a registered job that has never run, as a row
 * with no start. A job added in a later deploy is then "missing" only once two
 * of its own cadences have passed since that sighting, not since the canary
 * itself began -- which alerted on the new job before its first slot came round.
 * Existing rows are left alone; the job's own start heartbeat fills in the rest.
 */
export async function recordJobsSeen(jobs: readonly string[], at = new Date()): Promise<void> {
  if (jobs.length === 0) return;
  try {
    if (!(await opsTablesReady())) return;
    const db = await opsDb();
    await db.opsCronHeartbeat.createMany({ data: jobs.map((job) => ({ job, firstSeenAt: at })), skipDuplicates: true });
  } catch (e) {
    warn("first sighting not recorded", jobs.join(","), e);
  }
}

export async function recordCronStart(job: CronJobName, at = new Date()): Promise<HeartbeatStart> {
  const start = { job, startedAt: at };
  try {
    if (!(await opsTablesReady())) return start;
    const db = await opsDb();
    await db.opsCronHeartbeat.upsert({
      where: { job },
      create: { job, firstSeenAt: at, lastStartedAt: at, runs: 1 },
      update: { lastStartedAt: at, runs: { increment: 1 } },
      select: { job: true },
    });
  } catch (e) {
    warn("heartbeat start not recorded", job, e);
  }
  return start;
}

export async function recordCronFinish(
  start: HeartbeatStart,
  outcome: { ok: boolean; error?: string | null },
  at = new Date()
): Promise<void> {
  try {
    if (!(await opsTablesReady())) return;
    const db = await opsDb();
    await db.opsCronHeartbeat.update({
      where: { job: start.job },
      data: {
        lastFinishedAt: at,
        lastOk: outcome.ok,
        lastError: outcome.ok ? null : truncateError(outcome.error) ?? "failed",
        durationMs: Math.max(0, at.getTime() - start.startedAt.getTime()),
        ...(outcome.ok ? { lastSuccessAt: at, consecutiveFailures: 0 } : { consecutiveFailures: { increment: 1 } }),
      },
      select: { job: true },
    });
  } catch (e) {
    warn("heartbeat finish not recorded", start.job, e);
  }
}
