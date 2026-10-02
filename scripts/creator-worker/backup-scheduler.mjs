// The backup scheduler (plan §13 B): when one of the app's own crons misses
// its heartbeat, this box calls that cron route the way Vercel's scheduler
// does, so a Vercel cron outage does not stop the jobs.
//
//   node backup-scheduler.mjs              ask, trigger what is overdue, exit
//   node backup-scheduler.mjs --dry-run    ask and print the overdue job names only
//   node backup-scheduler.mjs --force      ask now, even before the app's recheck time
//
// Run by outreach-backup-scheduler.timer every 10 minutes. Each run:
//   1. GET  $APP_URL/api/ops/overdue-crons   (Bearer OPS_SCHEDULER_TOKEN)
//      -> {overdue: [{job, path, minutesOverdue}], recheckInMinutes}
//   2. GET  $APP_URL/api/cron/<job>          (Bearer CRON_SECRET, as Vercel sends)
//      for each overdue job, most overdue first.
//
// What keeps it small and safe:
//   - It talks to APP_URL and nothing else. It never reads TikTok -- or any
//     platform -- and a cron path is only called if it is exactly
//     /api/cron/<job>, so the cron secret cannot be sent anywhere else.
//   - Caps: at most one trigger per job per 30 minutes and at most 5 triggers
//     per run, remembered across runs in SCHEDULER_STATE_FILE. Triggers start
//     30 s apart, the way Vercel's own schedule spreads them.
//   - It sleeps until the app's recheckInMinutes between asks, because every
//     ask reads the heartbeat table and would otherwise wake the database at
//     minutes no cron uses.
//   - Logs carry job names and HTTP statuses only: never a token, never a
//     response body.
// Zero npm dependencies, like the rest of Plan B.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_TRIGGERS_PER_RUN = 5;
export const PER_JOB_COOLDOWN_MS = 30 * 60 * 1000;
/** Longer than any cron may run on Vercel (800 s), so a trigger is never cut
 *  off by us mid-run. */
export const TRIGGER_TIMEOUT_MS = 870_000;
export const TRIGGER_GAP_MS = 30_000;
export const ASK_TIMEOUT_MS = 30_000;
export const MAX_RECHECK_MINUTES = 60;
const KEEP_STATE_MS = 24 * 60 * 60 * 1000;
const JOB = /^[a-z0-9-]{1,64}$/;
const USER_AGENT = "outreach-backup-scheduler/1";

/** The app's origin. https only, except plain http on loopback for tests. */
export function appOrigin(raw) {
  let u;
  try {
    u = new URL(String(raw ?? ""));
  } catch {
    throw new Error("APP_URL is not a URL");
  }
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) throw new Error("APP_URL must be https");
  if (/(^|\.)tiktok\.com$/i.test(u.hostname)) throw new Error("APP_URL must be the app");
  return u.origin;
}

/** Only `{job, path:"/api/cron/<job>", minutesOverdue}` survives. */
export function validOverdue(entry) {
  return Boolean(
    entry &&
    typeof entry.job === "string" &&
    JOB.test(entry.job) &&
    entry.path === `/api/cron/${entry.job}` &&
    Number.isFinite(entry.minutesOverdue)
  );
}

/** Pure: which overdue jobs to trigger now, most overdue first, within both caps. */
export function selectTriggers(overdue, lastTriggered, nowMs, { max = MAX_TRIGGERS_PER_RUN, cooldownMs = PER_JOB_COOLDOWN_MS } = {}) {
  const seen = new Set();
  const picks = [];
  const sorted = (Array.isArray(overdue) ? overdue : []).filter(validOverdue).sort((a, b) => b.minutesOverdue - a.minutesOverdue);
  for (const o of sorted) {
    if (picks.length >= max) break;
    if (seen.has(o.job)) continue;
    seen.add(o.job);
    const last = lastTriggered?.[o.job];
    if (typeof last === "number" && nowMs - last < cooldownMs) continue;
    picks.push(o);
  }
  return picks;
}

export function emptyState() {
  return { lastTriggered: {}, nextAskAt: 0 };
}

export function loadState(file) {
  try {
    const s = JSON.parse(readFileSync(file, "utf8"));
    return {
      lastTriggered: s && typeof s.lastTriggered === "object" && s.lastTriggered ? s.lastTriggered : {},
      nextAskAt: Number.isFinite(s?.nextAskAt) ? s.nextAskAt : 0,
    };
  } catch {
    return emptyState();
  }
}

export function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  renameSync(tmp, file);
}

async function ask({ origin, token, fetchImpl }) {
  const res = await fetchImpl(`${origin}/api/ops/overdue-crons`, {
    headers: { authorization: `Bearer ${token}`, "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`overdue-crons answered ${res.status}`);
  const body = await res.json();
  const recheck = Number(body?.recheckInMinutes);
  return {
    overdue: Array.isArray(body?.overdue) ? body.overdue : [],
    /* Capped here as well as in the app: a bad answer must not silence the backup for longer than an hour. */
    recheckInMinutes: Number.isFinite(recheck) ? Math.min(MAX_RECHECK_MINUTES, Math.max(0, recheck)) : 0,
  };
}

async function trigger({ origin, path, cronSecret, fetchImpl, timeoutMs }) {
  try {
    const res = await fetchImpl(`${origin}${path}`, {
      headers: { authorization: `Bearer ${cronSecret}`, "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    /* The body is the job's own report and is not ours to keep or print. */
    await res.body?.cancel?.().catch?.(() => {});
    return String(res.status);
  } catch (e) {
    return e?.name === "TimeoutError" ? "timeout" : "error";
  }
}

/**
 * One run. Everything it touches is injected, so the tests drive it against a
 * mocked app. Returns what it did; `state` is updated in place.
 */
export async function runScheduler({
  appUrl,
  schedulerToken,
  cronSecret,
  state,
  nowMs = Date.now(),
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = () => {},
  persist = () => {},
  dryRun = false,
  force = false,
  gapMs = TRIGGER_GAP_MS,
  timeoutMs = TRIGGER_TIMEOUT_MS,
}) {
  const origin = appOrigin(appUrl);
  if (!schedulerToken) throw new Error("OPS_SCHEDULER_TOKEN is required");
  if (!dryRun && !cronSecret) throw new Error("CRON_SECRET is required to trigger");

  if (!force && !dryRun && nowMs < (state.nextAskAt ?? 0)) {
    return { asked: false, overdue: [], triggered: [] };
  }

  const answer = await ask({ origin, token: schedulerToken, fetchImpl });
  const overdue = answer.overdue.filter(validOverdue);
  const picks = selectTriggers(overdue, state.lastTriggered, nowMs);
  if (!dryRun) state.nextAskAt = nowMs + answer.recheckInMinutes * 60_000;

  if (overdue.length) log(`overdue: ${overdue.map((o) => o.job).join(", ")}`);
  if (dryRun) return { asked: true, overdue: overdue.map((o) => o.job), triggered: [] };

  /* Stamped and persisted before any call goes out: a run killed while it
     waits on a long job must still count against the cooldown. */
  for (const p of picks) state.lastTriggered[p.job] = nowMs;
  for (const [job, at] of Object.entries(state.lastTriggered)) {
    if (!Number.isFinite(at) || nowMs - at > KEEP_STATE_MS) delete state.lastTriggered[job];
  }
  persist(state);

  const runs = [];
  for (let i = 0; i < picks.length; i++) {
    if (i > 0 && gapMs > 0) await sleep(gapMs);
    const p = picks[i];
    log(`triggering ${p.job}`);
    runs.push(trigger({ origin, path: p.path, cronSecret, fetchImpl, timeoutMs }).then((status) => {
      log(`${p.job}: ${status}`);
      return { job: p.job, status };
    }));
  }
  const triggered = await Promise.all(runs);
  return { asked: true, overdue: overdue.map((o) => o.job), triggered };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  const file = process.env.SCHEDULER_STATE_FILE ?? "/var/lib/outreach-backup-scheduler/state.json";
  const state = dryRun ? emptyState() : loadState(file);
  const log = (m) => console.log(`${new Date().toISOString()} ${m}`);
  let result;
  try {
    result = await runScheduler({
      appUrl: process.env.APP_URL,
      schedulerToken: process.env.OPS_SCHEDULER_TOKEN,
      cronSecret: process.env.CRON_SECRET,
      state,
      dryRun,
      force,
      log,
      persist: (s) => saveState(file, s),
    });
  } finally {
    if (!dryRun) saveState(file, state);
  }
  if (!result.asked) return;
  if (!result.overdue.length) log("nothing overdue");
  if (result.triggered.some((t) => !/^[23]\d\d$/.test(t.status))) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
  });
}
