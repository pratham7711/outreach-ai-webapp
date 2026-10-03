import type { Platform, Prisma } from "@/lib/generated/prisma/client";
import { POST_TTL_MAX_DAYS } from "@/lib/trackers/granularity";
import {
  AUTO_TRACK_DAYS,
  AUTO_TRACK_FAST_DAYS,
  LIVE_CAMPAIGN_HORIZON_DAYS,
  LIVE_CAMPAIGN_STATUSES,
  OLD_POST_DAYS,
  dueCutoff,
} from "@/lib/sync/postTracking";

/**
 * Who the post sweep asks, and how many of each it asks for.
 *
 * The sweep has always had a per-platform read budget. What it did not have was
 * a per-platform candidate list: it took the 300 least-recently-read posts
 * across every platform and then spent budgets on whatever happened to be in
 * that list. Which platform got read was therefore decided by whichever one had
 * the largest backlog, and the others' budgets went unspent.
 *
 * Measured on production 2026-09-17, two days after 17,971 post trackers were
 * switched on in a single action: the next 300 candidates were 243 TikTok, 57
 * Instagram and 0 YouTube. YouTube had 2,237 tracked posts, 2,236 of them unread
 * for over 48 hours, zero reads in 24 hours, and a full unspent budget of 100
 * reads on every run. Nothing was broken in the YouTube reader; its rows simply
 * never reached it.
 *
 * These helpers are the policy, kept out of the route so they can be tested
 * without a database.
 */

/** The platforms the sweep can read. TWITTER rows exist but have no reader. */
export const SWEEP_PLATFORMS: Platform[] = ["YOUTUBE", "TIKTOK", "INSTAGRAM"];

/**
 * Candidates to fetch per unit of budget.
 *
 * More than the budget on purpose. A candidate is only a candidate: the cadence
 * may throttle it, or its window may have closed so the visit spends itself on
 * a seal. Taking exactly `budget` rows would let a handful of throttled ones
 * leave most of the budget unspent -- the same unspent-budget failure this
 * module exists to fix, one layer down. Three means a run has to be two-thirds
 * throttled before it under-reads.
 */
export const CANDIDATE_MULTIPLE = 3;

/** An upper bound so one platform's backlog cannot become an unbounded query. */
export const CANDIDATE_CEILING = 600;

export function candidateTake(budget: number): number {
  /* A budget of zero means "do not read this platform": asking for rows we may
     not spend anything on would cost a query and a decision per row for nothing. */
  if (budget <= 0) return 0;
  return Math.min(budget * CANDIDATE_MULTIPLE, CANDIDATE_CEILING);
}

/**
 * Take one from each list in turn until every list is empty.
 *
 * The run has a four-minute deadline and TikTok reads are the slow ones. In
 * platform order a TikTok backlog would eat the clock before the cheap
 * platforms were reached -- the same starvation in a new place -- so a deadline
 * cut has to land on all of them proportionally.
 */
export function roundRobin<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Which posts come first.
 *
 * The candidate list used to be every tracked post, least-recently-read first.
 * With 15,085 TikTok trackers on finished campaigns' back catalogue (measured
 * 2026-10-03; 10,918 of them over 180 days old) that order handed the whole
 * budget to two-year-old posts, and a post that went up this morning -- whose
 * numbers move most -- waited behind all of them, if it was tracked at all.
 *
 * So the queue is built in tiers, each least-recently-read first within itself:
 *
 *   seal           trackers that are over and only need sealing. A seal reads
 *                  nothing and spends no budget, so these go first and take
 *                  nothing from the reads. Their own take, so a backlog of
 *                  them cannot crowd the reads out of the candidate list.
 *   first-72h      every post in its first three days, whatever its campaign
 *                  says: a campaign marked COMPLETE the day its posts went up
 *                  is as live as any, and these are the numbers that move.
 *   live-campaign  every other post of a running campaign.
 *   first-30d      every other post in its first month.
 *   backlog        the remaining trackers, by staleness.
 *
 * The read tiers share one take, filled in that order, so a tier is reached
 * only once every due post above it has a place. Each tier is prefiltered to
 * posts its cadence could make due; decidePostTracking still decides.
 *
 * The first two share a rank and take turns, so neither can starve the other.
 * In order, whichever came first could: against the local copy of five LKM
 * campaigns plus the seed data, running-campaigns-first gave 298 of
 * Instagram's 300 places to seeded running campaigns and left 115 of 117 due
 * LKM posts without one, and newest-first does the same to a running campaign
 * on a day like 2026-10-02, when 119 Instagram posts went up against a budget
 * of 100 reads a run.
 * ──────────────────────────────────────────────────────────────────────────── */

export type SweepTier = "seal" | "first-72h" | "live-campaign" | "first-30d" | "backlog";
export const SWEEP_TIERS: readonly SweepTier[] = ["seal", "first-72h", "live-campaign", "first-30d", "backlog"];

/** Seals per platform per run. A seal is two writes and no request. */
export const SEAL_TAKE = CANDIDATE_CEILING;

const YOUNG_HOURS = 72;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type SweepQuery = {
  where: Prisma.PostWhereInput;
  orderBy: { lastSyncedAt: { sort: "asc"; nulls: "first" } };
  take: number;
};

type TierContext = {
  platform: Platform;
  now: Date;
  /** `db.post.fields.trackingStartedAt`: "read since the tracker started" is
   *  a comparison between two columns of the same row. Without it (a mocked
   *  client) that one seal is left to the backlog, never widened to every row. */
  startedAtField?: Prisma.DateTimeFieldRefInput<"Post">;
};

/** The WHERE for one tier. Exported so the policy can be read and tested apart
 *  from the database. */
export function sweepTierWhere(tier: SweepTier, ctx: TierContext): Prisma.PostWhereInput {
  const { platform, now } = ctx;
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const base: Prisma.PostWhereInput = {
    platform,
    syncDisabledAt: null,
    snapshots: { none: { isFinalSnapshot: true } },
  };
  const live: Prisma.PostWhereInput["campaign"] = {
    deletedAt: null,
    archived: false,
    status: { in: [...LIVE_CAMPAIGN_STATUSES] },
  };
  /* Spelled as an OR rather than a NOT: both columns are non-null, but an OR
     says what it means without leaning on that. */
  const notLive: Prisma.PostWhereInput["campaign"] = {
    deletedAt: null,
    OR: [{ status: { notIn: [...LIVE_CAMPAIGN_STATUSES] } }, { archived: true }],
  };
  /* Stopped is `trackingEnabled` false with `trackingExpiresAt` set; never
     tracked is both unset. See trackingStopped. */
  const notStopped: Prisma.PostWhereInput = { OR: [{ trackingEnabled: true }, { trackingExpiresAt: null }] };
  const fast = dueCutoff(now, "6hourly");
  const dueFast: Prisma.PostWhereInput = { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: fast } }] };

  switch (tier) {
    case "seal": {
      const old = ago(OLD_POST_DAYS * DAY_MS);
      /* Exactly trackers decidePostTracking seals, and nothing it would read:
         ones no automatic reason covers any more, that have either expired or
         are old and have been read once since they started. A null expiry is
         counted as expired only once even the longest TTL has run, so this
         never seals one that the org's own shorter default has closed -- that
         one is sealed from the backlog when its turn comes. */
      const expired: Prisma.PostWhereInput[] = [
        { trackingExpiresAt: { lte: now } },
        { trackingExpiresAt: null, trackingStartedAt: { lte: ago(POST_TTL_MAX_DAYS * DAY_MS) } },
      ];
      const readSinceStart: Prisma.PostWhereInput[] = [
        ...(ctx.startedAtField ? [{ postedAt: { lt: old }, lastSyncedAt: { gte: ctx.startedAtField } }] : []),
        { postedAt: { lt: old }, trackingStartedAt: null, lastSyncedAt: { not: null } },
      ];
      return {
        ...base,
        trackingEnabled: true,
        OR: [
          /* Past its first month, on a campaign that has finished. */
          { campaign: notLive, postedAt: { lt: ago(AUTO_TRACK_DAYS * DAY_MS) }, OR: [...expired, ...readSinceStart] },
          /* Too old for its running campaign to cover, and the tracker is over.
             An age seal never applies while the campaign runs. */
          { campaign: live, postedAt: { lt: ago(LIVE_CAMPAIGN_HORIZON_DAYS * DAY_MS) }, OR: expired },
        ],
      };
    }
    case "first-72h":
      return {
        ...base,
        campaign: { deletedAt: null },
        postedAt: { gte: ago(YOUNG_HOURS * HOUR_MS) },
        AND: [notStopped, dueFast],
      };
    case "live-campaign":
      return {
        ...base,
        campaign: live,
        postedAt: { lt: ago(YOUNG_HOURS * HOUR_MS) },
        AND: [
          notStopped,
          dueFast,
          { OR: [{ trackingEnabled: true }, { postedAt: { gte: ago(LIVE_CAMPAIGN_HORIZON_DAYS * DAY_MS) } }] },
        ],
      };
    case "first-30d":
      return {
        ...base,
        campaign: notLive,
        postedAt: { gte: ago(AUTO_TRACK_DAYS * DAY_MS), lt: ago(YOUNG_HOURS * HOUR_MS) },
        AND: [
          notStopped,
          /* Past its first week an untracked post is read daily, so one read
             six hours ago is not due and must not hold a place. */
          {
            OR: [
              { lastSyncedAt: null },
              { lastSyncedAt: { lt: dueCutoff(now, "daily") } },
              {
                lastSyncedAt: { lt: fast },
                OR: [{ postedAt: { gte: ago(AUTO_TRACK_FAST_DAYS * DAY_MS) } }, { trackingEnabled: true }],
              },
            ],
          },
        ],
      };
    case "backlog":
      return {
        ...base,
        campaign: notLive,
        trackingEnabled: true,
        postedAt: { lt: ago(AUTO_TRACK_DAYS * DAY_MS) },
        AND: [dueFast],
      };
  }
}

const OLDEST_READ_FIRST = { lastSyncedAt: { sort: "asc", nulls: "first" } } as const;

/** The read tiers by rank; tiers that share a rank are interleaved. */
const READ_RANKS: SweepTier[][] = [["first-72h", "live-campaign"], ["first-30d"], ["backlog"]];

/**
 * One platform's candidates, in tier order.
 *
 * `find` is the query -- `db.post.findMany` with the route's select -- so the
 * policy runs unchanged against a fake. Ranks are asked one after another
 * because each one's take is what the ranks above it left.
 */
export async function selectSweepCandidates<T extends { id: string }>(
  find: (query: SweepQuery) => Promise<T[]>,
  opts: {
    platform: Platform;
    budget: number;
    now: Date;
    startedAtField?: Prisma.DateTimeFieldRefInput<"Post">;
    /** Posts whose last read was refused with an answer that stands until a
     *  person acts (DAILY_RECHECK_REASONS). They keep their tier's place in the
     *  count, but are asked after every other read candidate: oldest-read-first
     *  otherwise puts them at the head of every run, since they never read. */
    readLast?: (row: T) => boolean;
  },
): Promise<{ posts: T[]; byTier: Record<SweepTier, number> }> {
  const byTier = Object.fromEntries(SWEEP_TIERS.map((t) => [t, 0])) as Record<SweepTier, number>;
  const readTake = candidateTake(opts.budget);
  if (readTake <= 0) return { posts: [], byTier };

  const seen = new Set<string>();
  const posts: T[] = [];
  const add = (tier: SweepTier, rows: T[]) => {
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      posts.push(row);
      byTier[tier]++;
    }
  };
  const ctx: TierContext = { platform: opts.platform, now: opts.now, startedAtField: opts.startedAtField };

  add("seal", await find({ where: sweepTierWhere("seal", ctx), orderBy: OLDEST_READ_FIRST, take: SEAL_TAKE }));
  const sealIds = posts.map((p) => p.id);

  let left = readTake;
  for (const rank of READ_RANKS) {
    if (left <= 0) break;
    const lists: { tier: SweepTier; row: T }[][] = [];
    for (const tier of rank) {
      const where = sweepTierWhere(tier, ctx);
      /* A seal candidate can match a read tier too -- an old tracker that is
         due, in the backlog or in a running campaign -- and would cost a place. */
      if (sealIds.length) where.id = { notIn: sealIds };
      const rows = await find({ where, orderBy: OLDEST_READ_FIRST, take: left });
      lists.push(rows.map((row) => ({ tier, row })));
    }
    for (const { tier, row } of roundRobin(lists)) {
      if (left <= 0) break;
      const before = posts.length;
      add(tier, [row]);
      left -= posts.length - before;
    }
  }
  if (opts.readLast) {
    const reads = posts.slice(sealIds.length);
    const later = new Set(reads.filter(opts.readLast));
    if (later.size > 0) {
      const first = reads.filter((r) => !later.has(r));
      return { posts: [...posts.slice(0, sealIds.length), ...first, ...later], byTier };
    }
  }
  return { posts, byTier };
}
