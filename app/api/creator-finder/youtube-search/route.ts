import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCreatorFinder, noStore } from "@/lib/creatorFinder/gate";
import { searchYouTubeChannels, YouTubeQuotaError } from "@/lib/creatorFinder/youtubeChannel";
import { rosterMatches } from "@/lib/creatorFinder/roster";
import { isMissingProspectTable } from "@/lib/creatorFinder/prospectDdl";
import { createLogger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";

const log = createLogger({ context: { call: "creatorFinder.youtubeSearch" } });

/**
 * GET /api/creator-finder/youtube-search?q=phonk+car+edit&region=BR -- YouTube
 * channels for a phrase, each marked when it is already on the board or the
 * roster. Results are shown, not stored; "Add" stores only the channel.
 */
export async function GET(req: NextRequest) {
  const auth = await requireCreatorFinder(req);
  if (auth instanceof NextResponse) return auth;
  const { orgId } = auth;
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const region = req.nextUrl.searchParams.get("region")?.trim().toUpperCase() ?? "";
  if (!q) return NextResponse.json({ error: "Type something to search for." }, { status: 400, headers: noStore });

  try {
    const hits = await searchYouTubeChannels(q, /^[A-Z]{2}$/.test(region) ? { regionCode: region } : {});
    const keys = hits.map((h) => h.handle ?? h.channelId);
    const roster = await rosterMatches(orgId, "YOUTUBE", hits.flatMap((h) => [h.handle, h.channelId].filter(Boolean) as string[]));
    let onBoard = new Set<string>();
    try {
      const rows = await db.creatorProspect.findMany({
        where: { orgId, platform: "YOUTUBE", OR: [{ handle: { in: keys } }, { channelId: { in: hits.map((h) => h.channelId) } }] },
        select: { handle: true, channelId: true },
      });
      onBoard = new Set(rows.flatMap((r) => [r.handle, r.channelId].filter(Boolean) as string[]));
    } catch (e) {
      if (!isMissingProspectTable(e)) throw e;
    }
    return NextResponse.json(
      {
        results: hits.map((h) => ({
          ...h,
          onBoard: onBoard.has(h.channelId) || (h.handle ? onBoard.has(h.handle) : false),
          onRoster: roster.has(h.channelId.toLowerCase()) || (h.handle ? roster.has(h.handle) : false),
        })),
        stored: false,
      },
      { headers: noStore },
    );
  } catch (e) {
    if (e instanceof YouTubeQuotaError)
      return NextResponse.json(
        { error: "youtube_quota", reason: "YouTube's daily search allowance is used up. It resets at midnight Pacific time." },
        { status: 429, headers: noStore },
      );
    if (e instanceof Error && e.message === "no-credentials")
      return NextResponse.json({ error: "no_youtube_key", reason: "YouTube isn't configured on this server." }, { status: 503, headers: noStore });
    log.error("YouTube channel search failed", { message: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "Search failed" }, { status: 502, headers: noStore });
  }
}
