/**
 * @jest-environment node
 *
 * The canary's findings are pure, so each named threshold is pinned here at
 * its boundary: one side raises, the other does not. Titles must survive
 * alertOps' digit masking unchanged from one hour to the next, or the daily
 * de-duplication stops working.
 */
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));
jest.mock("@/lib/db", () => ({ db: {} }));

import { alertKey } from "@/lib/alerts";
import {
  CRON_FAILURE_STREAK_ALERT,
  FOLLOWERS_ZEROED_ALERT,
  HEARTBEAT_OVERDUE_FACTOR,
  HEARTBEAT_STUCK_MS,
  QUARANTINE_HELD_HOUR_ALERT,
  QUARANTINE_REJECTED_HOUR_ALERT,
  READ_SHARE_FLOOR,
  READ_SHARE_MIN_TRACKED,
  SANDBOX_CAP_WARN_SHARE,
  SOURCE_HEALTH_MIN_READS,
  SOURCE_HEALTH_PROPER_FLOOR,
  SOURCE_HEALTH_STALE_MS,
  canaryFindings,
  guardFindings,
  heartbeatFindings,
  jobHealth,
  valueFindings,
  type HeartbeatRow,
} from "@/lib/ops/canary";
import { CRON_JOBS } from "@/lib/ops/cronJobs";

const NOW = Date.UTC(2026, 9, 2, 10, 44);
const H = 3_600_000;
const at = (msAgo: number) => new Date(NOW - msAgo);

/** Every job healthy: started and finished a minute ago, the canary watching for a month. */
function healthy(): HeartbeatRow[] {
  return CRON_JOBS.map((j) => ({
    job: j.job,
    firstSeenAt: at(30 * 24 * H),
    lastStartedAt: at(2 * 60_000),
    lastFinishedAt: at(60_000),
    lastOk: true,
    lastError: null,
    consecutiveFailures: 0,
  }));
}
const withJob = (job: string, patch: Partial<HeartbeatRow>) => healthy().map((h) => (h.job === job ? { ...h, ...patch } : h));
const titles = (fs: { title: string }[]) => fs.map((f) => f.title);

describe("heartbeatFindings", () => {
  it("raises nothing when every job is fresh", () => {
    expect(heartbeatFindings({ nowMs: NOW, heartbeats: healthy(), killed: [] })).toEqual([]);
  });

  it("raises nothing at all without the ops tables", () => {
    expect(heartbeatFindings({ nowMs: NOW, heartbeats: null, killed: [] })).toEqual([]);
  });

  it(`calls an hourly job overdue past ${HEARTBEAT_OVERDUE_FACTOR}x its cadence, not before`, () => {
    const limit = HEARTBEAT_OVERDUE_FACTOR * H;
    const ok = heartbeatFindings({ nowMs: NOW, heartbeats: withJob("read-creator-trackers", { lastStartedAt: at(limit), lastFinishedAt: at(limit - 60_000) }), killed: [] });
    expect(ok).toEqual([]);
    const late = heartbeatFindings({ nowMs: NOW, heartbeats: withJob("read-creator-trackers", { lastStartedAt: at(limit + 60_000), lastFinishedAt: at(limit) }), killed: [] });
    expect(titles(late)).toEqual(["Cron read-creator-trackers is overdue: last started 2h ago"]);
    expect(late[0].severity).toBe("critical");
  });

  it("judges a daily job against a day, not an hour", () => {
    const f = heartbeatFindings({ nowMs: NOW, heartbeats: withJob("snapshot-org-views", { lastStartedAt: at(30 * H), lastFinishedAt: at(30 * H) }), killed: [] });
    expect(f).toEqual([]);
  });

  it("does not report a killed job as overdue", () => {
    const hb = withJob("sync-posts", { lastStartedAt: at(100 * H), lastFinishedAt: at(100 * H) });
    expect(heartbeatFindings({ nowMs: NOW, heartbeats: hb, killed: ["cron:sync-posts"] })).toEqual([]);
  });

  const neverRan = (job: string, seenMsAgo: number) =>
    withJob(job, { firstSeenAt: at(seenMsAgo), lastStartedAt: null, lastFinishedAt: null, lastOk: null });

  it("reports a job that never ran only once the canary has watched for two of its cadences", () => {
    const young = neverRan("sync-posts", 30 * 24 * H).map((h) => (h.job === "ops-canary" ? { ...h, firstSeenAt: at(12 * H - 60_000) } : h));
    expect(heartbeatFindings({ nowMs: NOW, heartbeats: young, killed: [] })).toEqual([]);
    const old = neverRan("sync-posts", 30 * 24 * H).map((h) => (h.job === "ops-canary" ? { ...h, firstSeenAt: at(12 * H + 60_000) } : h));
    expect(titles(heartbeatFindings({ nowMs: NOW, heartbeats: old, killed: [] }))).toEqual(["Cron sync-posts has no heartbeat since the canary first saw it"]);
  });

  it("times a job added in a later deploy from when the canary first saw it, not from the canary's own start", () => {
    // 2026-10-03: sync-instagram-posts alerted 17 minutes after the deploy
    // that added it, because the canary had been watching for days.
    const justAdded = neverRan("sync-instagram-posts", 17 * 60_000);
    expect(heartbeatFindings({ nowMs: NOW, heartbeats: justAdded, killed: [] })).toEqual([]);
    const cadence = 60 * 60_000 * HEARTBEAT_OVERDUE_FACTOR;
    expect(heartbeatFindings({ nowMs: NOW, heartbeats: neverRan("sync-instagram-posts", cadence - 60_000), killed: [] })).toEqual([]);
    expect(titles(heartbeatFindings({ nowMs: NOW, heartbeats: neverRan("sync-instagram-posts", cadence + 60_000), killed: [] }))).toEqual([
      "Cron sync-instagram-posts has no heartbeat since the canary first saw it",
    ]);
  });

  it("does not report a job with no row at all: this run is the canary's first sighting of it", () => {
    const missing = healthy().filter((h) => h.job !== "sync-posts");
    expect(heartbeatFindings({ nowMs: NOW, heartbeats: missing, killed: [] })).toEqual([]);
  });

  it(`reports a run that started over ${HEARTBEAT_STUCK_MS / 60_000} min ago and never finished`, () => {
    const stuck = withJob("read-creator-trackers", { lastStartedAt: at(HEARTBEAT_STUCK_MS + 60_000), lastFinishedAt: at(H + 30 * 60_000) });
    expect(titles(heartbeatFindings({ nowMs: NOW, heartbeats: stuck, killed: [] }))).toEqual(["Cron read-creator-trackers started and never finished"]);
    const running = withJob("read-creator-trackers", { lastStartedAt: at(HEARTBEAT_STUCK_MS - 60_000), lastFinishedAt: at(H) });
    expect(heartbeatFindings({ nowMs: NOW, heartbeats: running, killed: [] })).toEqual([]);
  });

  it(`reports ${CRON_FAILURE_STREAK_ALERT} failed runs in a row, not one`, () => {
    const one = withJob("sync-posts", { lastOk: false, consecutiveFailures: CRON_FAILURE_STREAK_ALERT - 1, lastError: "HTTP 500" });
    expect(heartbeatFindings({ nowMs: NOW, heartbeats: one, killed: [] })).toEqual([]);
    const two = withJob("sync-posts", { lastOk: false, consecutiveFailures: CRON_FAILURE_STREAK_ALERT, lastError: "HTTP 500" });
    const f = heartbeatFindings({ nowMs: NOW, heartbeats: two, killed: [] });
    expect(titles(f)).toEqual([`Cron sync-posts failed ${CRON_FAILURE_STREAK_ALERT} runs in a row`]);
    expect(f[0].facts.lastError).toBe("HTTP 500");
  });
});

describe("jobHealth", () => {
  const hb = (startedAgo: number, finishedAgo: number | null, failures = 0) => ({
    lastStartedAt: at(startedAgo),
    lastFinishedAt: finishedAgo === null ? null : at(finishedAgo),
    consecutiveFailures: failures,
  });

  it("reads each state, killed first", () => {
    expect(jobHealth("sync-posts", hb(H, H - 60_000), NOW, false)).toBe("ok");
    expect(jobHealth("sync-posts", hb(60_000, 2 * H), NOW, false)).toBe("running");
    expect(jobHealth("sync-posts", hb(HEARTBEAT_STUCK_MS + 1, 2 * H), NOW, false)).toBe("stuck");
    expect(jobHealth("sync-posts", hb(H, H - 60_000, CRON_FAILURE_STREAK_ALERT), NOW, false)).toBe("failing");
    expect(jobHealth("sync-posts", hb(13 * H, 13 * H), NOW, false)).toBe("overdue");
    expect(jobHealth("sync-posts", null, NOW, false)).toBe("no-heartbeat");
    expect(jobHealth("sync-posts", hb(13 * H, 13 * H), NOW, true)).toBe("killed");
  });
});

describe("guardFindings", () => {
  it("reminds about every switch that is off and every open breaker", () => {
    const f = guardFindings({ killed: ["cron:sync-posts", "source:tiktok"], openBreakers: ["post-reads:tiktok"], sandbox: { used: 0, cap: 600 } });
    expect(titles(f)).toEqual([
      "Kill switch is on: cron:sync-posts",
      "Kill switch is on: source:tiktok",
      "Source breaker open: post-reads:tiktok",
    ]);
  });

  it(`warns at ${SANDBOX_CAP_WARN_SHARE * 100}% of the Sandbox cap, and leaves the cap itself to createSandbox's alert`, () => {
    const cap = 600;
    const at = (used: number | null) => guardFindings({ killed: [], openBreakers: [], sandbox: { used, cap } });
    expect(at(cap * SANDBOX_CAP_WARN_SHARE - 1)).toEqual([]);
    expect(titles(at(cap * SANDBOX_CAP_WARN_SHARE))).toEqual([`Sandbox use at ${cap * SANDBOX_CAP_WARN_SHARE} of ${cap} today (UTC)`]);
    expect(at(cap)).toEqual([]);
    expect(at(null)).toEqual([]);
  });
});

describe("valueFindings", () => {
  const base = { nowMs: NOW, killed: [] as string[], readShare: null, quarantine: null, zeroed: null, sourceHealth: null };

  it(`warns when under ${READ_SHARE_FLOOR * 100}% of a platform's tracked creators were read in 24h`, () => {
    const t = 100;
    const under = valueFindings({ ...base, readShare: [{ platform: "TIKTOK", tracked: t, read: t * READ_SHARE_FLOOR - 1 }] });
    expect(titles(under)).toEqual(["Tracked TIKTOK creators read in 24h: 49%, under 50%"]);
    expect(valueFindings({ ...base, readShare: [{ platform: "TIKTOK", tracked: t, read: t * READ_SHARE_FLOOR }] })).toEqual([]);
  });

  it(`ignores a platform with fewer than ${READ_SHARE_MIN_TRACKED} tracked creators`, () => {
    expect(valueFindings({ ...base, readShare: [{ platform: "YOUTUBE", tracked: READ_SHARE_MIN_TRACKED - 1, read: 0 }] })).toEqual([]);
    expect(valueFindings({ ...base, readShare: [{ platform: "YOUTUBE", tracked: READ_SHARE_MIN_TRACKED, read: 0 }] })).toHaveLength(1);
  });

  it("ignores the read share of a source that is switched off", () => {
    expect(valueFindings({ ...base, killed: ["source:instagram"], readShare: [{ platform: "INSTAGRAM", tracked: 100, read: 0 }] })).toEqual([]);
  });

  it(`warns at ${QUARANTINE_REJECTED_HOUR_ALERT} rejected or ${QUARANTINE_HELD_HOUR_ALERT} held readings in an hour`, () => {
    expect(valueFindings({ ...base, quarantine: { held: QUARANTINE_HELD_HOUR_ALERT - 1, rejected: QUARANTINE_REJECTED_HOUR_ALERT - 1 } })).toEqual([]);
    expect(titles(valueFindings({ ...base, quarantine: { held: QUARANTINE_HELD_HOUR_ALERT, rejected: QUARANTINE_REJECTED_HOUR_ALERT } }))).toEqual([
      `Validation gate rejected ${QUARANTINE_REJECTED_HOUR_ALERT} readings in the last hour`,
      `Validation gate held ${QUARANTINE_HELD_HOUR_ALERT} readings in the last hour`,
    ]);
  });

  it(`is critical at ${FOLLOWERS_ZEROED_ALERT} creator whose followers fell to 0, with counts and no ids`, () => {
    expect(valueFindings({ ...base, zeroed: [] })).toEqual([]);
    const f = valueFindings({ ...base, zeroed: [{ platform: "TIKTOK", n: 2 }, { platform: "YOUTUBE", n: 0 }] });
    expect(titles(f)).toEqual(["2 tracked creator(s) now read 0 followers after a non-zero reading"]);
    expect(f[0].severity).toBe("critical");
    expect(f[0].facts).toEqual({ TIKTOK: 2 });
  });

  it(`warns when the live reader's last run read under ${SOURCE_HEALTH_PROPER_FLOOR * 100}% properly over ${SOURCE_HEALTH_MIN_READS} reads`, () => {
    const run = (reads: number, proper: number) =>
      valueFindings({ ...base, sourceHealth: { plan: "A", latest: { startedAt: at(H), reads, proper } } });
    expect(run(SOURCE_HEALTH_MIN_READS, SOURCE_HEALTH_MIN_READS * SOURCE_HEALTH_PROPER_FLOOR)).toEqual([]);
    expect(titles(run(SOURCE_HEALTH_MIN_READS, SOURCE_HEALTH_MIN_READS * SOURCE_HEALTH_PROPER_FLOOR - 1))).toEqual([
      "Tracker reader A's last run read 85% properly, under 90%",
    ]);
    expect(run(SOURCE_HEALTH_MIN_READS - 1, 0)).toEqual([]);
  });

  it(`warns when the live reader has recorded no run for over ${SOURCE_HEALTH_STALE_MS / H}h`, () => {
    const latest = (msAgo: number) => ({ startedAt: at(msAgo), reads: 100, proper: 100 });
    expect(valueFindings({ ...base, sourceHealth: { plan: "B", latest: latest(SOURCE_HEALTH_STALE_MS) } })).toEqual([]);
    expect(titles(valueFindings({ ...base, sourceHealth: { plan: "B", latest: latest(SOURCE_HEALTH_STALE_MS + 1) } }))).toEqual([
      "Tracker reader B is live but has recorded no run for over 2h",
    ]);
    expect(valueFindings({ ...base, sourceHealth: { plan: "B", latest: null } })).toHaveLength(1);
    expect(valueFindings({ ...base, killed: ["cron:read-creator-trackers"], sourceHealth: { plan: "B", latest: null } })).toEqual([]);
  });
});

describe("titles are stable across runs", () => {
  it("masks to the same key whatever the counts", () => {
    const run = (n: number, h: number) =>
      canaryFindings({
        nowMs: NOW,
        heartbeats: withJob("sync-posts", { lastStartedAt: at(h * H), lastFinishedAt: at(h * H), consecutiveFailures: n }),
        killed: [],
        openBreakers: [],
        sandbox: { used: null, cap: 600 },
        readShare: [{ platform: "TIKTOK", tracked: 100 + n, read: n }],
        quarantine: { held: 30 + n, rejected: 10 + n },
        zeroed: [{ platform: "TIKTOK", n }],
        sourceHealth: null,
      }).map((f) => alertKey(f.title));
    expect(run(3, 13)).toEqual(run(7, 40));
  });
});
