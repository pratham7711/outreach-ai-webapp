import { alertOps } from "@/lib/alerts";
import { createLogger } from "@/lib/observability/logger";
import type { AlertFinding } from "@/lib/trackers/readerAlerts";
import { resolveTrackerPlan, trackerSourceTablesReady } from "@/lib/trackers/sourceSwitch";
import { CRON_JOBS, cronCadenceMinutes, type CronJobName } from "./cronJobs";
import { CRON_KILL_PREFIX, SOURCE_KILL_PREFIX, cronKillKey, readKillSwitches } from "./killSwitch";
import { opsDb, opsTablesReady } from "./opsTables";
import { sandboxDailyCap, sandboxesCreatedOn, utcDay } from "./sandboxBudget";
import { breakerFromRow, effectivePhase } from "./sourceBreaker";

/**
 * The hourly canary (plan §13 C). Two kinds of check, both read from our own
 * database and nothing else -- no Sandbox, no TikTok, no Meta:
 *
 *   liveness  -- did every job run when vercel.json says it should, finish,
 *                and finish well? Are any switches off or breakers open?
 *   values    -- are the numbers the jobs wrote plausible? A cron that runs on
 *                time and writes zeros is the failure a liveness check misses,
 *                and the one that reaches a client's report.
 *
 * Every finding goes through alertOps, which mails ALERT_EMAIL_TO at most once
 * a day per title with its digits masked -- the same de-duplication the
 * reader's alarms rely on (lib/trackers/readerAlerts). So titles here carry
 * counts but are otherwise fixed, and an hourly canary on a problem that lasts
 * all day sends one mail, not twenty-four. Facts carry counts only; no handle
 * or creator id is ever put in an alert.
 *
 * Nothing here acts. A finding says what is wrong; the ops page is where a
 * person flips a switch.
 */

/** A heartbeat older than this many cadences is overdue. Two, so one skipped
 *  or slow firing is not an alarm and two in a row is. */
export const HEARTBEAT_OVERDUE_FACTOR = 2;
/** Started and never finished: longer than any cron's ceiling (800 s is the
 *  most Vercel allows), so the function was killed or crashed mid-run. */
export const HEARTBEAT_STUCK_MS = 15 * 60 * 1000;
/** Failed runs in a row before the canary says so; a job's own alert covers
 *  the first. */
export const CRON_FAILURE_STREAK_ALERT = 2;
/** Of the creators tracked for over a day, at least this share of each
 *  platform should have a reading from the last 24 h -- the slowest cadence
 *  is daily. Loose on purpose: failures and drift past 24 h are normal. */
export const READ_SHARE_FLOOR = 0.5;
/** Below this many tracked creators on a platform, a share means nothing. */
export const READ_SHARE_MIN_TRACKED = 20;
/** The validation gate's verdicts in the last hour, per verdict. */
export const QUARANTINE_REJECTED_HOUR_ALERT = 10;
export const QUARANTINE_HELD_HOUR_ALERT = 25;
/** Creators whose latest followers reading is 0 after a non-zero one. One is
 *  enough: the gate exists to stop exactly this, so any is a bug or a hole. */
export const FOLLOWERS_ZEROED_ALERT = 1;
/** The live reader's most recent run: share of reads TikTok answered properly. */
export const SOURCE_HEALTH_PROPER_FLOOR = 0.9;
export const SOURCE_HEALTH_MIN_READS = 20;
/** Reader v2 records a run every hour; two hours without one is a stopped reader. */
export const SOURCE_HEALTH_STALE_MS = 2 * 60 * 60 * 1000;
/** Warn before the Sandbox cap starts refusing. */
export const SANDBOX_CAP_WARN_SHARE = 0.8;

export type HeartbeatRow = {
  job: string;
  firstSeenAt: Date;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastOk: boolean | null;
  lastError: string | null;
  consecutiveFailures: number;
};

export type CanaryInput = {
  nowMs: number;
  /** Null when the ops tables are not applied: no liveness checks at all. */
  heartbeats: HeartbeatRow[] | null;
  /** Keys of the switches that are off. */
  killed: string[];
  openBreakers: string[];
  sandbox: { used: number | null; cap: number };
  readShare: { platform: string; tracked: number; read: number }[] | null;
  quarantine: { held: number; rejected: number } | null;
  zeroed: { platform: string; n: number }[] | null;
  sourceHealth: { plan: "A" | "B"; latest: { startedAt: Date; reads: number; proper: number } | null } | null;
};

const SOURCE = "ops-canary";
const pct = (n: number) => `${Math.round(n * 100)}%`;
const hoursAgo = (nowMs: number, at: Date) => Math.max(0, Math.round((nowMs - at.getTime()) / 3_600_000));

/** Pure: the liveness findings for every registered job. */
export function heartbeatFindings(input: Pick<CanaryInput, "nowMs" | "heartbeats" | "killed">): AlertFinding[] {
  if (!input.heartbeats) return [];
  const out: AlertFinding[] = [];
  const byJob = new Map(input.heartbeats.map((h) => [h.job, h]));
  const killed = new Set(input.killed);
  /* "Never ran" needs a reference point: the canary's own first heartbeat. A
     job is missing only once the canary has itself been running for two of
     that job's cadences -- otherwise the first deploy alerts on every daily
     and weekly job before it has had its first chance. */
  const watchingSince = byJob.get("ops-canary")?.firstSeenAt ?? null;

  for (const { job, label } of CRON_JOBS) {
    if (job === "ops-canary" || killed.has(cronKillKey(job))) continue;
    const allowedMs = cronCadenceMinutes(job as CronJobName) * 60_000 * HEARTBEAT_OVERDUE_FACTOR;
    const hb = byJob.get(job);
    if (!hb?.lastStartedAt) {
      if (watchingSince && input.nowMs - watchingSince.getTime() > allowedMs) {
        out.push({
          source: SOURCE,
          title: `Cron ${job} has no heartbeat since the canary started`,
          facts: { job, label, expectedEveryMinutes: cronCadenceMinutes(job as CronJobName) },
          severity: "critical",
        });
      }
      continue;
    }
    const sinceStart = input.nowMs - hb.lastStartedAt.getTime();
    if (sinceStart > allowedMs) {
      out.push({
        source: SOURCE,
        title: `Cron ${job} is overdue: last started ${hoursAgo(input.nowMs, hb.lastStartedAt)}h ago`,
        facts: { job, label, lastStartedAt: hb.lastStartedAt.toISOString(), expectedEveryMinutes: cronCadenceMinutes(job as CronJobName) },
        severity: "critical",
      });
      continue;
    }
    const unfinished = !hb.lastFinishedAt || hb.lastFinishedAt.getTime() < hb.lastStartedAt.getTime();
    if (unfinished && sinceStart > HEARTBEAT_STUCK_MS) {
      out.push({
        source: SOURCE,
        title: `Cron ${job} started and never finished`,
        facts: { job, label, lastStartedAt: hb.lastStartedAt.toISOString(), meaning: "killed at its time limit or crashed" },
        severity: "warn",
      });
      continue;
    }
    if (hb.consecutiveFailures >= CRON_FAILURE_STREAK_ALERT) {
      out.push({
        source: SOURCE,
        title: `Cron ${job} failed ${hb.consecutiveFailures} runs in a row`,
        facts: { job, label, lastError: hb.lastError ?? "unknown" },
        severity: "critical",
      });
    }
  }
  return out;
}

/** Pure: switches off and breakers open, as daily reminders. */
export function guardFindings(input: Pick<CanaryInput, "killed" | "openBreakers" | "sandbox">): AlertFinding[] {
  const out: AlertFinding[] = [];
  for (const key of input.killed) {
    if (!key.startsWith(CRON_KILL_PREFIX) && !key.startsWith(SOURCE_KILL_PREFIX)) continue;
    out.push({
      source: SOURCE,
      title: `Kill switch is on: ${key}`,
      facts: { key, meaning: "switched off on /platform/ops; it stays off until a person turns it back on" },
      severity: "warn",
    });
  }
  for (const key of input.openBreakers) {
    out.push({
      source: SOURCE,
      title: `Source breaker open: ${key}`,
      facts: { key, meaning: "reads of this source are being skipped; it probes again after its cooldown" },
      severity: "warn",
    });
  }
  const { used, cap } = input.sandbox;
  if (used !== null && used >= cap * SANDBOX_CAP_WARN_SHARE && used < cap) {
    out.push({
      source: SOURCE,
      title: `Sandbox use at ${used} of ${cap} today (UTC)`,
      facts: { used, cap, meaning: "new sandboxes are refused at the cap until 00:00 UTC" },
      severity: "warn",
    });
  }
  return out;
}

/** Pure: the value checks on what the readers wrote. */
export function valueFindings(input: Pick<CanaryInput, "nowMs" | "killed" | "readShare" | "quarantine" | "zeroed" | "sourceHealth">): AlertFinding[] {
  const out: AlertFinding[] = [];
  const killed = new Set(input.killed);

  for (const r of input.readShare ?? []) {
    if (killed.has(`${SOURCE_KILL_PREFIX}${r.platform.toLowerCase()}`)) continue;
    if (r.tracked < READ_SHARE_MIN_TRACKED) continue;
    const share = r.read / r.tracked;
    if (share < READ_SHARE_FLOOR) {
      out.push({
        source: SOURCE,
        title: `Tracked ${r.platform} creators read in 24h: ${pct(share)}, under ${pct(READ_SHARE_FLOOR)}`,
        facts: { platform: r.platform, tracked: r.tracked, read: r.read },
        severity: "warn",
      });
    }
  }

  if (input.quarantine) {
    if (input.quarantine.rejected >= QUARANTINE_REJECTED_HOUR_ALERT) {
      out.push({
        source: SOURCE,
        title: `Validation gate rejected ${input.quarantine.rejected} readings in the last hour`,
        facts: { ...input.quarantine },
        severity: "warn",
      });
    }
    if (input.quarantine.held >= QUARANTINE_HELD_HOUR_ALERT) {
      out.push({
        source: SOURCE,
        title: `Validation gate held ${input.quarantine.held} readings in the last hour`,
        facts: { ...input.quarantine },
        severity: "warn",
      });
    }
  }

  const zeroed = (input.zeroed ?? []).filter((z) => z.n > 0);
  const zeroedTotal = zeroed.reduce((a, z) => a + z.n, 0);
  if (zeroedTotal >= FOLLOWERS_ZEROED_ALERT) {
    out.push({
      source: SOURCE,
      title: `${zeroedTotal} tracked creator(s) now read 0 followers after a non-zero reading`,
      facts: Object.fromEntries(zeroed.map((z) => [z.platform, z.n])),
      severity: "critical",
    });
  }

  const sh = input.sourceHealth;
  if (sh && !killed.has(cronKillKey("read-creator-trackers"))) {
    if (!sh.latest || input.nowMs - sh.latest.startedAt.getTime() > SOURCE_HEALTH_STALE_MS) {
      out.push({
        source: SOURCE,
        title: `Tracker reader ${sh.plan} is live but has recorded no run for over 2h`,
        facts: { plan: sh.plan, lastRunAt: sh.latest?.startedAt.toISOString() ?? "never" },
        severity: "warn",
      });
    } else if (sh.latest.reads >= SOURCE_HEALTH_MIN_READS && sh.latest.proper / sh.latest.reads < SOURCE_HEALTH_PROPER_FLOOR) {
      out.push({
        source: SOURCE,
        title: `Tracker reader ${sh.plan}'s last run read ${pct(sh.latest.proper / sh.latest.reads)} properly, under ${pct(SOURCE_HEALTH_PROPER_FLOOR)}`,
        facts: { plan: sh.plan, reads: sh.latest.reads, proper: sh.latest.proper },
        severity: "warn",
      });
    }
  }
  return out;
}

export function canaryFindings(input: CanaryInput): AlertFinding[] {
  return [...heartbeatFindings(input), ...guardFindings(input), ...valueFindings(input)];
}

/* ── reads ─────────────────────────────────────────────────────────────────
   Each one is caught on its own and answers null, which skips its checks:
   the canary reports what it can see, and one unreadable table does not take
   the other checks down with it. */

async function readHeartbeats(): Promise<HeartbeatRow[] | null> {
  if (!(await opsTablesReady())) return null;
  const db = await opsDb();
  return db.opsCronHeartbeat.findMany({
    select: {
      job: true,
      firstSeenAt: true,
      lastStartedAt: true,
      lastFinishedAt: true,
      lastOk: true,
      lastError: true,
      consecutiveFailures: true,
    },
  });
}

async function readOpenBreakers(nowMs: number): Promise<string[]> {
  if (!(await opsTablesReady())) return [];
  const db = await opsDb();
  const rows = await db.opsSourceBreaker.findMany();
  return rows.filter((r) => effectivePhase(breakerFromRow(r), nowMs) === "open").map((r) => r.key);
}

/* Platform-wide on purpose, like the reader's own alarms: the canary watches
   the readers, which serve every org, and reports counts only. */
async function readShares(nowMs: number) {
  const db = await opsDb();
  const since = new Date(nowMs - 24 * 60 * 60 * 1000);
  const rows = await db.$queryRawUnsafe<{ platform: string; tracked: number; read: number }[]>(
    `SELECT c."platform"::text AS platform,
            count(*)::int AS tracked,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM "CreatorTrackerSnapshot" s
               WHERE s."creatorId" = c."id" AND s."recordedAt" >= $1
            ))::int AS read
       FROM "Creator" c
      WHERE c."deletedAt" IS NULL
        AND c."trackedSince" IS NOT NULL
        AND c."trackedSince" < $1
        AND c."platform"::text IN ('TIKTOK', 'INSTAGRAM', 'YOUTUBE')
      GROUP BY c."platform"`,
    since,
  );
  return rows.map((r) => ({ platform: r.platform, tracked: Number(r.tracked), read: Number(r.read) }));
}

async function readQuarantine(nowMs: number) {
  if (!(await trackerSourceTablesReady())) return null;
  const db = await opsDb();
  const groups = await db.trackerReadingQuarantine.groupBy({
    by: ["verdict"],
    where: { recordedAt: { gte: new Date(nowMs - 60 * 60 * 1000) } },
    _count: { _all: true },
  });
  const out = { held: 0, rejected: 0 };
  for (const g of groups) {
    if (g.verdict === "held") out.held = g._count._all;
    if (g.verdict === "rejected") out.rejected = g._count._all;
  }
  return out;
}

/* The latest reading in the last day per tracked creator, against the reading
   before it. Bounded to a day of snapshots, and the LATERAL walks the
   (creatorId, recordedAt) index one row per creator. */
async function readZeroed(nowMs: number) {
  const db = await opsDb();
  const since = new Date(nowMs - 24 * 60 * 60 * 1000);
  const rows = await db.$queryRawUnsafe<{ platform: string; n: number }[]>(
    `SELECT latest.platform, count(*)::int AS n
       FROM (
         SELECT DISTINCT ON (s."creatorId") s."creatorId", s."followersCount", s."recordedAt", c."platform"::text AS platform
           FROM "CreatorTrackerSnapshot" s
           JOIN "Creator" c ON c."id" = s."creatorId"
          WHERE s."recordedAt" >= $1 AND c."deletedAt" IS NULL AND c."trackedSince" IS NOT NULL
          ORDER BY s."creatorId", s."recordedAt" DESC
       ) latest
       CROSS JOIN LATERAL (
         SELECT p."followersCount" FROM "CreatorTrackerSnapshot" p
          WHERE p."creatorId" = latest."creatorId" AND p."recordedAt" < latest."recordedAt"
          ORDER BY p."recordedAt" DESC
          LIMIT 1
       ) prev
      WHERE latest."followersCount" = 0 AND prev."followersCount" > 0
      GROUP BY latest.platform`,
    since,
  );
  return rows.map((r) => ({ platform: r.platform, n: Number(r.n) }));
}

async function readSourceHealth(): Promise<CanaryInput["sourceHealth"]> {
  const plan = await resolveTrackerPlan();
  if (plan.effective !== "A" && plan.effective !== "B") return null;
  if (!(await trackerSourceTablesReady())) return null;
  const db = await opsDb();
  const latest = await db.trackerSourceHealth.findFirst({
    where: { plan: plan.effective, kind: "run" },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true, reads: true, proper: true },
  });
  return { plan: plan.effective, latest };
}

export type CanaryResult = {
  findings: AlertFinding[];
  /** Which checks ran. False means the read failed, its table is absent, or
   *  (sourceHealth) the live plan is legacy, which records no runs. */
  checked: Record<"heartbeats" | "readShare" | "quarantine" | "zeroed" | "sourceHealth", boolean>;
};

/** Reads everything, alerts on what it finds (unless dryRun). Never throws. */
export async function runCanary(options: { nowMs?: number; dryRun?: boolean } = {}): Promise<CanaryResult> {
  const nowMs = options.nowMs ?? Date.now();
  const log = createLogger({ context: { lib: "ops/canary" } });
  const safe = async <T>(name: string, read: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await read();
    } catch (e) {
      log.warn("canary check unreadable", { check: name, error: e instanceof Error ? e.message : String(e) });
      return fallback;
    }
  };

  /* Asked once up front: trackerSourceTablesReady caches "absent" for a minute
     from the moment its first check starts, so two of the reads below asking
     it at the same time on a cold instance would see one yes and one no. */
  await safe("trackerTables", trackerSourceTablesReady, false);

  const [heartbeats, switches, openBreakers, used, readShare, quarantine, zeroed, sourceHealth] = await Promise.all([
    safe("heartbeats", readHeartbeats, null),
    safe("killSwitches", () => readKillSwitches(nowMs), new Map()),
    safe("breakers", () => readOpenBreakers(nowMs), [] as string[]),
    safe("sandbox", () => sandboxesCreatedOn(utcDay(nowMs)), null),
    safe("readShare", () => readShares(nowMs), null),
    safe("quarantine", () => readQuarantine(nowMs), null),
    safe("zeroed", () => readZeroed(nowMs), null),
    safe("sourceHealth", readSourceHealth, null),
  ]);
  const killed = [...switches.values()].filter((s) => s.off).map((s) => s.key);

  const findings = canaryFindings({
    nowMs,
    heartbeats,
    killed,
    openBreakers,
    sandbox: { used, cap: sandboxDailyCap() },
    readShare,
    quarantine,
    zeroed,
    sourceHealth,
  });
  if (!options.dryRun) for (const f of findings) await alertOps(f).catch(() => undefined);
  return {
    findings,
    checked: {
      heartbeats: heartbeats !== null,
      readShare: readShare !== null,
      quarantine: quarantine !== null,
      zeroed: zeroed !== null,
      sourceHealth: sourceHealth !== null,
    },
  };
}
