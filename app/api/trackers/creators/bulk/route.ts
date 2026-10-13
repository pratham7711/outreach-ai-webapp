import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { campaignScopeWhereFor } from "@/lib/campaignScope";
import { MAX_BULK_CREATORS, resolveRosterSelection } from "@/lib/creators/rosterSelection";
import { resolveTrackerPlan } from "@/lib/trackers/sourceSwitch";
import { trackerLimitError, trackerRoomLeft, trackerUsage, type TrackerUsage } from "@/lib/trackers/limit";
import {
  BULK_TRACK_UNGATED_MAX,
  overUngatedMaxMessage,
  trackAllGate,
} from "@/lib/trackers/trackAll";

/**
 * Track many creators in one request (plan §04 "Track creators", §12 F2/F3).
 *
 *   { scope: "all" }        Track all, from the roster's header.
 *   { creatorIds: [...] }   Track selected, from the roster's bulk bar.
 *   { query: "..." }        The same bar with "all matching" ticked: the
 *                           roster's own query string, resolved the way every
 *                           other roster bulk action resolves it.
 *   { campaignId }          Track this campaign's creators.
 *
 * The org comes from the session and every selection is resolved inside it,
 * so an id from another workspace is simply not among the creators counted.
 * lib/trackers/trackAll.ts has the gate and why it exists.
 */

const bodySchema = z.union([
  z.object({ scope: z.literal("all") }),
  z.object({ creatorIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_BULK_CREATORS) }),
  z.object({ campaignId: z.string().min(1).max(100) }),
  z.object({ query: z.string().max(4000) }),
]);

function finite(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

/** What the roster and campaign buttons need before they offer anything. */
export async function GET(req: NextRequest) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const [plan, usage, roster, trackedCreators] = await Promise.all([
      resolveTrackerPlan(),
      trackerUsage(orgId),
      db.creator.count({ where: { orgId, deletedAt: null } }),
      db.creator.count({ where: { orgId, deletedAt: null, trackedSince: { not: null } } }),
    ]);
    const gate = trackAllGate(plan, orgId);
    const room = trackerRoomLeft(usage);

    return NextResponse.json({
      trackAllOpen: gate.open,
      reason: gate.reason,
      ungatedMax: BULK_TRACK_UNGATED_MAX,
      roster,
      untracked: Math.max(0, roster - trackedCreators),
      tracked: usage.used,
      limit: finite(usage.max),
      roomLeft: finite(room),
      limitMessage: room === 0 ? trackerLimitError(usage, "creators") : null,
    });
  } catch (error) {
    console.error("Failed to read bulk tracking status:", error);
    return NextResponse.json({ error: "Failed to read tracking status" }, { status: 500 });
  }
}

type Outcome =
  | { kind: "busy" }
  | { kind: "closed"; wouldAdd: number }
  | {
      kind: "done";
      requested: number;
      alreadyTracked: number;
      added: number;
      skippedForLimit: number;
      usage: TrackerUsage;
      room: number;
      ids: string[];
    };

export async function POST(req: NextRequest) {
  try {
    // A bulk write to the watchlist, so the same key the roster's other bulk
    // writes ask for; a viewer can read trackers and not start hundreds.
    const authz = await requirePermission(req, "creators:create");
    if (!authz.ok) return authz.response;
    const auth = authz.auth;
    const { orgId } = auth;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

    const gate = trackAllGate(await resolveTrackerPlan(), orgId);
    if ("scope" in body && !gate.open) {
      return NextResponse.json({ error: "track_all_closed", message: gate.reason }, { status: 409 });
    }

    /* Which creators the request means. Resolved before the transaction, so
       the lock is held for counting and writing only. */
    let where: Prisma.CreatorWhereInput;
    let scope: "all" | "selected" | "matching" | "campaign";
    let campaign: { id: string; title: string } | null = null;
    let named = 0;
    if ("scope" in body) {
      scope = "all";
      where = { orgId, deletedAt: null };
    } else if ("creatorIds" in body) {
      scope = "selected";
      const ids = [...new Set(body.creatorIds)];
      named = ids.length;
      where = { orgId, deletedAt: null, id: { in: ids } };
    } else if ("campaignId" in body) {
      scope = "campaign";
      campaign = await db.campaign.findFirst({
        where: { id: body.campaignId, orgId, deletedAt: null, ...campaignScopeWhereFor(auth) },
        select: { id: true, title: true },
      });
      if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
      /* The campaign's roster as its page draws it: assigned through an
         activation, or delivered a post (imported campaigns have only posts). */
      where = {
        orgId,
        deletedAt: null,
        OR: [
          { activations: { some: { campaignId: campaign.id, deletedAt: null } } },
          { posts: { some: { campaignId: campaign.id, ...NOT_REMOVED } } },
        ],
      };
    } else {
      scope = "matching";
      const target = await resolveRosterSelection(orgId, { query: body.query });
      if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });
      where = { orgId, deletedAt: null, id: { in: target.ids } };
    }

    const now = new Date();
    const outcome = await db.$transaction<Outcome>(
      async (tx) => {
        /* One bulk track per agency at a time. Transaction-scoped, so it is
           released by the commit or the rollback and cannot outlive a request
           that died; try-, not wait-, so a second click is told rather than
           queued behind the first. The count below happens behind it, which is
           what stops two requests both seeing the same room left. */
        const lock = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
          `SELECT pg_try_advisory_xact_lock(hashtext('track-bulk:' || $1)) AS "locked"`,
          orgId
        );
        if (lock?.[0]?.locked !== true) return { kind: "busy" };

        const requested = await tx.creator.count({ where });
        const alreadyTracked = await tx.creator.count({ where: { AND: [where, { trackedSince: { not: null } }] } });
        const usage = await trackerUsage(orgId, tx);
        const room = trackerRoomLeft(usage);
        const untracked = Math.max(0, requested - alreadyTracked);
        const wouldAdd = Math.min(untracked, room);
        if (!gate.open && wouldAdd > BULK_TRACK_UNGATED_MAX) return { kind: "closed", wouldAdd };

        /* Oldest on the roster first, with the id to make the order total: when
           the room runs out, which creators made it in is the same answer on
           every retry. */
        const picked =
          wouldAdd > 0
            ? await tx.creator.findMany({
                where: { AND: [where, { trackedSince: null }] },
                orderBy: [{ addedAt: "asc" }, { id: "asc" }],
                take: wouldAdd,
                select: { id: true },
              })
            : [];
        const ids = picked.map((c) => c.id);
        /* Last attempt = now puts every new row at the BACK of the reading
           queue (oldest attempt first, nulls first); unstamped, they would
           all be read before anyone already tracked (plan F3). The
           trackedSince: null guard leaves a creator someone tracked by hand
           in the meantime with the date they gave it. */
        const { count: added } = ids.length
          ? await tx.creator.updateMany({
              where: { id: { in: ids }, orgId, deletedAt: null, trackedSince: null },
              data: { trackedSince: now, trackerLastAttemptAt: now },
            })
          : { count: 0 };

        return { kind: "done", requested, alreadyTracked, added, skippedForLimit: untracked - wouldAdd, usage, room, ids };
      },
      { maxWait: 5_000, timeout: 20_000 }
    );

    if (outcome.kind === "busy") {
      return NextResponse.json(
        { error: "track_bulk_busy", message: "Another Track all is running for this workspace. Try again when it finishes." },
        { status: 409 }
      );
    }
    if (outcome.kind === "closed") {
      return NextResponse.json(
        { error: "track_all_closed", message: overUngatedMaxMessage(outcome.wouldAdd) },
        { status: 409 }
      );
    }

    const { requested, alreadyTracked, added, skippedForLimit, usage, room, ids } = outcome;
    const roomLeft = finite(room - added);
    const after = { used: usage.used + added, max: usage.max };

    if (added > 0) {
      await logAudit({
        orgId,
        ...getAuditActor(auth),
        action: "tracker.creators_track",
        entityType: campaign ? "campaign" : "creator_tracker",
        entityId: campaign?.id,
        entityLabel: campaign
          ? `Track this campaign's creators: ${campaign.title}`
          : scope === "all"
            ? "Track all"
            : "Track selected",
        ipAddress: getRequestIp(req),
        metadata: { scope, requested, added, alreadyTracked, skippedForLimit, roomLeft, creatorIds: ids },
      });
    }

    return NextResponse.json({
      requested,
      added,
      alreadyTracked,
      skippedForLimit,
      roomLeft,
      limit: finite(usage.max),
      tracked: after.used,
      /* Ids that named no creator in this workspace: someone else's, or gone. */
      ...(scope === "selected" ? { notFound: Math.max(0, named - requested) } : {}),
      limitMessage: skippedForLimit > 0 ? trackerLimitError(after, "creators") : null,
    });
  } catch (error) {
    console.error("Failed to track creators in bulk:", error);
    return NextResponse.json({ error: "Failed to track creators" }, { status: 500 });
  }
}
