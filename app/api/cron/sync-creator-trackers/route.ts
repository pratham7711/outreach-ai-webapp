import { NextRequest, NextResponse } from "next/server";
import { snapshotCreators } from "@/lib/creators/snapshot";
import { TRACKER_SWEEP_STOP_PERCENT } from "@/lib/platforms/instagramDiscoveryTokens";
import { openTopPostsSession } from "@/lib/platforms/tiktokTopPostsBrowser";
import { openSandboxProfileFetcher } from "@/lib/platforms/tiktokProfileSandbox";
import { withTimeout } from "@/lib/platforms/tiktokBrowser";
import { createLogger } from "@/lib/observability/logger";
import { inReaderV2Scope, resolveTrackerPlan } from "@/lib/trackers/sourceSwitch";
import { cronRoute } from "@/lib/ops/cronRoute";
import { openSourceGuard } from "@/lib/ops/sourceBreaker";

/* TikTok reads open a browser, which is the expensive case; Instagram and
   YouTube are ordinary HTTP and take milliseconds. The ceiling is sized for the
   browser path, as the sound sweep's is. */
export const maxDuration = 300;
export const runtime = "nodejs";
/* iad1, overriding the project's sin1 -- deliberately, and only here. TikTok
   treats regions differently per endpoint: music/detail answers sin1 and
   refuses iad1 (statusCode 10203), while profile pages serve sin1 a 1.4KB WAF
   login shell and serve iad1 the full server-rendered page (verified both ways
   -- sandbox fetch from iad1, diagnostic route from sin1). Sounds therefore
   stay on the project default; creators read from where their pages answer. */
export const preferredRegion = "iad1";

export const dynamic = "force-dynamic";

async function cronHandler(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/sync-creator-trackers" } });

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  /* The legacy position of the three-way switch (plan §07). While the switch
     says legacy -- or its tables are absent, or anything about it fails --
     this is today's sweep, unchanged. Once reader v2 owns some creators, this
     reads only the rest, so no creator is read twice and none is left out. */
  const plan = await resolveTrackerPlan();
  const v2OwnsEverything = plan.effective !== "legacy" && plan.scopeOrgIds.length === 0 && plan.percent >= 100;
  if (v2OwnsEverything) {
    return NextResponse.json({ ok: true, ran: false, position: plan.effective, reason: "reader v2 owns every creator" });
  }
  const scope =
    plan.effective === "legacy"
      ? {}
      : plan.percent >= 100
        ? { orgIdsNotIn: plan.scopeOrgIds }
        : { inScope: (c: { id: string; orgId: string }) => !inReaderV2Scope(plan, c) };

  /* The per-source kill switches apply here; the breakers do not (see
     lib/ops/sourceBreaker). With no switch off this changes nothing. */
  const sourceGuard = await openSourceGuard({ reader: "creator-reads", breakers: false });

  try {
    /* Stats are plain fetches; the browser exists only for TikTok post grids,
       is launched lazily on the first grid actually due (daily cadence), and
       is shared across the sweep. */
    const grids = openTopPostsSession();
    const remote = openSandboxProfileFetcher();
    try {
      const counts = await snapshotCreators({
        dryRun,
        // Leaves room to write a response before the platform ceiling.
        deadlineMs: 4 * 60 * 1000,
        readTikTokPosts: (handle) => grids.read(handle),
        readTikTokProfileRemote: (handle) => remote.read(handle),
        readTikTokEmbedHtml: (handle) => remote.readEmbedHtml(handle),
        sourceGuard,
        instagramStopAtPercent: TRACKER_SWEEP_STOP_PERCENT,
        ...scope,
      });
      log.info("creator tracker cron complete", { ...counts, dryRun });
      return NextResponse.json({ ok: true, dryRun, ...counts });
    } finally {
      /* Bounded like every other browser or sandbox call: the sweep returns by
         its abandon point, and an unbounded close would hand the 504 back. */
      await withTimeout(Promise.all([grids.close(), remote.close()]), 15_000, "sweep cleanup").catch((e) =>
        log.warn("creator tracker cleanup did not finish", {
          error: e instanceof Error ? e.message : String(e),
        })
      );
    }
  } catch (error) {
    log.error("creator tracker cron failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}

/* Kill switch and heartbeat around the handler above (lib/ops/cronRoute). */
export const GET = cronRoute("sync-creator-trackers", cronHandler);
