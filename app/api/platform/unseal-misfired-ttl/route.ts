/**
 * One-shot repair for the seals written by the null-TTL misfire.
 *
 * Why it exists rather than a script: prod's DATABASE_URL is a Vercel
 * "sensitive" variable and cannot be read back from a laptop, so one-off prod
 * maintenance runs as a route inside prod -- the same reasoning as
 * app/api/admin/cc-sync and app/api/admin/repair-dead-letters.
 *
 * Why not app/api/admin/unseal-live-posts, which already unseals: that route
 * repairs a different fault and scopes itself to campaigns still IN_PROGRESS or
 * PENDING. 497 of ~500 campaigns here are COMPLETE, and a COMPLETE campaign's
 * posts are swept now, so its filter would leave almost every misfired seal in
 * place. It also refuses posts past a `postedAt` horizon, which is exactly the
 * age-based reasoning the tracker model deliberately dropped.
 *
 * Guarded by the env allowlist (PLATFORM_ADMIN_EMAILS) like its siblings under
 * /api/platform, not by CC_SYNC_TOKEN: this needs no new environment variable,
 * so the repair does not depend on a redeploy to become reachable.
 *
 * Safety properties, in the order they matter:
 *   - GET only reads. It reports the exact set POST would touch.
 *   - POST requires `{ "confirm": true }`. A bare POST reports and changes
 *     nothing, so a mistyped request cannot mutate production.
 *   - Selection is by the corrected policy, not by a date range: a post is
 *     restored only when its recomputed expiry is still in the future. A
 *     tracker that genuinely ran out stays sealed.
 *   - It writes no counters and invents no measurement. It deletes seal rows
 *     and sets trackingEnabled back to true, which is precisely what sealPost
 *     did. `lastSyncedAt` is left as the seal left it: moving it back would be
 *     asserting a read time we do not have, and its only effect is to defer the
 *     next read by one cadence.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isPlatformAdmin } from "@/lib/billing/subscription";
import { parsePostTracking } from "@/lib/trackers/granularity";
import { TTL_SEAL_SOURCE, chunk, sealedInError } from "@/lib/sync/unsealMisfiredTtl";
import { createLogger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* A survey over every sealed post plus chunked writes; the default ceiling is
   not enough for a repair sized in the low thousands. */
export const maxDuration = 120;

/** 404 rather than 403, matching /api/platform/stats: a 403 tells an attacker
 *  the endpoint is real and worth pushing on. */
async function denyUnlessOperator(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user || !isPlatformAdmin(session.user.email ?? null)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

async function survey(now: Date) {
  const sealed = await db.post.findMany({
    where: { snapshots: { some: { isFinalSnapshot: true, syncSource: TTL_SEAL_SOURCE } } },
    select: {
      id: true,
      platform: true,
      trackingEnabled: true,
      trackingStartedAt: true,
      trackingExpiresAt: true,
      trackingTtlDays: true,
      lastSyncedAt: true,
      syncDisabledAt: true,
      creator: { select: { orgId: true } },
      snapshots: {
        where: { isFinalSnapshot: true },
        select: { id: true, syncSource: true },
      },
    },
  });

  const orgIds = [...new Set(sealed.map((p) => p.creator.orgId))];
  const orgs = orgIds.length
    ? await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, uiConfig: true } })
    : [];
  const granularityByOrg = new Map(orgs.map((o) => [o.id, parsePostTracking(o.uiConfig)]));

  const eligible: typeof sealed = [];
  const leftSealed: typeof sealed = [];
  for (const post of sealed) {
    const wrong = sealedInError({
      sealSources: post.snapshots.map((s) => s.syncSource ?? ""),
      tracking: {
        trackingEnabled: post.trackingEnabled ?? false,
        trackingStartedAt: post.trackingStartedAt,
        trackingExpiresAt: post.trackingExpiresAt,
        trackingTtlDays: post.trackingTtlDays ?? null,
        lastSyncedAt: post.lastSyncedAt,
        /* Not read by sealedInError, which compares now against the expiry
           alone; a throttle stamp cannot make a seal right or wrong. */
        lastAttemptAt: null,
        syncDisabledAt: post.syncDisabledAt,
        hasFinalSnapshot: false,
        granularity: granularityByOrg.get(post.creator.orgId) ?? parsePostTracking(null),
        now,
      },
    });
    (wrong ? eligible : leftSealed).push(post);
  }
  return { sealed, eligible, leftSealed };
}

function byPlatform(posts: Array<{ platform: string }>) {
  const out: Record<string, number> = {};
  for (const p of posts) out[p.platform] = (out[p.platform] ?? 0) + 1;
  return out;
}

function report(s: Awaited<ReturnType<typeof survey>>) {
  return {
    sealedByTtl: s.sealed.length,
    wouldUnseal: s.eligible.length,
    leftSealed: s.leftSealed.length,
    eligible: byPlatform(s.eligible),
    leftAlone: byPlatform(s.leftSealed),
  };
}

export async function GET() {
  const denied = await denyUnlessOperator();
  if (denied) return denied;
  return NextResponse.json(report(await survey(new Date())));
}

export async function POST(request: NextRequest) {
  const denied = await denyUnlessOperator();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const now = new Date();
  const s = await survey(now);
  if ((body as { confirm?: unknown } | null)?.confirm !== true) {
    return NextResponse.json({ ...report(s), applied: false, hint: 'POST {"confirm":true} to apply' });
  }

  let snapshotsDeleted = 0;
  let postsReopened = 0;
  for (const group of chunk(s.eligible)) {
    const snapshotIds = group.flatMap((p) =>
      p.snapshots.filter((sn) => sn.syncSource === TTL_SEAL_SOURCE).map((sn) => sn.id),
    );
    const [deleted, reopened] = await db.$transaction([
      db.postMetricSnapshot.deleteMany({ where: { id: { in: snapshotIds } } }),
      db.post.updateMany({ where: { id: { in: group.map((p) => p.id) } }, data: { trackingEnabled: true } }),
    ]);
    snapshotsDeleted += deleted.count;
    postsReopened += reopened.count;
  }

  createLogger({ context: { route: "platform/unseal-misfired-ttl" } }).info("misfired ttl seals repaired", {
    snapshotsDeleted,
    postsReopened,
    leftSealed: s.leftSealed.length,
  });

  return NextResponse.json({ ...report(s), applied: true, snapshotsDeleted, postsReopened });
}
