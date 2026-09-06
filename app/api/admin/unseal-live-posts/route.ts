/**
 * One-shot repair for posts that were sealed while their campaign was still
 * running.
 *
 * The sweep sealed a post once it passed 30 days from its own `postedAt`, with
 * no reference to whether anyone still had the campaign open. Sealing writes a
 * `PostMetricSnapshot` with `isFinalSnapshot: true`, and the cron's candidate
 * query excludes `snapshots: { none: { isFinalSnapshot: true } }` -- forever.
 * Nothing in this codebase has ever written that back.
 *
 * So a campaign that runs longer than a month lost its earliest posts halfway
 * through while still IN_PROGRESS, and they never rejoined the sweep. Measured
 * in prod on 2026-09-06: 57 of 169 posts in live campaigns were sealed,
 * including 35 of the 46 YouTube posts of one running campaign -- which is the
 * entire reason YouTube metrics had stopped updating. The platform pattern was
 * an accident of post age, not a broken reader.
 *
 * `SEAL_AGE_HOURS` in lib/sync/cadence.ts is now 180 days, which stops this
 * happening again. That fix is forward-looking and cannot help the rows that
 * already carry a seal, because it does not delete anything. This is the route
 * that lets them back in.
 *
 * Safety properties, in the order they matter:
 *   - GET only reads. It is the SELECT you run before the DELETE, and it
 *     reports the exact set POST would touch, grouped by campaign and platform.
 *   - POST requires `{ "confirm": true }`. A bare POST reports and changes
 *     nothing, so a mistyped curl cannot mutate production.
 *   - Inert unless CC_SYNC_TOKEN is set: without it every method 404s, the same
 *     way app/api/admin/cc-sync and repair-dead-letters do.
 *   - It only ever touches snapshots whose `isFinalSnapshot` is true, and only
 *     for posts in campaigns that are still live. It writes no counters and no
 *     `lastSyncedAt`, so it cannot invent a metric. The worst case is that a
 *     post rejoins the queue, is read, and is re-sealed on its own merits.
 *   - It refuses posts past SEAL_AGE_HOURS. Unsealing one of those would hand
 *     the very next cron run a post it is required to seal again, producing a
 *     churn of delete-and-recreate that costs writes and changes nothing.
 *
 * Prod's DATABASE_URL is a Vercel "sensitive" variable and cannot be read back
 * from a laptop, which is why this runs inside prod rather than as a script.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";
import { SEAL_AGE_HOURS } from "@/lib/sync/cadence";
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

/* The same campaign filter the sweep itself uses. A post outside it is not
   something the cron would look at even unsealed, so unsealing it would be a
   write with no consequence. */
const LIVE_CAMPAIGN: Prisma.CampaignWhereInput = {
  status: { in: ["IN_PROGRESS", "PENDING"] },
  archived: false,
  deletedAt: null,
};

const SEALED_SELECT = {
  id: true,
  platform: true,
  postedAt: true,
  campaign: { select: { id: true, title: true } },
  snapshots: { where: { isFinalSnapshot: true }, select: { id: true } },
} satisfies Prisma.PostSelect;

type Sealed = Prisma.PostGetPayload<{ select: typeof SEALED_SELECT }>;

async function survey(now: Date) {
  const sealed = await db.post.findMany({
    where: {
      campaign: LIVE_CAMPAIGN,
      snapshots: { some: { isFinalSnapshot: true } },
    },
    select: SEALED_SELECT,
  });

  const cutoff = now.getTime() - SEAL_AGE_HOURS * 60 * 60 * 1000;
  const eligible: Sealed[] = [];
  const tooOld: Sealed[] = [];
  for (const post of sealed) {
    /* A post with no postedAt cannot be aged, so it cannot be shown to be past
       the horizon. Treat it as eligible: the cron will decide on its own terms
       once it is back in the queue, which is the conservative direction here --
       the reversible mistake, not the permanent one. */
    if (post.postedAt !== null && post.postedAt.getTime() < cutoff) tooOld.push(post);
    else eligible.push(post);
  }
  return { sealed, eligible, tooOld };
}

function tally(posts: Sealed[]) {
  const byPlatform: Record<string, number> = {};
  const byCampaign: Record<string, number> = {};
  for (const p of posts) {
    byPlatform[p.platform] = (byPlatform[p.platform] ?? 0) + 1;
    byCampaign[p.campaign.title] = (byCampaign[p.campaign.title] ?? 0) + 1;
  }
  return { byPlatform, byCampaign };
}

/* Capped, and small on purpose: this is context for a human reading the
   response, not a dataset. The counts above are the answer. */
const SAMPLE = 10;

function report(s: Awaited<ReturnType<typeof survey>>, now: Date) {
  return {
    sealedInLiveCampaigns: s.sealed.length,
    wouldUnseal: s.eligible.length,
    leftSealedPastHorizon: s.tooOld.length,
    horizonDays: SEAL_AGE_HOURS / 24,
    eligible: tally(s.eligible),
    leftAlone: tally(s.tooOld),
    sample: s.eligible.slice(0, SAMPLE).map((p) => ({
      id: p.id,
      platform: p.platform,
      campaign: p.campaign.title,
      ageDays:
        p.postedAt === null
          ? null
          : Math.round((now.getTime() - p.postedAt.getTime()) / (24 * 60 * 60 * 1000)),
      finalSnapshots: p.snapshots.length,
    })),
  };
}

/** The SELECT. Run this first; it is the whole point of splitting the verbs. */
export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return auth.res;
  const now = new Date();
  const s = await survey(now);
  return NextResponse.json({ ok: true, dryRun: true, ...report(s, now) });
}

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return auth.res;
  const log = createLogger({ context: { route: "admin/unseal-live-posts" } });

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // A body-less POST is treated as a dry run, not an error.
  }

  const now = new Date();
  const s = await survey(now);

  if (body.confirm !== true) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      hint: 'send {"confirm":true} to apply',
      ...report(s, now),
    });
  }

  if (s.eligible.length === 0) {
    return NextResponse.json({ ok: true, unsealed: 0, ...report(s, now) });
  }

  /* Delete the seal rows rather than flipping isFinalSnapshot to false.
     A demoted seal would stay in the trend series as an ordinary snapshot,
     asserting a reading that was never taken from the platform -- it was copied
     from the post's stored counters at seal time. Removing it leaves the series
     showing only measurements that actually happened. */
  const snapshotIds = s.eligible.flatMap((p) => p.snapshots.map((snap) => snap.id));
  const result = await db.postMetricSnapshot.deleteMany({
    where: { id: { in: snapshotIds }, isFinalSnapshot: true },
  });

  log.warn("unsealed posts in live campaigns", {
    posts: s.eligible.length,
    snapshotsDeleted: result.count,
    leftSealedPastHorizon: s.tooOld.length,
    ...tally(s.eligible),
  });

  return NextResponse.json({
    ok: true,
    unsealed: s.eligible.length,
    snapshotsDeleted: result.count,
    leftSealedPastHorizon: s.tooOld.length,
    ...tally(s.eligible),
  });
}
