import { after, NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";
import { getRefreshCooldown, refreshCampaign } from "@/lib/sync/refreshCampaign";

/**
 * POST /api/campaigns/[id]/refresh — refresh everything the campaign reports on.
 * GET  /api/campaigns/[id]/refresh — how long until it may be refreshed again,
 *      and how far along a run in flight is, so the button can show "N of M".
 *
 * Thin on purpose. The work, and more importantly the thirty-minute gate, live
 * in lib/sync/refreshCampaign so that the MCP server drives exactly the same
 * operation under exactly the same limit -- a cooldown enforced in this handler
 * alone would be bypassed by the first caller that is not this handler.
 */

/* The work is paced -- roughly a second and a half between platform requests --
   so an eighty-post campaign needs minutes, not seconds. At the old default
   this route had 45s, which bought about 25 posts and reported the rest as
   "remaining" every single time. */
export const maxDuration = 300;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id: campaignId } = await params;

  const state = await getRefreshCooldown(orgId, campaignId);
  if (!state) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  return NextResponse.json(state);
}

/**
 * Hand the run to a fresh invocation.
 *
 * A continuation has to be a NEW request, not more work inside this one. The
 * whole reason posts get left behind is that this function has a hard 300s
 * ceiling; `after()` extends the current invocation but does not reset that
 * ceiling, so continuing in-process would hit exactly the wall we are escaping.
 * A sub-request gets its own 300s -- and, because the pool is rebuilt, its own
 * egress identities, which is the part that actually changes a walled post's
 * odds.
 *
 * Deliberately not awaited for its body. We only need the request to have been
 * accepted; the continuation reports itself through the run row, which is what
 * the button is already polling.
 */
async function handOff(
  request: NextRequest,
  campaignId: string,
  runId: string,
  nextWindow: number,
  log: ReturnType<typeof createLogger>,
) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    /* Without it the continuation cannot authenticate to us, so it would 401 in
       a loop. Better to stop here and say why than to spin. */
    log.warn("cannot continue refresh: CRON_SECRET is not set", { runId });
    return;
  }
  const url = new URL(`/api/campaigns/${campaignId}/refresh`, request.nextUrl.origin);
  try {
    await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      /* nextWindow is what stops a runaway chain: refreshCampaign refuses to
         continue past MAX_REFRESH_WINDOWS, so a window that fails fast cannot
         spawn an unbounded number of successors inside the wall-clock bound. */
      body: JSON.stringify({ resumeRunId: runId, window: nextWindow }),
      /* Not kept alive past acceptance: the child owns the work from here, and
         holding the socket would bill this invocation for the child's runtime. */
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    /* A timeout here is the EXPECTED path -- the child is still working when we
       stop listening. Only worth a line, never worth failing the parent. */
    log.info("continuation dispatched", {
      runId,
      note: error instanceof Error ? error.name : String(error),
    });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const log = createLogger({ context: { route: "campaigns/[id]/refresh" } });
  try {
    const { id: campaignId } = await params;

    /* Two ways in. A person with a session starts a run; the server continues
       one by calling itself with the cron secret. The continuation path takes
       NO caller-supplied org -- refreshCampaign scopes the run lookup by the
       org it resolves itself, so naming another org's run id finds nothing. */
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);
    const resumeRunId = typeof body?.resumeRunId === "string" ? body.resumeRunId : undefined;
    const bodyWindow = typeof body?.window === "number" ? body.window : undefined;
    const secret = process.env.CRON_SECRET;
    const isContinuation =
      Boolean(resumeRunId) &&
      Boolean(secret) &&
      request.headers.get("authorization") === `Bearer ${secret}`;

    let orgId: string;
    let userId: string | undefined;

    if (isContinuation) {
      /* The run row is the authority on which org this belongs to. Reading it
         here keeps the tenancy check in one place rather than trusting a body. */
      const run = await db.campaignRefreshRun.findFirst({
        where: { id: resumeRunId, campaignId },
        select: { orgId: true, userId: true },
      });
      if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
      orgId = run.orgId;
      userId = run.userId ?? undefined;
    } else {
      const session = await auth();
      if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      orgId = (session.user as any).orgId;
      userId = (session.user as any).id as string | undefined;
    }

    const outcome = await refreshCampaign({
      orgId,
      campaignId,
      userId,
      /* The window counter is read only on the continuation branch, which has
         already proved it holds CRON_SECRET. A caller with a session starts at
         window 1 and cannot say otherwise. */
      ...(isContinuation ? { resumeRunId, window: bodyWindow } : {}),
    });

    if (!outcome.ok && outcome.reason === "not-found") {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    if (!outcome.ok && outcome.reason === "cooldown") {
      return NextResponse.json(
        { error: outcome.message, ...outcome.state },
        { status: 429, headers: { "Retry-After": String(outcome.state.retryAfterSeconds) } }
      );
    }
    if (!outcome.ok) return NextResponse.json({ error: "Refresh failed" }, { status: 500 });

    /* The guarantee, such as it can be made: a window that ends with retryable
       posts left opens another one, until every post is measured or the wall
       bound is reached. after() lets the response go back to the button
       immediately while the hand-off happens behind it. */
    if (outcome.result.continuing) {
      try {
        after(() =>
          handOff(request, campaignId, outcome.result.runId, outcome.result.window + 1, log)
        );
      } catch (error) {
        /* Scheduling the next window is the only thing that can fail here, and
           it must never cost the caller the window that just succeeded --
           throwing would turn a refresh that measured 70 posts into a 500 that
           measured none, as far as the button can tell. The run row stays
           "continuing", so the work is recorded as outstanding either way. */
        log.warn("could not schedule the next refresh window", {
          runId: outcome.result.runId,
          continuable: outcome.result.continuable,
          window: outcome.result.window,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json(outcome.result);
  } catch (error) {
    log.error("campaign refresh failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  }
}
