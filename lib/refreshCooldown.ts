/**
 * How soon a campaign may be refreshed again.
 *
 * Lives here, away from any one route, because more than one caller can start
 * a refresh: the Refresh Data button, and the MCP server's tool. A cooldown
 * that only the HTTP route knew about would be no cooldown at all -- an agent
 * could spend the campaign's whole allowance while the button politely waited,
 * and the platform on the other end does not care which of ours it was.
 *
 * It is a row rather than a counter in memory. The in-memory limiter this
 * replaced gave every fresh serverless instance a fresh allowance, so two
 * clicks a minute apart both ran; a row is the same answer for every instance,
 * survives a reload, and is the same fact the progress display reads.
 */

/** Thirty minutes, matching the interval CreatorCore holds the same button to. */
export const REFRESH_COOLDOWN_MS = 30 * 60 * 1000;

export type RefreshRunRow = {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  total: number;
  completed: number;
  measured: number;
  noMetrics: number;
  unfetchable: number;
  failed: number;
  remaining: number;
  reasons: unknown;
} | null;

export type CooldownState = {
  canRefresh: boolean;
  retryAfterSeconds: number;
  nextRefreshAt: string | null;
  lastRefreshAt: string | null;
  /** Present while a run is still going, so the caller can show N of M. */
  running: null | { runId: string; total: number; completed: number };
};

/**
 * A run counts against the cooldown from the moment it STARTED, not when it
 * finished. Otherwise a long refresh would be punished for its length, and a
 * run that died without ever writing finishedAt would lock the campaign out
 * for good.
 */
export function cooldownStateFrom(run: RefreshRunRow, now: Date = new Date()): CooldownState {
  if (!run) {
    return {
      canRefresh: true,
      retryAfterSeconds: 0,
      nextRefreshAt: null,
      lastRefreshAt: null,
      running: null,
    };
  }

  const readyAt = run.startedAt.getTime() + REFRESH_COOLDOWN_MS;
  const remainingMs = readyAt - now.getTime();
  const canRefresh = remainingMs <= 0;

  /* Only reported as running while it could still plausibly be running. A
     function that is killed mid-run never writes its final status, and without
     this the button would spin forever on a run that ended when the process
     did. */
  const looksAlive =
    run.status === "running" && now.getTime() - run.startedAt.getTime() < 5 * 60 * 1000;

  return {
    canRefresh,
    retryAfterSeconds: canRefresh ? 0 : Math.ceil(remainingMs / 1000),
    nextRefreshAt: canRefresh ? null : new Date(readyAt).toISOString(),
    lastRefreshAt: run.startedAt.toISOString(),
    running: looksAlive
      ? { runId: run.id, total: run.total, completed: run.completed }
      : null,
  };
}

/**
 * What to tell someone who pressed too soon.
 *
 * Minutes, rounded up, because a countdown to the second on a thirty minute
 * wait is precision nobody asked for -- and rounding down would say "0 minutes"
 * to somebody who still cannot go.
 */
export function tooSoonMessage(retryAfterSeconds: number): string {
  const mins = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Please wait ${mins} min${mins === 1 ? "" : "s"} before refreshing again for the latest updates.`;
}
