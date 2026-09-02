/**
 * One-shot repair for posts that were dead-lettered for something that was
 * never their fault.
 *
 * The cron used to charge a strike against `Post.syncFailCount` for *any*
 * unmeasured read, and five strikes writes `syncDisabledAt`. Among the reasons
 * that counted were a TikTok WAF challenge to our datacenter egress, our own
 * rate gate being shut, a dead sandbox lane, a lapsed Instagram token and a
 * missing API key -- none of which is a statement about the post. The same URL
 * loads fine in a browser.
 *
 * `syncDisabledAt` then removes the post from the cron's own query, and nothing
 * anywhere in this codebase ever writes that column back to null -- not a
 * successful on-demand refresh, not anything. The cron runs hourly, so five
 * consecutive bad hours was five hours to permanently silent. The route that
 * caused it now refuses to charge those reasons (see UNCHARGEABLE_REASONS), but
 * that fix is forward-looking: posts already switched off stay switched off.
 * This is the one that lets them back in.
 *
 * Safety properties, in the order they matter:
 *   - GET only reads. It is the `SELECT` you run before the `UPDATE`, and it
 *     reports the exact set POST would touch, grouped by why.
 *   - POST requires `{ "confirm": true }` in the body. A bare POST reports and
 *     changes nothing, so a mistyped curl cannot mutate production.
 *   - Inert unless CC_SYNC_TOKEN is set: without it every method 404s, the same
 *     way app/api/admin/cc-sync does. Retiring that variable retires both.
 *   - It only ever clears `syncDisabledAt` and zeroes `syncFailCount`. It writes
 *     no counters, no snapshots and no `lastSyncedAt`, so it cannot invent
 *     metrics -- the worst case is that a post rejoins the queue, gets read, and
 *     dead-letters again on its own merits.
 *
 * Prod's DATABASE_URL is a Vercel "sensitive" variable and cannot be read back
 * from a laptop, which is why this runs inside prod rather than as a script.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { LAST_FETCH_KEY } from "@/lib/metricDisplay";
import { UNCHARGEABLE_REASONS } from "@/lib/platforms/fetchPostMetrics";
import { createLogger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Constant-time, and length-safe: timingSafeEqual throws on a length mismatch. */
function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(`Bearer ${expected}`);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorize(request: NextRequest) {
  const token = process.env.CC_SYNC_TOKEN;
  if (!token) {
    return { ok: false as const, res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  if (!tokenMatches(request.headers.get("authorization"), token)) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true as const };
}

type Candidate = {
  id: string;
  platform: string;
  campaignId: string;
  syncFailCount: number;
  syncDisabledAt: Date | null;
  platformMetrics: unknown;
};

/** The reason recorded against the post by its last failed read, if any. */
function lastReason(platformMetrics: unknown): string | null {
  if (!platformMetrics || typeof platformMetrics !== "object") return null;
  const bag = (platformMetrics as Record<string, unknown>)[LAST_FETCH_KEY];
  if (!bag || typeof bag !== "object") return null;
  const reason = (bag as Record<string, unknown>).reason;
  return typeof reason === "string" ? reason : null;
}

/**
 * Which group a dead post falls into.
 *
 * `ours` is unambiguous: the recorded reason is one we no longer charge, so the
 * strike that killed it would not be levied today.
 *
 * `unrecorded` is the awkward one. __lastFetch is written by the no-metrics
 * branch of applyPostMetrics, so a post killed by the thrown-error path -- or
 * killed before that diagnostic existed -- carries no reason at all. Repairing
 * it is a guess. It is the right guess: the cron's TikTok reads went out through
 * function egress, which TikTok answers with a WAF shell roughly three times in
 * four, and that path was the dominant producer of strikes. And the two mistakes
 * are not symmetric -- wrongly repairing a genuinely dead post costs one read
 * and it re-dead-letters by itself, while wrongly leaving a healthy post dead
 * costs it forever, silently. Reported separately anyway, and excludable with
 * `?onlyRecorded=1`, because a guess should be visible as one.
 *
 * `theirs` is left alone: the platform answered, about this post, and the answer
 * was that it is gone or publishes nothing. That is what the dead letter is for.
 */
function classify(post: Candidate): "ours" | "unrecorded" | "theirs" {
  const reason = lastReason(post.platformMetrics);
  if (reason === null) return "unrecorded";
  /* Widened deliberately, the same way refreshSummary does it: the set is typed
     over the FetchReason union, but this reason was parsed out of a JSON column
     written by an older deployment and may carry a slug this bundle has never
     heard of. An unknown slug must fall through to "theirs" -- the conservative
     side -- not fail to compile. */
  return (UNCHARGEABLE_REASONS as ReadonlySet<string>).has(reason) ? "ours" : "theirs";
}

async function survey() {
  const dead = (await db.post.findMany({
    where: { syncDisabledAt: { not: null } },
    select: {
      id: true,
      platform: true,
      campaignId: true,
      syncFailCount: true,
      syncDisabledAt: true,
      platformMetrics: true,
    },
  })) as Candidate[];

  const groups: Record<string, Candidate[]> = { ours: [], unrecorded: [], theirs: [] };
  const byReason: Record<string, number> = {};
  const byPlatform: Record<string, number> = {};
  for (const post of dead) {
    groups[classify(post)].push(post);
    const reason = lastReason(post.platformMetrics) ?? "(none recorded)";
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    byPlatform[post.platform] = (byPlatform[post.platform] ?? 0) + 1;
  }
  return { dead, groups, byReason, byPlatform };
}

/* Capped, and small on purpose: this is context for a human reading the
   response, not a dataset. The counts above are the answer. */
const SAMPLE = 10;

function report(s: Awaited<ReturnType<typeof survey>>) {
  return {
    deadLettered: s.dead.length,
    repairable: {
      ours: s.groups.ours.length,
      unrecorded: s.groups.unrecorded.length,
    },
    leftAlone: s.groups.theirs.length,
    byReason: s.byReason,
    byPlatform: s.byPlatform,
    sample: [...s.groups.ours, ...s.groups.unrecorded].slice(0, SAMPLE).map((p) => ({
      id: p.id,
      platform: p.platform,
      campaignId: p.campaignId,
      syncFailCount: p.syncFailCount,
      disabledAt: p.syncDisabledAt?.toISOString() ?? null,
      reason: lastReason(p.platformMetrics) ?? "(none recorded)",
      group: classify(p),
    })),
  };
}

/** The SELECT. Run this first; it is the whole point of splitting the verbs. */
export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return auth.res;
  const s = await survey();
  return NextResponse.json({ ok: true, dryRun: true, ...report(s) });
}

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return auth.res;
  const log = createLogger({ context: { route: "admin/repair-dead-letters" } });

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // A body-less POST is treated as a dry run, not an error.
  }

  const onlyRecorded =
    body.onlyRecorded === true ||
    new URL(request.url).searchParams.get("onlyRecorded") === "1";
  const s = await survey();
  const targets = onlyRecorded ? s.groups.ours : [...s.groups.ours, ...s.groups.unrecorded];

  if (body.confirm !== true) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      wouldRepair: targets.length,
      hint: 'send {"confirm":true} to apply',
      ...report(s),
    });
  }

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, repaired: 0, ...report(s) });
  }

  /* One statement, not one per post: a few hundred sequential updates is a
     needless pile of Neon writes, and a partial run leaves the operator unable
     to say what state they are in. */
  const result = await db.post.updateMany({
    where: { id: { in: targets.map((p) => p.id) } },
    data: { syncFailCount: 0, syncDisabledAt: null },
  });

  log.warn("cleared dead letters", {
    repaired: result.count,
    ours: s.groups.ours.length,
    unrecorded: onlyRecorded ? 0 : s.groups.unrecorded.length,
    leftAlone: s.groups.theirs.length,
    onlyRecorded,
  });

  return NextResponse.json({
    ok: true,
    repaired: result.count,
    onlyRecorded,
    leftAlone: s.groups.theirs.length,
    byReason: s.byReason,
    byPlatform: s.byPlatform,
  });
}
