import { NextRequest, NextResponse } from "next/server";
import { snapshotCreators } from "@/lib/creators/snapshot";
import { openTopPostsSession } from "@/lib/platforms/tiktokTopPostsBrowser";
import { createLogger } from "@/lib/observability/logger";

/* TikTok reads open a browser, which is the expensive case; Instagram and
   YouTube are ordinary HTTP and take milliseconds. The ceiling is sized for the
   browser path, as the sound sweep's is. */
export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/sync-creator-trackers" } });

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    /* Stats are plain fetches; the browser exists only for TikTok post grids,
       is launched lazily on the first grid actually due (daily cadence), and
       is shared across the sweep. */
    const grids = openTopPostsSession();
    try {
      const counts = await snapshotCreators({
        dryRun,
        // Leaves room to write a response before the platform ceiling.
        deadlineMs: 4 * 60 * 1000,
        readTikTokPosts: (handle) => grids.read(handle),
      });
      log.info("creator tracker cron complete", { ...counts, dryRun });
      return NextResponse.json({ ok: true, dryRun, ...counts });
    } finally {
      await grids.close();
    }
  } catch (error) {
    log.error("creator tracker cron failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}
