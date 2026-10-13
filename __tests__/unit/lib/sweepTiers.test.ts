/**
 * @jest-environment node
 *
 * The order the post sweep asks in, run against an in-memory table.
 *
 * Production, 2026-10-03: 15,085 tracked TikTok posts on COMPLETE campaigns,
 * 10,918 of them over 180 days old, against a TikTok budget of 300 reads a run.
 * Least-recently-read first, the budget went to the back catalogue and a post
 * published that morning -- untracked, on a campaign marked COMPLETE the moment
 * its deliverables landed -- was never read by the cron at all.
 *
 * The WHERE clauses are evaluated here by a small interpreter of the Prisma
 * filter subset the tiers use, with SQL's null rules (a comparison against
 * NULL is false). The same tiers were run against Postgres on the local copy of
 * five LKM campaigns; this file is what keeps them honest without a database.
 */
import { DEFAULT_POST_TRACKING } from "@/lib/trackers/granularity";
import {
  DAILY_RECHECK_REASONS,
  decidePostTracking,
  isLiveCampaign,
  type PostTrackingDecision,
} from "@/lib/sync/postTracking";
import {
  SEAL_TAKE,
  SWEEP_TIERS,
  candidateTake,
  selectSweepCandidates,
  sweepTierWhere,
  type SweepQuery,
  type SweepTier,
} from "@/lib/sync/sweepCandidates";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = new Date("2026-10-03T00:00:00.000Z");

type Row = {
  id: string;
  platform: "TIKTOK" | "YOUTUBE" | "INSTAGRAM";
  postedAt: Date;
  lastSyncedAt: Date | null;
  syncDisabledAt: Date | null;
  trackingEnabled: boolean;
  trackingStartedAt: Date | null;
  trackingExpiresAt: Date | null;
  trackingTtlDays: number | null;
  campaign: { status: string; archived: boolean; deletedAt: Date | null };
  snapshots: { isFinalSnapshot: boolean }[];
  /** Set when the post was removed from its campaign (lib/posts/removed). */
  removedAt: Date | null;
  /* The __lastFetch stamp, flattened: when we last asked, and what we heard. */
  lastAttemptAt?: Date | null;
  lastReason?: string | null;
};

/* What `db.post.fields.trackingStartedAt` is: a reference to a column of the
   same row. */
const STARTED_AT_FIELD = { modelName: "Post", name: "trackingStartedAt", typeName: "DateTime", isList: false };

/* ── A Prisma-where interpreter, for exactly the shapes the tiers use ───────── */

type Value = Date | string | number | boolean | null;
const isFieldRef = (v: unknown): v is { name: string } =>
  typeof v === "object" && v !== null && "modelName" in v && "name" in v;
const resolve = (row: Record<string, unknown>, v: unknown) => (isFieldRef(v) ? (row[v.name] as Value) : (v as Value));
const cmp = (a: Value, b: Value) => {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return (x as number) < (y as number) ? -1 : (x as number) > (y as number) ? 1 : 0;
};
const same = (a: Value, b: Value) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);

function matchField(row: Record<string, unknown>, key: string, cond: unknown): boolean {
  const v = row[key] as Value;
  if (cond === null) return v === null;
  if (cond instanceof Date || typeof cond !== "object") return v !== null && same(v, cond as Value);
  for (const [op, raw] of Object.entries(cond as Record<string, unknown>)) {
    const target = resolve(row, raw);
    switch (op) {
      case "equals":
        if (target === null ? v !== null : v === null || !same(v, target)) return false;
        break;
      case "not":
        if (target === null ? v === null : v === null || same(v, target)) return false;
        break;
      case "in":
        if (v === null || !(raw as Value[]).some((x) => same(v, x))) return false;
        break;
      case "notIn":
        if (v === null || (raw as Value[]).some((x) => same(v, x))) return false;
        break;
      case "lt":
      case "lte":
      case "gt":
      case "gte": {
        if (v === null || target === null) return false;
        const c = cmp(v, target);
        if (op === "lt" ? c >= 0 : op === "lte" ? c > 0 : op === "gt" ? c <= 0 : c < 0) return false;
        break;
      }
      default:
        throw new Error(`unsupported operator ${op} on ${key}`);
    }
  }
  return true;
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === "AND") {
      const all = Array.isArray(cond) ? cond : [cond];
      if (!all.every((w) => matches(row, w as Record<string, unknown>))) return false;
    } else if (key === "OR") {
      if (!(cond as Record<string, unknown>[]).some((w) => matches(row, w))) return false;
    } else if (key === "NOT") {
      throw new Error("NOT is not used by the tiers; teach the interpreter if that changes");
    } else if (key === "campaign") {
      if (!matches(row.campaign as Record<string, unknown>, cond as Record<string, unknown>)) return false;
    } else if (key === "snapshots") {
      const none = (cond as { none: Record<string, unknown> }).none;
      if ((row.snapshots as Record<string, unknown>[]).some((s) => matches(s, none))) return false;
    } else if (!matchField(row, key, cond)) {
      return false;
    }
  }
  return true;
}

/** `findMany` over an array: filter, oldest read first (nulls first), take. */
function tableFind(rows: Row[]) {
  const calls: SweepQuery[] = [];
  const find = async (q: SweepQuery) => {
    calls.push(q);
    return rows
      .filter((r) => matches(r as unknown as Record<string, unknown>, q.where as Record<string, unknown>))
      .sort((a, b) => {
        if (a.lastSyncedAt === null || b.lastSyncedAt === null) {
          return a.lastSyncedAt === b.lastSyncedAt ? a.id.localeCompare(b.id) : a.lastSyncedAt === null ? -1 : 1;
        }
        return a.lastSyncedAt.getTime() - b.lastSyncedAt.getTime() || a.id.localeCompare(b.id);
      })
      .slice(0, q.take);
  };
  return { find, calls };
}

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const COMPLETE = { status: "COMPLETE", archived: false, deletedAt: null };
const LIVE = { status: "IN_PROGRESS", archived: false, deletedAt: null };

let seq = 0;
function row(over: Partial<Row> & { postedAt: Date }): Row {
  return {
    id: `p${String(seq++).padStart(6, "0")}`,
    platform: "TIKTOK",
    lastSyncedAt: null,
    syncDisabledAt: null,
    trackingEnabled: false,
    trackingStartedAt: null,
    trackingExpiresAt: null,
    trackingTtlDays: null,
    campaign: COMPLETE,
    snapshots: [],
    removedAt: null,
    ...over,
  };
}

/** The route's decisionFor, over a table row. */
function decide(r: Row, now: Date): PostTrackingDecision {
  return decidePostTracking({
    trackingEnabled: r.trackingEnabled,
    trackingStartedAt: r.trackingStartedAt,
    trackingExpiresAt: r.trackingExpiresAt,
    trackingTtlDays: r.trackingTtlDays,
    lastSyncedAt: r.lastSyncedAt,
    lastAttemptAt: r.lastAttemptAt ?? null,
    lastReason: r.lastReason ?? null,
    syncDisabledAt: r.syncDisabledAt,
    hasFinalSnapshot: r.snapshots.some((s) => s.isFinalSnapshot),
    granularity: DEFAULT_POST_TRACKING,
    now,
    postedAt: r.postedAt,
    campaignLive: isLiveCampaign(r.campaign),
  });
}

const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);

/** The 09-15 bulk action, in miniature: trackers on old posts of finished campaigns. */
function bulkTrackedBacklog(n: number, now: Date, platform: Row["platform"] = "TIKTOK"): Row[] {
  const started = ago(now, 18 * DAY);
  return Array.from({ length: n }, (_, i) =>
    row({
      platform,
      postedAt: ago(now, (40 + (i % 700)) * DAY),
      trackingEnabled: true,
      trackingStartedAt: started,
      lastSyncedAt: ago(now, (20 + (i % 15)) * DAY),
    }),
  );
}

/* ── Each tier picks what it says ─────────────────────────────────────────── */

describe("sweep tiers", () => {
  const now = T0;
  const where = (tier: SweepTier) =>
    sweepTierWhere(tier, { platform: "TIKTOK", now, startedAtField: STARTED_AT_FIELD as never }) as Record<string, unknown>;
  const tierOf = (r: Row) =>
    SWEEP_TIERS.filter((t) => matches(r as unknown as Record<string, unknown>, where(t)));

  it("puts an untracked post on a COMPLETE campaign in a young tier by its age", () => {
    expect(tierOf(row({ postedAt: ago(now, 5 * HOUR) }))).toEqual(["first-72h"]);
    expect(tierOf(row({ postedAt: ago(now, 10 * DAY) }))).toEqual(["first-30d"]);
    expect(tierOf(row({ postedAt: ago(now, 31 * DAY) }))).toEqual([]);
  });

  it("puts every post of a running campaign past its first 72 hours in the live tier, tracked or not", () => {
    expect(tierOf(row({ postedAt: ago(now, 90 * DAY), campaign: LIVE }))).toEqual(["live-campaign"]);
    expect(tierOf(row({ postedAt: ago(now, 2 * HOUR), campaign: LIVE }))).toEqual(["first-72h"]);
    expect(tierOf(row({ postedAt: ago(now, 200 * DAY), campaign: LIVE }))).toEqual([]);
    expect(
      tierOf(row({ postedAt: ago(now, 200 * DAY), campaign: LIVE, trackingEnabled: true, trackingStartedAt: ago(now, DAY) })),
    ).toEqual(["live-campaign"]);
  });

  it("treats an archived or deleted running campaign as not running", () => {
    expect(tierOf(row({ postedAt: ago(now, 90 * DAY), campaign: { ...LIVE, archived: true } }))).toEqual([]);
    expect(tierOf(row({ postedAt: ago(now, 90 * DAY), campaign: { ...LIVE, deletedAt: now } }))).toEqual([]);
    expect(tierOf(row({ postedAt: ago(now, 2 * DAY), campaign: { ...LIVE, archived: true } }))).toEqual(["first-72h"]);
  });

  it("leaves out a post whose tracking was stopped, sealed or dead-lettered", () => {
    const young = { postedAt: ago(now, 2 * DAY) };
    expect(tierOf(row({ ...young, trackingExpiresAt: ago(now, HOUR) }))).toEqual([]);
    expect(tierOf(row({ ...young, campaign: LIVE, trackingExpiresAt: ago(now, HOUR) }))).toEqual([]);
    expect(tierOf(row({ ...young, snapshots: [{ isFinalSnapshot: true }] }))).toEqual([]);
    expect(tierOf(row({ ...young, syncDisabledAt: ago(now, HOUR) }))).toEqual([]);
  });

  it("never reads a post that was removed from its campaign, in any tier", () => {
    const removedAt = ago(now, HOUR);
    expect(tierOf(row({ postedAt: ago(now, 5 * HOUR), removedAt }))).toEqual([]);
    expect(tierOf(row({ postedAt: ago(now, 90 * DAY), campaign: LIVE, removedAt }))).toEqual([]);
    const oldTracker = {
      postedAt: ago(now, 200 * DAY),
      trackingEnabled: true,
      trackingStartedAt: ago(now, 40 * DAY),
      lastSyncedAt: ago(now, DAY),
    };
    expect(tierOf(row(oldTracker))).not.toEqual([]);
    expect(tierOf(row({ ...oldTracker, removedAt }))).toEqual([]);
  });

  it("does not hold a place for a post read too recently to be due", () => {
    expect(tierOf(row({ postedAt: ago(now, 2 * DAY), lastSyncedAt: ago(now, 3 * HOUR) }))).toEqual([]);
    expect(tierOf(row({ postedAt: ago(now, 2 * DAY), lastSyncedAt: ago(now, 6 * HOUR) }))).toEqual(["first-72h"]);
    /* Past its first week an untracked post is read daily. */
    expect(tierOf(row({ postedAt: ago(now, 10 * DAY), lastSyncedAt: ago(now, 7 * HOUR) }))).toEqual([]);
    expect(tierOf(row({ postedAt: ago(now, 10 * DAY), lastSyncedAt: ago(now, 24 * HOUR) }))).toEqual(["first-30d"]);
  });

  it("sends old trackers to the seal tier only once they have had their reading", () => {
    const tracked = { trackingEnabled: true, trackingStartedAt: ago(now, 18 * DAY), postedAt: ago(now, 400 * DAY) };
    expect(tierOf(row({ ...tracked, lastSyncedAt: ago(now, 30 * DAY) }))).toEqual(["backlog"]);
    expect(tierOf(row({ ...tracked, lastSyncedAt: ago(now, 2 * DAY) }))).toEqual(["seal", "backlog"]);
    expect(tierOf(row({ ...tracked, lastSyncedAt: ago(now, 1 * HOUR) }))).toEqual(["seal"]);
  });

  it("sends an expired tracker to the seal tier, but a legacy null expiry only once the longest TTL has run", () => {
    const tracked = { trackingEnabled: true, postedAt: ago(now, 60 * DAY), lastSyncedAt: ago(now, HOUR) };
    expect(tierOf(row({ ...tracked, trackingStartedAt: ago(now, 31 * DAY), trackingExpiresAt: ago(now, DAY) }))).toEqual(["seal"]);
    expect(tierOf(row({ ...tracked, trackingStartedAt: ago(now, 31 * DAY) }))).toEqual(["seal"]);
    expect(tierOf(row({ ...tracked, trackingStartedAt: ago(now, 10 * DAY) }))).toEqual([]);
  });

  /* The property the route depends on: SQL picks candidates, decidePostTracking
     decides. The two must agree -- every post the decision would read or seal
     is in some tier, and a seal-tier post is always sealed, never read out of
     turn. Checked over every combination of the inputs that matter. */
  it("agrees with decidePostTracking on every combination of state", () => {
    const ages = [2 * HOUR, 2.9 * DAY, 3.1 * DAY, 6.9 * DAY, 7.1 * DAY, 29.9 * DAY, 30.1 * DAY, 90 * DAY, 179 * DAY, 181 * DAY, 700 * DAY];
    const reads = [null, 1 * HOUR, 5.6 * HOUR, 11 * HOUR, 12 * HOUR, 23.6 * HOUR, 3 * DAY, 40 * DAY];
    const trackers: Partial<Row>[] = [
      {},
      { trackingExpiresAt: ago(now, 2 * DAY) },
      { trackingEnabled: true, trackingStartedAt: ago(now, 10 * DAY), trackingExpiresAt: new Date(now.getTime() + 20 * DAY) },
      { trackingEnabled: true, trackingStartedAt: ago(now, 18 * DAY) },
      { trackingEnabled: true, trackingStartedAt: ago(now, 31 * DAY) },
      { trackingEnabled: true, trackingStartedAt: ago(now, 31 * DAY), trackingExpiresAt: ago(now, DAY) },
      { trackingEnabled: true, trackingStartedAt: null },
    ];
    const campaigns = [COMPLETE, LIVE, { ...LIVE, archived: true }, { status: "PENDING", archived: false, deletedAt: null }];
    let checked = 0;
    for (const age of ages)
      for (const read of reads)
        for (const t of trackers)
          for (const campaign of campaigns) {
            const r = row({ postedAt: ago(now, age), lastSyncedAt: read === null ? null : ago(now, read), campaign, ...t });
            const tiers = tierOf(r);
            const d = decide(r, now);
            const label = JSON.stringify({ age: age / HOUR, read: read && read / HOUR, t, campaign, tiers, d });
            if (d.action === "sync" || d.action === "seal") expect({ label, found: tiers.length > 0 }).toEqual({ label, found: true });
            if (tiers.includes("seal")) expect({ label, action: d.action }).toEqual({ label, action: "seal" });
            if (tiers.length > 0 && d.action === "skip") {
              expect({ label, reason: d.reason }).toEqual({ label, reason: expect.stringMatching(/^cadence-throttle-/) });
            }
            /* Never two read tiers: the take is shared, and a post counted twice would cost a place. */
            expect(tiers.filter((x) => x !== "seal").length).toBeLessThanOrEqual(1);
            checked++;
          }
    expect(checked).toBe(ages.length * reads.length * trackers.length * campaigns.length);
  });
});

/* ── The order, and the budget, at scale ──────────────────────────────────── */

describe("selectSweepCandidates", () => {
  it("fills the take in tier order and gives seals their own", async () => {
    const now = T0;
    const groups = {
      backlog: bulkTrackedBacklog(2_000, now),
      live: Array.from({ length: 40 }, (_, i) => row({ postedAt: ago(now, (4 + (i % 56)) * DAY), campaign: LIVE })),
      "72h": Array.from({ length: 30 }, (_, i) => row({ postedAt: ago(now, (i % 72) * HOUR) })),
      "30d": Array.from({ length: 50 }, (_, i) => row({ postedAt: ago(now, (4 + (i % 25)) * DAY) })),
      seal: Array.from({ length: 700 }, () =>
        row({ postedAt: ago(now, 400 * DAY), trackingEnabled: true, trackingStartedAt: ago(now, 18 * DAY), lastSyncedAt: ago(now, HOUR) }),
      ),
    };
    const groupOf = new Map(Object.entries(groups).flatMap(([g, rs]) => rs.map((r) => [r.id, g] as const)));
    const rows = Object.values(groups).flat();
    const { find } = tableFind(rows);
    const { posts, byTier } = await selectSweepCandidates(find, {
      platform: "TIKTOK",
      budget: 300,
      now,
      startedAtField: STARTED_AT_FIELD as never,
    });

    expect(byTier).toEqual({
      seal: SEAL_TAKE,
      "live-campaign": 40,
      "first-72h": 30,
      "first-30d": 50,
      backlog: candidateTake(300) - 40 - 30 - 50,
    });
    /* The queue is in that order: seals, then the first 72 hours and the
       running campaigns in turn, then the first month, then the backlog. */
    const order = posts.map((p) => groupOf.get(p.id));
    const firstOf = (k: string) => order.indexOf(k);
    const lastOf = (k: string) => order.lastIndexOf(k);
    expect(lastOf("seal")).toBeLessThan(firstOf("72h"));
    expect(order.slice(SEAL_TAKE, SEAL_TAKE + 4)).toEqual(["72h", "live", "72h", "live"]);
    expect(Math.max(lastOf("72h"), lastOf("live"))).toBeLessThan(firstOf("30d"));
    expect(lastOf("30d")).toBeLessThan(firstOf("backlog"));
    expect(new Set(posts.map((p) => p.id)).size).toBe(posts.length);
  });

  it("asks nothing for a platform with no budget", async () => {
    const { find, calls } = tableFind(bulkTrackedBacklog(10, T0));
    const out = await selectSweepCandidates(find, { platform: "TIKTOK", budget: 0, now: T0 });
    expect(out.posts).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("stops asking once the take is full", async () => {
    const now = T0;
    const rows = Array.from({ length: 1_000 }, () => row({ postedAt: ago(now, 5 * DAY), campaign: LIVE }));
    const { find, calls } = tableFind(rows);
    const out = await selectSweepCandidates(find, { platform: "TIKTOK", budget: 300, now });
    expect(out.byTier["live-campaign"]).toBe(candidateTake(300));
    /* Both tiers of the first rank are asked; the first month and the backlog are not. */
    expect(calls.map((c) => c.take)).toEqual([SEAL_TAKE, candidateTake(300), candidateTake(300)]);
  });

  it("splits the take between the first 72 hours and the running campaigns when both overflow it", async () => {
    const now = T0;
    const rows = [
      ...Array.from({ length: 700 }, () => row({ postedAt: ago(now, 5 * HOUR) })),
      ...Array.from({ length: 700 }, () => row({ postedAt: ago(now, 5 * DAY), campaign: LIVE })),
    ];
    const { find } = tableFind(rows);
    const out = await selectSweepCandidates(find, { platform: "TIKTOK", budget: 300, now });
    expect(out.byTier).toMatchObject({ "first-72h": candidateTake(300) / 2, "live-campaign": candidateTake(300) / 2 });
    /* The route reads the first `budget` of them: half each. */
    const read = out.posts.slice(0, 300);
    expect(read.filter((p) => p.campaign === LIVE)).toHaveLength(150);
  });

  it("never lets a seal candidate take a backlog place twice", async () => {
    const now = T0;
    /* Old, tracked, read two days ago: in both the seal tier and the backlog. */
    const rows = Array.from({ length: 50 }, () =>
      row({ postedAt: ago(now, 400 * DAY), trackingEnabled: true, trackingStartedAt: ago(now, 18 * DAY), lastSyncedAt: ago(now, 2 * DAY) }),
    );
    const { find } = tableFind(rows);
    const out = await selectSweepCandidates(find, { platform: "TIKTOK", budget: 300, now, startedAtField: STARTED_AT_FIELD as never });
    expect(out.byTier).toMatchObject({ seal: 50, backlog: 0 });
  });
});

/**
 * Ten days of the 6-hourly cron, 40 runs, on a production-shaped TikTok table.
 *
 * Volumes from production, 2026-10-03 (read-only): 15,085 tracked TikTok posts
 * on finished campaigns; 22 TikTok posts in running campaigns; new TikTok posts
 * arriving at ~7.1 a day (213 in the last 30 days). The budget is the route's
 * 300 reads a run, with candidateTake(300) = 600 candidates.
 *
 * Every read succeeds and stamps lastSyncedAt; a seal writes the final
 * snapshot and turns the tracker off, as the route does.
 */
describe("forty runs at production scale", () => {
  const BUDGET = 300;
  const RUNS = 40;
  const ARRIVALS_PER_RUN = 2; // ~7.1 a day is 1.8 a run; rounded up, so the test is the harder case

  function simulate() {
    const start = T0;
    const rows: Row[] = [
      /* The bulk-tracked back catalogue: old posts, read weeks ago, trackers 18 days in. */
      ...bulkTrackedBacklog(15_000, start),
      /* Running campaigns' posts, untracked, of every age. */
      ...Array.from({ length: 22 }, (_, i) =>
        row({ postedAt: ago(start, (i * 9) % 200 * DAY), campaign: LIVE, lastSyncedAt: ago(start, (i % 30) * DAY) }),
      ),
      /* A month of arrivals already on the table, never read by the cron. */
      ...Array.from({ length: 213 }, (_, i) => row({ postedAt: ago(start, (i / 7.1) * DAY), lastSyncedAt: null })),
    ];

    const perRun: {
      run: number;
      reads: Map<string, number>;
      overdueYoung: number;
      overdueLive: number;
      budgetSkipsAboveBacklog: number;
      sealed: number;
      byTier: Record<SweepTier, number>;
    }[] = [];

    const readRuns = new Map<string, number[]>();
    return (async () => {
      for (let run = 0; run < RUNS; run++) {
        const now = new Date(start.getTime() + run * 6 * HOUR);
        for (let k = 0; k < ARRIVALS_PER_RUN; k++) rows.push(row({ postedAt: ago(now, (k + 1) * HOUR) }));

        const { find } = tableFind(rows);
        const { posts, byTier } = await selectSweepCandidates(find, {
          platform: "TIKTOK",
          budget: BUDGET,
          now,
          startedAtField: STARTED_AT_FIELD as never,
        });

        let used = 0;
        let sealed = 0;
        let budgetSkipsAboveBacklog = 0;
        const reads = new Map<string, number>();
        for (const p of posts) {
          const d = decide(p, now);
          if (d.action === "seal") {
            p.snapshots = [{ isFinalSnapshot: true }];
            p.trackingEnabled = false;
            sealed++;
            continue;
          }
          if (d.action !== "sync") continue;
          if (used >= BUDGET) {
            if (isLiveCampaign(p.campaign) || now.getTime() - p.postedAt.getTime() < 30 * DAY) budgetSkipsAboveBacklog++;
            continue;
          }
          used++;
          p.lastSyncedAt = now;
          readRuns.set(p.id, [...(readRuns.get(p.id) ?? []), run]);
          const bucket = isLiveCampaign(p.campaign) ? "live" : now.getTime() - p.postedAt.getTime() < 30 * DAY ? "young" : "backlog";
          reads.set(bucket, (reads.get(bucket) ?? 0) + 1);
        }

        /* After the run, nothing young or live may still be due: everything
           the decision wants read this run was read. */
        let overdueYoung = 0;
        let overdueLive = 0;
        for (const r of rows) {
          if (decide(r, now).action !== "sync") continue;
          if (isLiveCampaign(r.campaign)) overdueLive++;
          else if (now.getTime() - r.postedAt.getTime() < 30 * DAY) overdueYoung++;
        }
        perRun.push({ run, reads, overdueYoung, overdueLive, budgetSkipsAboveBacklog, sealed, byTier });
      }
      return { rows, perRun, readRuns };
    })();
  }

  let result: Awaited<ReturnType<typeof simulate>>;
  beforeAll(async () => {
    result = await simulate();
  }, 120_000);

  it("reads every due young and live post on every run", () => {
    for (const r of result.perRun) {
      expect({ run: r.run, overdueYoung: r.overdueYoung, overdueLive: r.overdueLive, budgetSkips: r.budgetSkipsAboveBacklog }).toEqual({
        run: r.run,
        overdueYoung: 0,
        overdueLive: 0,
        budgetSkips: 0,
      });
    }
  });

  it("reads a new post on every run in its first week, then daily", () => {
    /* Posted an hour before run 0, so it is under 7 days old through run 27
       (6 x 27 + 1 = 163h) and daily from run 28. */
    const arrival = result.rows.find((r) => r.postedAt.getTime() === T0.getTime() - HOUR)!;
    const runs = result.readRuns.get(arrival.id) ?? [];
    expect(runs.filter((k) => k <= 27)).toEqual(Array.from({ length: 28 }, (_, k) => k));
    const later = runs.filter((k) => k > 27);
    for (let i = 1; i < later.length; i++) expect(later[i] - later[i - 1]).toBe(4);
    expect(later.length).toBeGreaterThanOrEqual(2);
  });

  it("spends what is left of the budget on the backlog", () => {
    for (const r of result.perRun) {
      const young = (r.reads.get("young") ?? 0) + (r.reads.get("live") ?? 0);
      expect({ run: r.run, backlog: r.reads.get("backlog") ?? 0 }).toEqual({ run: r.run, backlog: BUDGET - young });
    }
  });

  it("keeps the young and live reads inside the budget, with room for the backlog", () => {
    /* Averaged: 8 arrivals a day x (4 reads a day x 7 days + 1 a day x 23
       days) / 4 runs a day = 102 reads a run, plus the running campaigns'.
       The daily reads bunch on the runs where they fell due together, so the
       peak is higher than the mean, and it is the peak that must fit. */
    const young = result.perRun.map((r) => (r.reads.get("young") ?? 0) + (r.reads.get("live") ?? 0));
    const steady = young.slice(4);
    const mean = steady.reduce((a, b) => a + b, 0) / steady.length;
    expect(mean).toBeGreaterThan(80);
    expect(mean).toBeLessThan(140);
    expect(Math.max(...young)).toBeLessThan(BUDGET);
  });

  it("seals the old trackers once each has had its reading, never more than the seal take a run", () => {
    const sealedTotal = result.perRun.reduce((n, r) => n + r.sealed, 0);
    for (const r of result.perRun) expect(r.sealed).toBeLessThanOrEqual(SEAL_TAKE + candidateTake(BUDGET));
    /* Over 40 runs the backlog has had ~40 x 210 reads; every post read since
       its tracker started is over 180 days old with probability ~0.8 (posts
       are 40-740 days old), and each such read is followed by a seal. */
    expect(sealedTotal).toBeGreaterThan(4_000);
    /* The trackers have 12 days left at run 0 and the runs cover 9.75, so no
       window closes: every seal is an age seal, of an old post on a finished
       campaign that had been read since its tracker started. */
    const sealed = result.rows.filter((r) => r.snapshots.length);
    for (const r of sealed) {
      expect(isLiveCampaign(r.campaign)).toBe(false);
      expect(T0.getTime() - r.postedAt.getTime()).toBeGreaterThan(170 * DAY);
      expect(r.lastSyncedAt!.getTime()).toBeGreaterThanOrEqual(r.trackingStartedAt!.getTime());
    }
  });
});

/**
 * Instagram on 2026-10-02: 119 posts went up in one day against a budget of
 * 100 reads a run. More young posts than budget must still all be read within
 * two runs, while every running campaign's post is read on each.
 */
describe("more young posts than budget", () => {
  it("reads every running campaign's post on every run and every young one within two", async () => {
    const BUDGET = 100;
    const now0 = T0;
    const rows = [
      ...Array.from({ length: 9 }, () => row({ platform: "INSTAGRAM", postedAt: ago(now0, 5 * DAY), campaign: LIVE })),
      ...Array.from({ length: 125 }, (_, i) => row({ platform: "INSTAGRAM", postedAt: ago(now0, (1 + (i % 48)) * HOUR) })),
    ];
    const readAt = new Map<string, number[]>();
    for (let run = 0; run < 2; run++) {
      const now = new Date(now0.getTime() + run * 6 * HOUR);
      const { find } = tableFind(rows);
      const { posts } = await selectSweepCandidates(find, { platform: "INSTAGRAM", budget: BUDGET, now });
      let used = 0;
      for (const p of posts) {
        if (decide(p, now).action !== "sync" || used >= BUDGET) continue;
        used++;
        p.lastSyncedAt = now;
        readAt.set(p.id, [...(readAt.get(p.id) ?? []), run]);
      }
      expect(used).toBe(BUDGET);
      for (const r of rows.slice(0, 9)) expect(readAt.get(r.id)).toContain(run);
    }
    for (const r of rows) expect(readAt.get(r.id)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Instagram on 2026-10-03 (read-only): 59 tracked posts on accounts that share
 * nothing and 28 whose credential was rejected, every one of them at the head
 * of the oldest-read-first order because none of them ever reads. A day of
 * runs, with and without putting them behind the readable posts.
 */
describe("answers that stand until a person acts", () => {
  const BUDGET = 100;

  function table(now0: Date) {
    const backlog = (n: number, lastRead: number, over: Partial<Row> = {}) =>
      Array.from({ length: n }, () =>
        row({
          platform: "INSTAGRAM",
          postedAt: ago(now0, 60 * DAY),
          trackingEnabled: true,
          trackingStartedAt: ago(now0, 18 * DAY),
          lastSyncedAt: ago(now0, lastRead),
          ...over,
        }),
      );
    return {
      answered: [
        ...backlog(59, 40 * DAY, { lastAttemptAt: ago(now0, 24 * HOUR), lastReason: "not-a-professional-account" }),
        ...backlog(28, 40 * DAY, { lastAttemptAt: ago(now0, 24 * HOUR), lastReason: "credentials-rejected" }),
      ],
      young: Array.from({ length: 40 }, (_, i) => row({ platform: "INSTAGRAM", postedAt: ago(now0, (1 + i) * 12 * HOUR) })),
      readable: backlog(300, 13 * DAY),
    };
  }

  async function day(readLast: boolean) {
    const now0 = T0;
    const t = table(now0);
    const rows = [...t.answered, ...t.young, ...t.readable];
    const answered = new Set(t.answered.map((r) => r.id));
    const attempts = new Map<string, number>();
    const perRun: { answered: number; readable: number; order: boolean[] }[] = [];
    for (let run = 0; run < 4; run++) {
      const now = new Date(now0.getTime() + run * 6 * HOUR);
      const { find } = tableFind(rows);
      const { posts } = await selectSweepCandidates(find, {
        platform: "INSTAGRAM",
        budget: BUDGET,
        now,
        ...(readLast ? { readLast: (r: Row) => DAILY_RECHECK_REASONS.has(r.lastReason ?? "") } : {}),
      });
      const tally = { answered: 0, readable: 0, order: [] as boolean[] };
      for (const p of posts) {
        if (tally.answered + tally.readable >= BUDGET || decide(p, now).action !== "sync") continue;
        tally.order.push(answered.has(p.id));
        attempts.set(p.id, (attempts.get(p.id) ?? 0) + 1);
        if (answered.has(p.id)) {
          tally.answered++;
          p.lastAttemptAt = now;
        } else {
          tally.readable++;
          p.lastSyncedAt = now;
        }
      }
      perRun.push(tally);
    }
    return { t, attempts, perRun };
  }

  it("asks each of them once a day, and only after every readable post that is due", async () => {
    const { t, attempts, perRun } = await day(true);
    for (const r of t.answered) expect(attempts.get(r.id) ?? 0).toBeLessThanOrEqual(1);
    for (const { order } of perRun) {
      const firstAnswered = order.indexOf(true);
      if (firstAnswered >= 0) expect(order.slice(firstAnswered)).not.toContain(false);
    }
    /* The young posts are read on every run regardless. */
    for (const r of t.young) expect(attempts.get(r.id) ?? 0).toBeGreaterThanOrEqual(1);
    /* Due on run 0, all 87 of them, and still behind the readable backlog. */
    expect(perRun[0].answered).toBe(0);
    expect(perRun[0].readable).toBe(BUDGET);
  });

  it("spends the run on them first without it", async () => {
    const { perRun } = await day(false);
    /* Run 0 is a day after their last attempt, so all 87 are due, and
       oldest-read-first puts them ahead of the readable backlog. */
    expect(perRun[0].answered).toBe(BUDGET - 40);
    expect(perRun[0].order.slice(40, BUDGET)).not.toContain(false);
  });
});
