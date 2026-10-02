import { createLogger } from "@/lib/observability/logger";
import { quotaDb, quotaTablesReady } from "./quotaTables";

/**
 * Units spent per quota day and bucket (plan §13 B).
 *
 * The day is the provider's, not ours: YouTube resets every Data API quota at
 * midnight Pacific time, so a UTC day would straddle two of its buckets. The
 * caller names the day; pacificDay below is YouTube's.
 *
 * Every read answers null when the count cannot be known (no table, a failed
 * query), and null always means "allowed" -- the counter is accounting and a
 * runaway guard, never a reason to stop a read the provider would have served.
 * Writes are atomic increments (ON CONFLICT), for the same reason as the
 * Sandbox counter: two lanes counting the first call of the day must not lose
 * one of them.
 */

export type QuotaColumn = "units" | "calls" | "refused" | "quotaErrors";

const log = () => createLogger({ context: { lib: "ops/quotaDay" } });

const PACIFIC = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Pacific-time day a moment falls in, "YYYY-MM-DD" -- YouTube's quota day. */
export function pacificDay(ms: number): string {
  return PACIFIC.format(new Date(ms));
}

/** Units recorded so far for a bucket on a day, or null when that cannot be known. */
export async function quotaUnitsUsed(day: string, bucket: string): Promise<number | null> {
  if (!(await quotaTablesReady())) return null;
  try {
    const db = await quotaDb();
    const row = await db.opsQuotaDay.findUnique({
      where: { day_bucket: { day, bucket } },
      select: { units: true },
    });
    return row?.units ?? 0;
  } catch {
    return null;
  }
}

/** Pure: may one more call be made? Unknown use always may. */
export function quotaAllows(used: number | null, cap: number, cost = 1): boolean {
  if (used === null || !Number.isFinite(used)) return true;
  return used + cost <= cap;
}

/** Adds to a day's counters. Never throws; a lost count is logged, not fatal. */
export async function recordQuota(day: string, bucket: string, add: Partial<Record<QuotaColumn, number>>): Promise<void> {
  const cols = (Object.keys(add) as QuotaColumn[]).filter((c) => Number.isFinite(add[c]) && (add[c] ?? 0) !== 0);
  if (cols.length === 0) return;
  if (!(await quotaTablesReady())) return;
  try {
    const db = await quotaDb();
    /* Column names come from the QuotaColumn union, never from input. */
    const values = cols.map((c) => Math.trunc(add[c] ?? 0));
    const placeholders = cols.map((_, i) => `$${i + 3}`);
    await db.$executeRawUnsafe(
      `INSERT INTO "OpsQuotaDay" ("day", "bucket", ${cols.map((c) => `"${c}"`).join(", ")}, "updatedAt")
       VALUES ($1, $2, ${placeholders.join(", ")}, now())
       ON CONFLICT ("day", "bucket") DO UPDATE SET
         ${cols.map((c, i) => `"${c}" = "OpsQuotaDay"."${c}" + $${i + 3}`).join(",\n         ")},
         "updatedAt" = now()`,
      day,
      bucket,
      ...values,
    );
  } catch (e) {
    log().warn("quota count not recorded", { bucket, error: e instanceof Error ? e.message : String(e) });
  }
}
