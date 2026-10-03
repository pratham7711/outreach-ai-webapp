import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";
import { planBWorkerConfig } from "./planBWorker";
import { TRACKER_SOURCE_TABLES } from "./sourceSchemaDdl";

/**
 * The creator tracker's three-position switch (plan T5, §14 rule 2).
 *
 *   legacy -- today's sweep, untouched: /api/cron/sync-creator-trackers.
 *   A      -- reader v2 on Vercel Sandbox lanes: /api/cron/read-creator-trackers.
 *   B      -- reader v2 through our own worker on a non-AWS network.
 *
 * Both crons ask resolveTrackerPlan() the same question and each does only its
 * share, so there is never a moment with no reader and never two readers on
 * one creator. Anything that goes wrong in here -- tables not applied yet, a
 * database hiccup, B selected but not configured -- resolves to legacy, which
 * is the sweep that has been running all along (plan F6).
 *
 * The switch is manual. Nothing in the code flips it; alerts tell the operator
 * and the ops page is the one place it changes.
 */

export const CREATOR_TRACKER_SWITCH = "creator-tracker";
export const TRACKER_POSITIONS = ["legacy", "A", "B"] as const;
export type TrackerPosition = (typeof TRACKER_POSITIONS)[number];

export function isTrackerPosition(v: unknown): v is TrackerPosition {
  return typeof v === "string" && (TRACKER_POSITIONS as readonly string[]).includes(v);
}

let ready = false;
let checkedAt = 0;

/** Same contract as rosterTablesReady: true sticks, false is re-asked each minute. */
export async function trackerSourceTablesReady(): Promise<boolean> {
  if (ready) return true;
  if (Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [...TRACKER_SOURCE_TABLES],
    );
    ready = rows[0]?.n === TRACKER_SOURCE_TABLES.length;
  } catch {
    ready = false;
  }
  return ready;
}

/** For tests. */
export function resetTrackerSourceTablesCache() {
  ready = false;
  checkedAt = 0;
}

export type TrackerSwitchState = {
  position: TrackerPosition;
  scopeOrgIds: string[];
  percent: number;
  changedAt: Date | null;
  changedBy: string | null;
};

const LEGACY: TrackerSwitchState = { position: "legacy", scopeOrgIds: [], percent: 100, changedAt: null, changedBy: null };

export async function readTrackerSwitch(): Promise<TrackerSwitchState> {
  if (!(await trackerSourceTablesReady())) return LEGACY;
  try {
    const row = await db.trackerSourceSwitch.findUnique({ where: { id: CREATOR_TRACKER_SWITCH } });
    if (!row || !isTrackerPosition(row.position)) return LEGACY;
    return {
      position: row.position,
      scopeOrgIds: row.scopeOrgIds ?? [],
      percent: Math.max(0, Math.min(100, row.percent ?? 100)),
      changedAt: row.changedAt,
      changedBy: row.changedBy,
    };
  } catch {
    return LEGACY;
  }
}

export { planBWorkerConfig };

export type ResolvedTrackerPlan = TrackerSwitchState & {
  /** What actually runs. Differs from `position` only when the selected
   *  reader cannot run here, and then it is always legacy. */
  effective: TrackerPosition;
  reason: string | null;
};

export async function resolveTrackerPlan(env: NodeJS.ProcessEnv = process.env): Promise<ResolvedTrackerPlan> {
  const state = await readTrackerSwitch();
  if (state.position === "B" && !planBWorkerConfig(env)) {
    return { ...state, effective: "legacy", reason: "B selected but TRACKER_PLAN_B_URL / TRACKER_PLAN_B_TOKEN are not set" };
  }
  if (state.position !== "legacy" && state.percent === 0) {
    return { ...state, effective: "legacy", reason: "rollout percent is 0" };
  }
  return { ...state, effective: state.position, reason: null };
}

/** FNV-1a, 0-99. Stable across runs and deploys, so a creator stays on the
 *  same side of a percentage rollout until the percentage moves. */
export function rolloutBucket(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/** Is this creator read by reader v2 under this plan? Legacy reads the rest. */
export function inReaderV2Scope(plan: ResolvedTrackerPlan, creator: { id: string; orgId: string }): boolean {
  if (plan.effective === "legacy") return false;
  if (plan.scopeOrgIds.length > 0 && !plan.scopeOrgIds.includes(creator.orgId)) return false;
  return rolloutBucket(creator.id) < plan.percent;
}

export type SourceHealthRow = {
  plan: TrackerPosition;
  kind: "run" | "daily-check" | "drill";
  startedAt: Date;
  finishedAt: Date;
  reads: number;
  proper: number;
  walls: number;
  failures: number;
  medianMs: number | null;
  ok: boolean;
  detail?: Record<string, unknown>;
};

export async function recordSourceHealth(row: SourceHealthRow): Promise<boolean> {
  if (!(await trackerSourceTablesReady())) return false;
  try {
    await db.trackerSourceHealth.create({
      data: { ...row, detail: (row.detail ?? undefined) as never },
      select: { id: true },
    });
    return true;
  } catch (e) {
    createLogger({ context: { lib: "trackers/sourceSwitch" } }).warn("source health not recorded", {
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

export async function recordSnapshotSources(
  rows: { snapshotId: string; creatorId: string; plan: TrackerPosition; exitId: string | null; recordedAt: Date }[]
): Promise<void> {
  if (rows.length === 0 || !(await trackerSourceTablesReady())) return;
  await db.trackerSnapshotSource.createMany({ data: rows, skipDuplicates: true }).catch(() => {});
}

/** B may be switched to only on a fresh, passing daily check (plan §07). */
export const PLAN_B_CHECK_MAX_AGE_MS = 36 * 60 * 60 * 1000;

export type PlanBReadiness = { ready: boolean; reason: string | null; lastCheck: { at: Date; ok: boolean } | null };

export async function planBReadiness(nowMs = Date.now()): Promise<PlanBReadiness> {
  if (!(await trackerSourceTablesReady())) return { ready: false, reason: "tracker source tables are not applied", lastCheck: null };
  const last = await db.trackerSourceHealth
    .findFirst({ where: { plan: "B", kind: "daily-check" }, orderBy: { startedAt: "desc" }, select: { finishedAt: true, ok: true } })
    .catch(() => null);
  if (!last) return { ready: false, reason: "Plan B has no daily check on record", lastCheck: null };
  const lastCheck = { at: last.finishedAt, ok: last.ok };
  if (!last.ok) return { ready: false, reason: "Plan B's last daily check failed", lastCheck };
  if (nowMs - last.finishedAt.getTime() > PLAN_B_CHECK_MAX_AGE_MS) {
    return { ready: false, reason: "Plan B's last daily check is older than 36 hours", lastCheck };
  }
  return { ready: true, reason: null, lastCheck };
}

export type SwitchChange = {
  position: TrackerPosition;
  scopeOrgIds?: string[];
  percent?: number;
  changedBy: string;
  note?: string;
};

export type SwitchResult = { ok: true; state: TrackerSwitchState } | { ok: false; error: string };

/**
 * Moves the switch. Refuses B unless its daily check is fresh and passing;
 * back to A or legacy is always allowed, because that is the way out of
 * trouble and must never be the thing that is refused.
 */
export async function setTrackerSwitch(change: SwitchChange, nowMs = Date.now()): Promise<SwitchResult> {
  if (!isTrackerPosition(change.position)) return { ok: false, error: "position must be legacy, A or B" };
  if (!(await trackerSourceTablesReady())) return { ok: false, error: "tracker source tables are not applied" };
  if (change.position === "B") {
    const b = await planBReadiness(nowMs);
    if (!b.ready) return { ok: false, error: b.reason ?? "Plan B is not ready" };
    if (!planBWorkerConfig()) return { ok: false, error: "TRACKER_PLAN_B_URL / TRACKER_PLAN_B_TOKEN are not set here" };
  }
  const percent = Math.max(0, Math.min(100, Math.round(change.percent ?? 100)));
  const scopeOrgIds = [...new Set((change.scopeOrgIds ?? []).filter((s) => typeof s === "string" && s.length > 0))];
  const before = await readTrackerSwitch();
  const at = new Date(nowMs);
  await db.$transaction([
    db.trackerSourceSwitch.upsert({
      where: { id: CREATOR_TRACKER_SWITCH },
      create: { id: CREATOR_TRACKER_SWITCH, position: change.position, scopeOrgIds, percent, changedAt: at, changedBy: change.changedBy, note: change.note ?? null },
      update: { position: change.position, scopeOrgIds, percent, changedAt: at, changedBy: change.changedBy, note: change.note ?? null },
      select: { id: true },
    }),
    db.trackerSourceSwitchLog.create({
      data: {
        switchId: CREATOR_TRACKER_SWITCH,
        fromPosition: before.changedAt ? before.position : null,
        toPosition: change.position,
        scopeOrgIds,
        percent,
        changedBy: change.changedBy,
        note: change.note ?? null,
        changedAt: at,
      },
      select: { id: true },
    }),
  ]);
  return { ok: true, state: await readTrackerSwitch() };
}

export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
}
