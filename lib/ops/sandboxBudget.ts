import { Sandbox } from "@vercel/sandbox";
import { alertOps } from "@/lib/alerts";
import { createLogger } from "@/lib/observability/logger";
import { opsDb, opsTablesReady } from "./opsTables";

/**
 * Every Vercel Sandbox this app creates goes through createSandbox (plan §13 M):
 * it is counted per UTC day, its lifetime is measured when it is deleted, and
 * above a daily cap a new one is refused. Being the one call site, it is also
 * where persistent:false and an explicit timeout are made unconditional -- a
 * persistent stop snapshots 642MB and bills it for 30 days.
 *
 * The cap is a runaway guard, not a budget. The spend alert is the weekly
 * meter's job (lib/ops/meters, 120% of the scale report's model); this is the
 * floor under it for the failure the meter is too slow to catch -- a loop that
 * boots sandboxes all afternoon. So the default is generous.
 *
 * DEFAULT_SANDBOX_DAILY_CAP = 600, from the code's own schedules (not measured;
 * no counter existed until this one):
 *   legacy creator sweep       12 runs x 1 sandbox                  =  12
 *   roster profiles, avatars   24 + 24 runs x at most 1 (lazy)      <= 48
 *   sound sweeps               4 + 1 runs x at most 1               <=  5
 *   post sync                  4 runs x 2 lanes                     =   8
 *   on-demand refreshes        a few a day x up to 8 lanes          ~  30
 *                                                         today   ~ 100
 *   reader v2 at position A    24 runs x 5 lanes (TRACKER_V2_MAX_LANES) = 120
 *                                                      with A on   ~ 220
 * 600 is about 3x the day with A on, the position the plan moves to next, so
 * neither a busy refresh day nor lane replacements (up to 2x lanes per run)
 * reach it. At ~5 min x 2 vCPU a sandbox, 600 is ~100 vCPU-hours, ~$4.60 a day
 * at $0.046 a vCPU-hour -- the most a runaway can cost before it is stopped.
 *
 * A refused creation rejects like any failed boot, and every caller already
 * treats a failed boot as a dead lane: the reader-v2 exit answers null (no
 * reading, the last good value stays), the profile fetcher answers
 * "unreadable", the post pool retires the lane and the post falls back to the
 * direct fetch. Nothing is written over good data.
 *
 * Never a reason to stop a sandbox that would otherwise boot: an absent table,
 * an unreadable count -- all allow. The count is read before and written after
 * each creation, so lanes booting together can overshoot the cap by the number
 * of lanes; that is a few sandboxes past a runaway guard, not a leak.
 */

export const DEFAULT_SANDBOX_DAILY_CAP = 600;
/** Vercel's default when a caller passes no resources (tiktokExit's note). */
export const DEFAULT_SANDBOX_VCPUS = 2;

/** What callers pass: Sandbox.create's own options, with the lifetime required. */
export type SandboxParams = NonNullable<Parameters<typeof Sandbox.create>[0]> & { timeout: number };

export function sandboxDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SANDBOX_DAILY_CAP);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_SANDBOX_DAILY_CAP;
}

/** The UTC day a moment falls in, "YYYY-MM-DD". */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Pure: may one more sandbox be created today? Unknown use always may. */
export function capAllows(usedToday: number | null, cap: number): boolean {
  if (usedToday === null || !Number.isFinite(usedToday)) return true;
  return usedToday < cap;
}

export class SandboxCapError extends Error {
  readonly code = "sandbox-daily-cap";
  constructor(used: number, cap: number) {
    super(`Sandbox daily cap reached: ${used} of ${cap} created today (UTC)`);
    this.name = "SandboxCapError";
  }
}

const log = () => createLogger({ context: { lib: "ops/sandboxBudget" } });

/** Sandboxes created so far on a UTC day, or null when that cannot be known. */
export async function sandboxesCreatedOn(day: string): Promise<number | null> {
  if (!(await opsTablesReady())) return null;
  try {
    const db = await opsDb();
    const agg = await db.opsSandboxDay.aggregate({ where: { day }, _sum: { creations: true } });
    return agg._sum.creations ?? 0;
  } catch {
    return null;
  }
}

/* Raw upserts, not Prisma's: lanes boot together, and two first-of-the-day
   creations racing an upsert-by-read would lose one of the counts. ON CONFLICT
   makes each increment one atomic statement. */
async function bump(day: string, caller: string, column: "creations" | "refused"): Promise<void> {
  if (!(await opsTablesReady())) return;
  try {
    const db = await opsDb();
    await db.$executeRawUnsafe(
      `INSERT INTO "OpsSandboxDay" ("day", "caller", "${column}", "updatedAt") VALUES ($1, $2, 1, now())
       ON CONFLICT ("day", "caller") DO UPDATE SET "${column}" = "OpsSandboxDay"."${column}" + 1, "updatedAt" = now()`,
      day,
      caller,
    );
  } catch (e) {
    log().warn("sandbox count not recorded", { column, error: e instanceof Error ? e.message : String(e) });
  }
}

async function recordClose(day: string, caller: string, seconds: number, vcpus: number): Promise<void> {
  if (!(await opsTablesReady())) return;
  try {
    const db = await opsDb();
    await db.$executeRawUnsafe(
      `INSERT INTO "OpsSandboxDay" ("day", "caller", "closed", "seconds", "vcpuSeconds", "updatedAt") VALUES ($1, $2, 1, $3, $4, now())
       ON CONFLICT ("day", "caller") DO UPDATE SET
         "closed" = "OpsSandboxDay"."closed" + 1,
         "seconds" = "OpsSandboxDay"."seconds" + $3,
         "vcpuSeconds" = "OpsSandboxDay"."vcpuSeconds" + $4,
         "updatedAt" = now()`,
      day,
      caller,
      seconds,
      seconds * vcpus,
    );
  } catch (e) {
    log().warn("sandbox lifetime not recorded", { error: e instanceof Error ? e.message : String(e) });
  }
}

let alertedDay: string | null = null;

/** For tests. */
export function resetSandboxBudgetState() {
  alertedDay = null;
}

/**
 * Times the sandbox from now to its delete, by wrapping delete on the
 * instance. A sandbox left to time out is never deleted through here, so its
 * seconds are not counted; the ops page shows closed against created.
 */
function meterLifetime(sandbox: Sandbox, day: string, caller: string, vcpus: number, startedAt: number): Sandbox {
  const target = sandbox as unknown as { delete?: (...args: unknown[]) => Promise<unknown> };
  const original = typeof target.delete === "function" ? target.delete.bind(sandbox) : null;
  if (!original) return sandbox;
  let counted = false;
  try {
    target.delete = async (...args: unknown[]) => {
      try {
        return await original(...args);
      } finally {
        if (!counted) {
          counted = true;
          await recordClose(day, caller, Math.max(0, (Date.now() - startedAt) / 1000), vcpus);
        }
      }
    };
  } catch {
    // A frozen instance keeps its own delete; only the seconds go unmeasured.
  }
  return sandbox;
}

/** Sandbox.create, counted and capped. `caller` names the pool in the counter. */
export async function createSandbox(params: SandboxParams, caller: string): Promise<Sandbox> {
  const now = Date.now();
  const day = utcDay(now);
  const cap = sandboxDailyCap();
  const used = await sandboxesCreatedOn(day);
  if (!capAllows(used, cap)) {
    await bump(day, caller, "refused");
    if (alertedDay !== day) {
      alertedDay = day;
      await alertOps({
        source: "sandbox-cap",
        title: `Sandbox daily cap reached: ${used} of ${cap} created today (UTC)`,
        severity: "critical",
        facts: {
          caller,
          action:
            "New sandboxes are refused until 00:00 UTC; readers hold their readings. Raise SANDBOX_DAILY_CAP only once the cause is known.",
        },
      });
    }
    throw new SandboxCapError(used ?? cap, cap);
  }
  const sandbox = await Sandbox.create({
    ...params,
    /* Whatever the caller passed: a persistent stop snapshots the whole
       filesystem and bills it for 30 days, and nothing here keeps state. */
    persistent: false,
    timeout: params.timeout,
  } as Parameters<typeof Sandbox.create>[0]);
  await bump(day, caller, "creations");
  const vcpus = (params as { resources?: { vcpus?: number } }).resources?.vcpus ?? DEFAULT_SANDBOX_VCPUS;
  return meterLifetime(sandbox, day, caller, vcpus, now);
}
