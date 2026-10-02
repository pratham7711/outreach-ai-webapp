import type { OpsCronHeartbeat, OpsSourceBreaker } from "@/lib/generated/prisma";
import { CRON_JOBS, cronCadenceMinutes } from "./cronJobs";
import { jobHealth, type JobHealth } from "./canary";
import { KILL_SWITCH_KEYS, SOURCE_KILL_PREFIX, cronKillKey, readKillSwitches, resetKillSwitchCache } from "./killSwitch";
import { METERS, METER_LABELS, latestMeters, weeklyModel, type MeterName, type MeterRow } from "./meters";
import { opsDb, opsTablesReady } from "./opsTables";
import { sandboxDailyCap, utcDay } from "./sandboxBudget";
import { OPS_SOURCES } from "./sources";
import { breakerFromRow, breakerKey, effectivePhase, type BreakerPhase } from "./sourceBreaker";

/**
 * Everything /platform/ops shows, in one read. Platform admins only: the page
 * and the route both check isPlatformAdmin before calling this. Nothing in it
 * is tenant data -- job names, switch keys, counts and dollars -- so it is not
 * scoped by org, the same as the tracker ops report beside it.
 *
 * Every section degrades on its own: with the ops tables absent the jobs show
 * no heartbeat, every switch on, every breaker closed and no meters, which is
 * exactly how production behaves until the tables are applied.
 */

export type OpsJob = {
  job: string;
  label: string;
  schedule: string;
  cadenceMinutes: number;
  health: JobHealth;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  durationMs: number | null;
  consecutiveFailures: number;
};

export type OpsSwitch = { key: string; kind: "cron" | "source"; off: boolean; reason: string | null; updatedBy: string | null; updatedAt: string | null };

export type OpsBreaker = {
  key: string;
  phase: BreakerPhase;
  consecutiveFailures: number;
  openedAt: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  lastReason: string | null;
};

export type OpsMeter = MeterRow & { label: string; weeklyLowUsd: number; weeklyHighUsd: number };

export type OpsGuardsReport = {
  tablesReady: boolean;
  generatedAt: string;
  jobs: OpsJob[];
  switches: OpsSwitch[];
  switchLog: { key: string; off: boolean; reason: string | null; changedBy: string | null; changedAt: string }[];
  breakers: OpsBreaker[];
  sandbox: {
    day: string;
    cap: number;
    capFromEnv: boolean;
    used: number;
    refused: number;
    byCaller: { caller: string; creations: number; refused: number; closed: number; seconds: number }[];
  };
  meters: OpsMeter[];
  neonConfigured: boolean;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function opsGuardsReport(nowMs = Date.now()): Promise<OpsGuardsReport> {
  const tablesReady = await opsTablesReady();
  /* A flip on this page must show at once, not after the 30 s cache. */
  resetKillSwitchCache();
  const switchMap = await readKillSwitches(nowMs).catch(() => new Map());
  const day = utcDay(nowMs);

  let heartbeats: OpsCronHeartbeat[] = [];
  let breakerRows: OpsSourceBreaker[] = [];
  let sandboxRows: { caller: string; creations: number; refused: number; closed: number; seconds: number }[] = [];
  let log: OpsGuardsReport["switchLog"] = [];

  if (tablesReady) {
    const db = await opsDb();
    const [hb, br, sb, lg] = await Promise.all([
      db.opsCronHeartbeat.findMany().catch(() => []),
      db.opsSourceBreaker.findMany().catch(() => []),
      db.opsSandboxDay
        .findMany({ where: { day }, select: { caller: true, creations: true, refused: true, closed: true, seconds: true } })
        .catch(() => []),
      db.opsKillSwitchLog.findMany({ orderBy: { changedAt: "desc" }, take: 12 }).catch(() => []),
    ]);
    heartbeats = hb;
    breakerRows = br;
    sandboxRows = sb;
    log = lg.map((l) => ({ key: l.key, off: l.off, reason: l.reason, changedBy: l.changedBy, changedAt: l.changedAt.toISOString() }));
  }

  const byJob = new Map(heartbeats.map((h) => [h.job, h]));
  const jobs: OpsJob[] = CRON_JOBS.map((j) => {
    const h = byJob.get(j.job);
    return {
      job: j.job,
      label: j.label,
      schedule: j.schedule,
      cadenceMinutes: cronCadenceMinutes(j.job),
      health: jobHealth(j.job, h, nowMs, switchMap.get(cronKillKey(j.job))?.off === true),
      lastStartedAt: iso(h?.lastStartedAt),
      lastFinishedAt: iso(h?.lastFinishedAt),
      lastOk: h?.lastOk ?? null,
      lastError: h?.lastError ?? null,
      durationMs: h?.durationMs ?? null,
      consecutiveFailures: h?.consecutiveFailures ?? 0,
    };
  });

  const switches: OpsSwitch[] = KILL_SWITCH_KEYS.map((key) => {
    const s = switchMap.get(key);
    return {
      key,
      kind: key.startsWith(SOURCE_KILL_PREFIX) ? "source" : "cron",
      off: s?.off === true,
      reason: s?.reason ?? null,
      updatedBy: s?.updatedBy ?? null,
      updatedAt: iso(s?.updatedAt),
    };
  });

  const breakers: OpsBreaker[] = (["creator-reads", "post-reads"] as const).flatMap((reader) =>
    OPS_SOURCES.map((source) => {
      const key = breakerKey(reader, source);
      const row = breakerRows.find((r) => r.key === key);
      const s = breakerFromRow(row);
      return {
        key,
        phase: effectivePhase(s, nowMs),
        consecutiveFailures: s.consecutiveFailures,
        openedAt: s.openedAt ? new Date(s.openedAt).toISOString() : null,
        lastFailureAt: s.lastFailureAt ? new Date(s.lastFailureAt).toISOString() : null,
        lastSuccessAt: s.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString() : null,
        lastReason: s.lastReason,
      };
    }),
  );

  const meterRows = await latestMeters();
  const meters: OpsMeter[] = METERS.map((m: MeterName) => {
    const r = meterRows.find((x) => x.meter === m);
    const model = weeklyModel(m);
    return {
      ...(r ?? {
        meter: m,
        weekStart: "",
        status: "not-configured" as const,
        value: null,
        unit: "",
        costUsd: null,
        budgetUsd: model.high,
        ratio: null,
        detail: { note: "no week read yet" },
      }),
      label: METER_LABELS[m],
      weeklyLowUsd: model.low,
      weeklyHighUsd: model.high,
    };
  });

  return {
    tablesReady,
    generatedAt: new Date(nowMs).toISOString(),
    jobs,
    switches,
    switchLog: log,
    breakers,
    sandbox: {
      day,
      cap: sandboxDailyCap(),
      capFromEnv: Boolean(process.env.SANDBOX_DAILY_CAP) && sandboxDailyCap() === Number(process.env.SANDBOX_DAILY_CAP),
      used: sandboxRows.reduce((a, r) => a + r.creations, 0),
      refused: sandboxRows.reduce((a, r) => a + r.refused, 0),
      byCaller: sandboxRows.sort((a, b) => b.creations - a.creations),
    },
    meters,
    neonConfigured: Boolean(process.env.NEON_API_KEY?.trim() && process.env.NEON_ORG_ID?.trim()),
  };
}
