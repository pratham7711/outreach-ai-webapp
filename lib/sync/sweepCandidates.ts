import type { Platform } from "@/lib/generated/prisma/client";

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
