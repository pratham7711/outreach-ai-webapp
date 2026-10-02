import { createLogger } from "@/lib/observability/logger";
import { CRON_JOBS, type CronJobName } from "./cronJobs";
import { opsDb, opsTablesReady } from "./opsTables";
import { OPS_SOURCES, type OpsSource } from "./sources";

/**
 * Kill switches in the database (plan §13 C).
 *
 * One per scheduled job ("cron:<job>": the route answers 200 {skipped:"killed"}
 * before doing any work) and one per read source ("source:<platform>": the
 * creator and post readers leave that platform out). A redeploy is not needed
 * to stop a job that is misbehaving, and none is needed to start it again.
 *
 * The rule every reader here follows: a broken switch table must never stop
 * production. Absent tables, a failed read, an unknown key -- all of them
 * answer "not killed". Only a row that exists and says off = true stops
 * anything, and it is cached for 30 s, so a flip takes effect on the next run
 * without every cron and every lane asking the database each time.
 */

export const SOURCE_KILL_PREFIX = "source:";
export const CRON_KILL_PREFIX = "cron:";
export const KILL_SWITCH_TTL_MS = 30_000;

export function cronKillKey(job: CronJobName): string {
  return `${CRON_KILL_PREFIX}${job}`;
}

export function sourceKillKey(source: OpsSource): string {
  return `${SOURCE_KILL_PREFIX}${source}`;
}

export const KILL_SWITCH_KEYS: string[] = [
  ...CRON_JOBS.map((j) => cronKillKey(j.job)),
  ...OPS_SOURCES.map((s) => sourceKillKey(s)),
];

export function isKillSwitchKey(v: unknown): v is string {
  return typeof v === "string" && KILL_SWITCH_KEYS.includes(v);
}

export type KillSwitchState = {
  key: string;
  off: boolean;
  reason: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
};

let cache: { at: number; map: Map<string, KillSwitchState> } | null = null;

/** For tests, and after a flip so this instance sees it at once. */
export function resetKillSwitchCache() {
  cache = null;
}

export async function readKillSwitches(nowMs = Date.now()): Promise<Map<string, KillSwitchState>> {
  if (cache && nowMs - cache.at < KILL_SWITCH_TTL_MS) return cache.map;
  const map = new Map<string, KillSwitchState>();
  if (!(await opsTablesReady())) return map;
  try {
    const db = await opsDb();
    const rows = await db.opsKillSwitch.findMany();
    for (const r of rows) {
      map.set(r.key, { key: r.key, off: r.off === true, reason: r.reason, updatedBy: r.updatedBy, updatedAt: r.updatedAt });
    }
  } catch (e) {
    createLogger({ context: { lib: "ops/killSwitch" } }).warn("kill switches unreadable; treating every job as on", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  /* A failed read is cached too, as "nothing killed": asking again on every
     lane boot would put the database on the path of the thing it guards. */
  cache = { at: nowMs, map };
  return map;
}

export async function isKilled(key: string, nowMs = Date.now()): Promise<boolean> {
  try {
    return (await readKillSwitches(nowMs)).get(key)?.off === true;
  } catch {
    return false;
  }
}

/** The read sources that are switched off right now. */
export async function killedSources(nowMs = Date.now()): Promise<Set<OpsSource>> {
  const map = await readKillSwitches(nowMs).catch(() => new Map<string, KillSwitchState>());
  return new Set(OPS_SOURCES.filter((s) => map.get(sourceKillKey(s))?.off === true));
}

export type KillSwitchChange = { key: string; off: boolean; reason?: string | null; changedBy: string };
export type KillSwitchResult = { ok: true; state: KillSwitchState } | { ok: false; error: string };

/** Flips one switch and logs it. Platform admins only -- the route checks. */
export async function setKillSwitch(change: KillSwitchChange, nowMs = Date.now()): Promise<KillSwitchResult> {
  if (!isKillSwitchKey(change.key)) return { ok: false, error: "unknown kill switch" };
  if (!(await opsTablesReady())) return { ok: false, error: "ops tables are not applied" };
  const at = new Date(nowMs);
  const reason = change.reason ? String(change.reason).slice(0, 300) : null;
  const db = await opsDb();
  await db.$transaction([
    db.opsKillSwitch.upsert({
      where: { key: change.key },
      create: { key: change.key, off: change.off, reason, updatedBy: change.changedBy, updatedAt: at },
      update: { off: change.off, reason, updatedBy: change.changedBy, updatedAt: at },
      select: { key: true },
    }),
    db.opsKillSwitchLog.create({
      data: { key: change.key, off: change.off, reason, changedBy: change.changedBy, changedAt: at },
      select: { id: true },
    }),
  ]);
  resetKillSwitchCache();
  return { ok: true, state: { key: change.key, off: change.off, reason, updatedBy: change.changedBy, updatedAt: at } };
}
