import { db } from "@/lib/db";
import {
  planBReadiness,
  planBWorkerConfig,
  resolveTrackerPlan,
  trackerSourceTablesReady,
  type PlanBReadiness,
  type ResolvedTrackerPlan,
} from "./sourceSwitch";

/**
 * Everything the tracker ops page shows, in one read. Platform-admin only:
 * the route and the page both check isPlatformAdmin before calling this, and
 * nothing in it is tenant data beyond org names and counts.
 */

export type PlanDay = { runs: number; reads: number; proper: number; walls: number; failures: number; lastRunAt: string | null; lastOk: boolean | null };

export type TrackerOpsReport = {
  tablesReady: boolean;
  plan: ResolvedTrackerPlan;
  planB: PlanBReadiness & { configured: boolean };
  day: Record<"A" | "B", PlanDay>;
  recent: { plan: string; kind: string; startedAt: string; reads: number; proper: number; walls: number; failures: number; medianMs: number | null; ok: boolean }[];
  switchLog: { fromPosition: string | null; toPosition: string; percent: number; scopeOrgIds: string[]; changedBy: string | null; changedAt: string; note: string | null }[];
  quarantine: { held: number; rejected: number };
  orgs: { id: string; name: string; tracked: number }[];
};

const emptyDay = (): PlanDay => ({ runs: 0, reads: 0, proper: 0, walls: 0, failures: 0, lastRunAt: null, lastOk: null });

export async function trackerOpsReport(nowMs = Date.now()): Promise<TrackerOpsReport> {
  const tablesReady = await trackerSourceTablesReady();
  const [plan, planB] = await Promise.all([resolveTrackerPlan(), planBReadiness(nowMs)]);
  const since = new Date(nowMs - 24 * 60 * 60 * 1000);

  const day: Record<"A" | "B", PlanDay> = { A: emptyDay(), B: emptyDay() };
  let recent: TrackerOpsReport["recent"] = [];
  let switchLog: TrackerOpsReport["switchLog"] = [];
  const quarantine = { held: 0, rejected: 0 };

  if (tablesReady) {
    const [runs, rows, log, q] = await Promise.all([
      db.trackerSourceHealth.findMany({
        where: { kind: "run", startedAt: { gte: since } },
        orderBy: { startedAt: "desc" },
        select: { plan: true, startedAt: true, reads: true, proper: true, walls: true, failures: true, ok: true },
      }),
      db.trackerSourceHealth.findMany({
        orderBy: { startedAt: "desc" },
        take: 12,
        select: { plan: true, kind: true, startedAt: true, reads: true, proper: true, walls: true, failures: true, medianMs: true, ok: true },
      }),
      db.trackerSourceSwitchLog.findMany({ orderBy: { changedAt: "desc" }, take: 10 }),
      db.trackerReadingQuarantine.groupBy({ by: ["verdict"], where: { recordedAt: { gte: since } }, _count: { _all: true } }),
    ]);
    for (const r of runs) {
      if (r.plan !== "A" && r.plan !== "B") continue;
      const d = day[r.plan];
      d.runs++;
      d.reads += r.reads;
      d.proper += r.proper;
      d.walls += r.walls;
      d.failures += r.failures;
      if (!d.lastRunAt) {
        d.lastRunAt = r.startedAt.toISOString();
        d.lastOk = r.ok;
      }
    }
    recent = rows.map((r) => ({ ...r, startedAt: r.startedAt.toISOString() }));
    switchLog = log.map((l) => ({
      fromPosition: l.fromPosition,
      toPosition: l.toPosition,
      percent: l.percent,
      scopeOrgIds: l.scopeOrgIds,
      changedBy: l.changedBy,
      changedAt: l.changedAt.toISOString(),
      note: l.note,
    }));
    for (const g of q) {
      if (g.verdict === "held") quarantine.held = g._count._all;
      if (g.verdict === "rejected") quarantine.rejected = g._count._all;
    }
  }

  const orgRows = await db.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const tracked = await db.creator.groupBy({
    by: ["orgId"],
    where: { deletedAt: null, trackedSince: { not: null } },
    _count: { _all: true },
  });
  const trackedBy = new Map(tracked.map((t) => [t.orgId, t._count._all]));
  const orgs = orgRows
    .map((o) => ({ id: o.id, name: o.name, tracked: trackedBy.get(o.id) ?? 0 }))
    .filter((o) => o.tracked > 0);

  return { tablesReady, plan, planB: { ...planB, configured: Boolean(planBWorkerConfig()) }, day, recent, switchLog, quarantine, orgs };
}
