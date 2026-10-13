/**
 * Every scheduled job, with the schedule vercel.json gives it.
 *
 * A typed copy rather than an import of vercel.json, so the cadence a heartbeat
 * is judged against is visible here and checked in a test: the unit test reads
 * vercel.json and fails if the two lists differ in any path or schedule. Adding
 * a cron means adding it in both places, which is the point -- a job the canary
 * does not know about is a job nobody notices stopping.
 *
 * Minutes already taken, for whoever adds the next one (plan §14 rule 1 keeps
 * releases away from them): :00 every 6 h and daily at 04:00 / 05:00, 04:20 and
 * 05:20 daily (the second only finishes what the first ran out of time for), :10 and
 * :12 and :13 hourly, :15 every 6 h, :30 every 2 h and at 00:30, :40 hourly.
 * The Instagram post pass sits at :13, inside the window :10 and :12 have already
 * woken Neon for. The canary
 * runs at :44, inside the database's awake window from the :40 reader rather
 * than waking Neon a fifth time an hour; the weekly meter at 03:14 on Monday,
 * after the :10 and :12 jobs have woken it.
 */
export const CRON_JOBS = [
  { job: "sync-posts", path: "/api/cron/sync-posts", schedule: "0 */6 * * *", label: "Post metric sync" },
  { job: "sync-instagram-posts", path: "/api/cron/sync-instagram-posts", schedule: "13 * * * *", label: "Instagram post sync (hourly, paced)" },
  { job: "auto-approve-submissions", path: "/api/cron/auto-approve-submissions", schedule: "0 */6 * * *", label: "Auto-approve submissions" },
  { job: "snapshot-sounds", path: "/api/cron/snapshot-sounds", schedule: "0 4 * * *", label: "Sound snapshots" },
  { job: "snapshot-song-streams", path: "/api/cron/snapshot-song-streams", schedule: "20 4,5 * * *", label: "Spotify streams (daily)" },
  { job: "sync-trackers", path: "/api/cron/sync-trackers", schedule: "15 */6 * * *", label: "Sound trackers" },
  { job: "sync-creator-trackers", path: "/api/cron/sync-creator-trackers", schedule: "30 */2 * * *", label: "Creator trackers (legacy sweep)" },
  { job: "read-creator-trackers", path: "/api/cron/read-creator-trackers", schedule: "40 * * * *", label: "Creator trackers (reader v2)" },
  { job: "refresh-creator-avatars", path: "/api/cron/refresh-creator-avatars", schedule: "12 * * * *", label: "Creator avatars" },
  { job: "refresh-roster-profiles", path: "/api/cron/refresh-roster-profiles", schedule: "10 * * * *", label: "Roster profiles" },
  { job: "snapshot-org-views", path: "/api/cron/snapshot-org-views", schedule: "30 0 * * *", label: "Org view snapshots" },
  { job: "refresh-platform-tokens", path: "/api/cron/refresh-platform-tokens", schedule: "0 5 * * *", label: "Platform tokens" },
  { job: "ops-canary", path: "/api/cron/ops-canary", schedule: "44 * * * *", label: "Ops canary" },
  { job: "ops-meters", path: "/api/cron/ops-meters", schedule: "14 3 * * 1", label: "Weekly spend meters" },
] as const;

export type CronJob = (typeof CRON_JOBS)[number];
export type CronJobName = CronJob["job"];

export function isCronJobName(v: unknown): v is CronJobName {
  return typeof v === "string" && CRON_JOBS.some((j) => j.job === v);
}

const WEEK_MINUTES = 7 * 24 * 60;

/** One cron field as the set of values it matches, or null when the field uses
 *  syntax this parser does not know (names, L, W, #, ?). */
function fieldValues(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) return null;
    const step = m[2] ? Number(m[2]) : 1;
    if (!Number.isInteger(step) || step < 1) return null;
    let lo = min;
    let hi = max;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-").map(Number);
      lo = a;
      hi = b === undefined ? (m[2] ? max : a) : b;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/**
 * The longest gap, in minutes, between two consecutive firings of a cron
 * expression -- the cadence a heartbeat is judged against. Measured over a
 * whole week so a weekday field is handled, and cyclically so the gap from the
 * last firing of the week to the first of the next counts.
 *
 * Only the forms vercel.json uses: minute, hour and day of week as *, n, a-b,
 * lists and steps; day of month and month must be "*". Anything else is null,
 * and the unit test then fails on the registry rather than the canary guessing.
 */
export function cronIntervalMinutes(expression: string): number | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minF, hourF, domF, monF, dowF] = fields;
  if (domF !== "*" || monF !== "*") return null;
  const minutes = fieldValues(minF, 0, 59);
  const hours = fieldValues(hourF, 0, 23);
  const days = fieldValues(dowF, 0, 7);
  if (!minutes || !hours || !days) return null;
  if (days.has(7)) days.add(0);

  const firings: number[] = [];
  for (let d = 0; d < 7; d++) {
    if (!days.has(d)) continue;
    for (const h of [...hours].sort((a, b) => a - b)) {
      for (const m of [...minutes].sort((a, b) => a - b)) firings.push(d * 1440 + h * 60 + m);
    }
  }
  if (firings.length === 0) return null;
  if (firings.length === 1) return WEEK_MINUTES;
  let longest = firings[0] + WEEK_MINUTES - firings[firings.length - 1];
  for (let i = 1; i < firings.length; i++) longest = Math.max(longest, firings[i] - firings[i - 1]);
  return longest;
}

/** Cadence of a registered job in minutes. Every registered schedule parses
 *  (the unit test pins it), so the fallback is never reached in practice. */
export function cronCadenceMinutes(job: CronJobName): number {
  const entry = CRON_JOBS.find((j) => j.job === job);
  return (entry && cronIntervalMinutes(entry.schedule)) ?? 24 * 60;
}
