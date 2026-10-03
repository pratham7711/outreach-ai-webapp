/**
 * Instagram post reads, paced hourly until the Meta app is approved.
 *
 * Business Discovery shares one app-wide budget -- about 200 calls an hour per
 * app user -- between the creator sweeps, the roster and avatar refreshes,
 * every Refresh and the post sweep. Reading a hundred Instagram posts in one
 * burst every six hours ran into Meta's code 4 inside the burst (2026-10-03),
 * so the post sweep's Instagram share now runs as its own small pass every
 * hour (/api/cron/sync-instagram-posts), stopping at POST_SWEEP_STOP_PERCENT of
 * the usage Meta reports. The 6-hourly sweep leaves Instagram to it.
 *
 * SYNC_INSTAGRAM_HOURLY=off hands Instagram back to the 6-hourly sweep exactly
 * as it was; the hourly route then answers "off" and reads nothing.
 */

export const INSTAGRAM_HOURLY_ENV = "SYNC_INSTAGRAM_HOURLY";
export const INSTAGRAM_HOURLY_BUDGET_ENV = "SYNC_BUDGET_INSTAGRAM_HOURLY";
/** A ceiling per pass, not a target: the usage threshold usually ends a pass first. */
export const DEFAULT_INSTAGRAM_HOURLY_BUDGET = 25;

export function instagramPacedHourly(env: Record<string, string | undefined> = process.env): boolean {
  return (env[INSTAGRAM_HOURLY_ENV] ?? "").trim().toLowerCase() !== "off";
}

export function instagramHourlyBudget(env: Record<string, string | undefined> = process.env): number {
  const raw = (env[INSTAGRAM_HOURLY_BUDGET_ENV] ?? "").trim();
  const n = Number(raw);
  return raw !== "" && Number.isInteger(n) && n >= 0 ? n : DEFAULT_INSTAGRAM_HOURLY_BUDGET;
}
