import { NextRequest, NextResponse } from "next/server";
import { snapshotCreators } from "@/lib/creators/snapshot";
import { openTopPostsSession } from "@/lib/platforms/tiktokTopPostsBrowser";
import { openSandboxProfileFetcher } from "@/lib/platforms/tiktokProfileSandbox";
import { createLogger } from "@/lib/observability/logger";

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
    const remote = openSandboxProfileFetcher();
    try {
      const counts = await snapshotCreators({
        dryRun,
        // Leaves room to write a response before the platform ceiling.
        deadlineMs: 4 * 60 * 1000,
        readTikTokPosts: (handle) => grids.read(handle),
        readTikTokProfileRemote: (handle) => remote.read(handle),
        readTikTokEmbedHtml: (handle) => remote.readEmbedHtml(handle),
      });
      log.info("creator tracker cron complete", { ...counts, dryRun });
      return NextResponse.json({ ok: true, dryRun, ...counts });
    } finally {
      await Promise.all([grids.close(), remote.close()]);
    }
  } catch (error) {
    log.error("creator tracker cron failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}
