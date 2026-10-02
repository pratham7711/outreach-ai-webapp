import type { Prisma } from "@/lib/generated/prisma";
import { alertOps } from "@/lib/alerts";
import { createLogger } from "@/lib/observability/logger";
import { opsDb, opsTablesReady } from "./opsTables";

/**
 * Weekly spend meters (plan §13 M; the scale report's "before 4k").
 *
 * Once a week, for the week that just ended (Monday 00:00 UTC to Monday 00:00
 * UTC), two numbers are read and set against the scale report's model at the
 * 4k line:
 *
 *   neon-compute     Neon's own consumption API, compute_unit_seconds summed
 *                    over the week -> CU-hours x $0.106 (Launch). Model: $19-39
 *                    a month (0.25-0.5 CU always on x 730 h x $0.106).
 *   sandbox-compute  our own counter (OpsSandboxDay, written by createSandbox)
 *                    -> vCPU-hours x $0.046, the report's price of one sandbox
 *                    hour at vcpus:1. Model: $9-22 a month.
 *
 * A month is 730 h, so a week is 168/730 of each monthly figure. A meter at or
 * above 120% of the UPPER bound is "over" and raises one alertOps.
 *
 * Vercel's billing and usage APIs are not called: they answer 404 to a normal
 * user token (measured 2026-09-03), and the Sandbox counter is ours to read.
 *
 * Every outcome is a row, so a missing week is itself visible: "not-configured"
 * when NEON_API_KEY or NEON_ORG_ID is unset, "error" when the read failed. No
 * path here throws -- a meter is never a reason for a cron to fail.
 */

export const NEON_USD_PER_CU_HOUR = 0.106;
export const SANDBOX_USD_PER_VCPU_HOUR = 0.046;
export const HOURS_PER_MONTH = 730;
export const HOURS_PER_WEEK = 168;
/** Alert when a week costs this multiple of the model's upper bound. */
export const OVER_MODEL_RATIO = 1.2;

export const METERS = ["neon-compute", "sandbox-compute"] as const;
export type MeterName = (typeof METERS)[number];

/** The scale report's monthly model at the 4k line, in USD. */
export const MONTHLY_MODEL_4K: Record<MeterName, { low: number; high: number }> = {
  "neon-compute": { low: 19, high: 39 },
  "sandbox-compute": { low: 9, high: 22 },
};

export const METER_LABELS: Record<MeterName, string> = {
  "neon-compute": "Neon compute",
  "sandbox-compute": "Sandbox compute",
};

export const NEON_METRICS = [
  "compute_unit_seconds",
  "root_branch_bytes_month",
  "child_branch_bytes_month",
  "public_network_transfer_bytes",
] as const;

const NEON_TIMEOUT_MS = 20_000;

export function weeklyFromMonthly(usd: number): number {
  return (usd * HOURS_PER_WEEK) / HOURS_PER_MONTH;
}

export function weeklyModel(meter: MeterName): { low: number; high: number } {
  const m = MONTHLY_MODEL_4K[meter];
  return { low: weeklyFromMonthly(m.low), high: weeklyFromMonthly(m.high) };
}

/** Pure: the week before the one `nowMs` falls in, Monday to Monday, UTC. */
export function previousWeek(nowMs: number): { weekStart: string; from: Date; to: Date } {
  const d = new Date(nowMs);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  const to = new Date(midnight - sinceMonday * 86_400_000);
  const from = new Date(to.getTime() - 7 * 86_400_000);
  return { weekStart: from.toISOString().slice(0, 10), from, to };
}

/** Pure: cost against the weekly upper bound. */
export function compareToModel(meter: MeterName, costUsd: number): { budgetUsd: number; ratio: number; status: "ok" | "over" } {
  const budgetUsd = weeklyModel(meter).high;
  const ratio = budgetUsd > 0 ? costUsd / budgetUsd : 0;
  return { budgetUsd, ratio, status: ratio >= OVER_MODEL_RATIO ? "over" : "ok" };
}

export function neonConsumptionUrl(input: { from: Date; to: Date; orgId: string }): string {
  const q = new URLSearchParams({
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    granularity: "daily",
    org_id: input.orgId,
    metrics: NEON_METRICS.join(","),
  });
  return `https://console.neon.tech/api/v2/consumption_history/v2/projects?${q.toString()}`;
}

export type NeonTotals = {
  /** Projects in the response, before any filter. */
  projects: number;
  /** Projects summed: all of them, or the one NEON_PROJECT_ID names. */
  summed: string[];
  totals: Record<string, number>;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Pure: totals per metric from a consumption response.
 *
 * Defensive by necessity. neonctl answers a bare array where the API answers
 * {projects: [...]}, and both are accepted. Inside, the shape measured on
 * 2026-10-02 is projects[].periods[].consumption[].metrics[] of
 * {metric_name, value}; anything that does not fit is skipped rather than
 * guessed at. Null when the body has no project list at all.
 */
export function parseNeonConsumption(body: unknown, projectId?: string | null): NeonTotals | null {
  const projects = Array.isArray(body) ? body : isObj(body) && Array.isArray(body.projects) ? body.projects : null;
  if (!projects) return null;
  const totals: Record<string, number> = {};
  const summed: string[] = [];
  for (const p of projects) {
    if (!isObj(p)) continue;
    const id = typeof p.project_id === "string" ? p.project_id : null;
    if (projectId && id !== projectId) continue;
    if (id) summed.push(id);
    for (const period of arr(p.periods)) {
      if (!isObj(period)) continue;
      for (const slot of arr(period.consumption)) {
        if (!isObj(slot)) continue;
        for (const m of arr(slot.metrics)) {
          if (!isObj(m) || typeof m.metric_name !== "string") continue;
          const v = Number(m.value);
          if (!Number.isFinite(v)) continue;
          totals[m.metric_name] = (totals[m.metric_name] ?? 0) + v;
        }
      }
    }
  }
  return { projects: projects.length, summed, totals };
}

export type MeterRow = {
  meter: MeterName;
  weekStart: string;
  status: "ok" | "over" | "not-configured" | "error";
  value: number | null;
  unit: string;
  costUsd: number | null;
  budgetUsd: number;
  ratio: number | null;
  detail: Record<string, unknown>;
};

function row(meter: MeterName, weekStart: string, unit: string, rest: Partial<MeterRow> & Pick<MeterRow, "status">): MeterRow {
  return {
    meter,
    weekStart,
    unit,
    value: null,
    costUsd: null,
    ratio: null,
    budgetUsd: weeklyModel(meter).high,
    detail: {},
    ...rest,
  };
}

function priced(meter: MeterName, weekStart: string, unit: string, value: number, costUsd: number, detail: Record<string, unknown>): MeterRow {
  const c = compareToModel(meter, costUsd);
  return row(meter, weekStart, unit, { status: c.status, value, costUsd, budgetUsd: c.budgetUsd, ratio: c.ratio, detail });
}

export async function readNeonMeter(
  week: { weekStart: string; from: Date; to: Date },
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<MeterRow> {
  const apiKey = env.NEON_API_KEY?.trim();
  const orgId = env.NEON_ORG_ID?.trim();
  const projectId = env.NEON_PROJECT_ID?.trim() || null;
  if (!apiKey || !orgId) {
    return row("neon-compute", week.weekStart, "CU-hours", {
      status: "not-configured",
      detail: { missing: [!apiKey && "NEON_API_KEY", !orgId && "NEON_ORG_ID"].filter(Boolean) },
    });
  }
  try {
    const res = await fetchImpl(neonConsumptionUrl({ from: week.from, to: week.to, orgId }), {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(NEON_TIMEOUT_MS),
    });
    if (!res.ok) {
      return row("neon-compute", week.weekStart, "CU-hours", { status: "error", detail: { httpStatus: res.status } });
    }
    const body: unknown = await res.json();
    const parsed = parseNeonConsumption(body, projectId);
    if (!parsed) return row("neon-compute", week.weekStart, "CU-hours", { status: "error", detail: { reason: "no project list in the response" } });
    if (projectId && parsed.summed.length === 0) {
      return row("neon-compute", week.weekStart, "CU-hours", {
        status: "error",
        detail: { reason: "NEON_PROJECT_ID is not in the response", projects: parsed.projects },
      });
    }
    const cuHours = (parsed.totals.compute_unit_seconds ?? 0) / 3600;
    const paginated = isObj(body) && isObj(body.pagination) && Boolean(body.pagination.cursor ?? body.pagination.next);
    return priced("neon-compute", week.weekStart, "CU-hours", cuHours, cuHours * NEON_USD_PER_CU_HOUR, {
      scope: projectId ? "project" : "org",
      projects: parsed.summed.length,
      totals: parsed.totals,
      ...(paginated ? { paginated: true } : {}),
    });
  } catch (e) {
    /* The message only: the request carried the key in a header, and nothing
       of it may reach a row or a log. */
    return row("neon-compute", week.weekStart, "CU-hours", {
      status: "error",
      detail: { reason: e instanceof Error ? e.name : "fetch failed" },
    });
  }
}

export async function readSandboxMeter(week: { weekStart: string; from: Date; to: Date }): Promise<MeterRow> {
  const unit = "vCPU-hours";
  if (!(await opsTablesReady())) {
    return row("sandbox-compute", week.weekStart, unit, { status: "not-configured", detail: { missing: ["ops tables"] } });
  }
  try {
    const db = await opsDb();
    const end = week.to.toISOString().slice(0, 10);
    const agg = await db.opsSandboxDay.aggregate({
      where: { day: { gte: week.weekStart, lt: end } },
      _sum: { creations: true, closed: true, refused: true, seconds: true, vcpuSeconds: true },
    });
    const s = agg._sum;
    const vcpuHours = (s.vcpuSeconds ?? 0) / 3600;
    return priced("sandbox-compute", week.weekStart, unit, vcpuHours, vcpuHours * SANDBOX_USD_PER_VCPU_HOUR, {
      creations: s.creations ?? 0,
      closed: s.closed ?? 0,
      refused: s.refused ?? 0,
      sandboxHours: (s.seconds ?? 0) / 3600,
      /* Lifetimes are measured at delete. A sandbox left to time out is
         counted as created but not timed, so this is a floor when the two
         differ. */
      untimed: Math.max(0, (s.creations ?? 0) - (s.closed ?? 0)),
    });
  } catch (e) {
    return row("sandbox-compute", week.weekStart, unit, {
      status: "error",
      detail: { reason: e instanceof Error ? e.message.slice(0, 200) : "read failed" },
    });
  }
}

async function saveRow(r: MeterRow, readAt: Date): Promise<boolean> {
  if (!(await opsTablesReady())) return false;
  try {
    const db = await opsDb();
    const data = {
      meter: r.meter,
      weekStart: r.weekStart,
      status: r.status,
      value: r.value,
      unit: r.unit,
      costUsd: r.costUsd,
      budgetUsd: r.budgetUsd,
      ratio: r.ratio,
      detail: r.detail as Prisma.InputJsonValue,
      readAt,
    };
    const id = `${r.meter}:${r.weekStart}`;
    await db.opsMeterWeek.upsert({ where: { id }, create: { id, ...data }, update: data, select: { id: true } });
    return true;
  } catch (e) {
    createLogger({ context: { lib: "ops/meters" } }).warn("meter row not saved", {
      meter: r.meter,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/** Pure: the alert a row raises, if any. */
export function meterAlert(r: MeterRow): Parameters<typeof alertOps>[0] | null {
  const label = METER_LABELS[r.meter];
  if (r.status === "over" && r.costUsd !== null && r.ratio !== null) {
    return {
      source: "ops-meters",
      title: `${label} last week at ${Math.round(r.ratio * 100)}% of the 4k model`,
      severity: "warn",
      facts: {
        weekStart: r.weekStart,
        value: `${r.value?.toFixed(1)} ${r.unit}`,
        costUsd: r.costUsd.toFixed(2),
        weeklyModelUsd: `${weeklyModel(r.meter).low.toFixed(2)}-${weeklyModel(r.meter).high.toFixed(2)}`,
        threshold: `${Math.round(OVER_MODEL_RATIO * 100)}% of the upper bound`,
      },
    };
  }
  if (r.status === "error") {
    return {
      source: "ops-meters",
      title: `${label} meter could not be read`,
      severity: "warn",
      facts: { weekStart: r.weekStart, ...r.detail },
    };
  }
  return null;
}

/** Reads both meters for last week, stores a row each, alerts. Never throws. */
export async function runMeters(
  options: { nowMs?: number; dryRun?: boolean; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {},
): Promise<{ weekStart: string; rows: (MeterRow & { saved: boolean })[] }> {
  const nowMs = options.nowMs ?? Date.now();
  const week = previousWeek(nowMs);
  const rows = await Promise.all([
    readNeonMeter(week, options.env ?? process.env, options.fetchImpl ?? fetch).catch(() =>
      row("neon-compute", week.weekStart, "CU-hours", { status: "error", detail: { reason: "unexpected" } }),
    ),
    readSandboxMeter(week).catch(() =>
      row("sandbox-compute", week.weekStart, "vCPU-hours", { status: "error", detail: { reason: "unexpected" } }),
    ),
  ]);
  const out: (MeterRow & { saved: boolean })[] = [];
  for (const r of rows) {
    const saved = options.dryRun ? false : await saveRow(r, new Date(nowMs));
    out.push({ ...r, saved });
    const alert = options.dryRun ? null : meterAlert(r);
    if (alert) await alertOps(alert).catch(() => undefined);
  }
  return { weekStart: week.weekStart, rows: out };
}

export async function latestMeters(): Promise<MeterRow[]> {
  if (!(await opsTablesReady())) return [];
  try {
    const db = await opsDb();
    const rows = await db.opsMeterWeek.findMany({ orderBy: { weekStart: "desc" }, take: 16 });
    const latest = new Map<string, MeterRow>();
    for (const r of rows) {
      if (latest.has(r.meter) || !(METERS as readonly string[]).includes(r.meter)) continue;
      latest.set(r.meter, {
        meter: r.meter as MeterName,
        weekStart: r.weekStart,
        status: r.status as MeterRow["status"],
        value: r.value,
        unit: r.unit ?? "",
        costUsd: r.costUsd,
        budgetUsd: r.budgetUsd ?? weeklyModel(r.meter as MeterName).high,
        ratio: r.ratio,
        detail: (r.detail ?? {}) as Record<string, unknown>,
      });
    }
    return METERS.flatMap((m) => (latest.has(m) ? [latest.get(m)!] : []));
  } catch {
    return [];
  }
}
