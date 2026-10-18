import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { campaignScopeWhereFor } from "@/lib/campaignScope";
import { computeCampaignPerformance, loadCampaignAudio, type CampaignAudio, type CampaignPerformance } from "@/lib/reports/campaignPerformance";
import { storedSoundCoverVersions } from "@/lib/sounds/coverStore";
import { soundCoverPath } from "@/lib/postMedia";

/**
 * The audio card's cover from our own copy where there is one
 * (lib/sounds/coverStore). Applied outside the report's cache, like the share
 * page does, so a copy taken after the report was cached shows at once.
 */
async function withStoredCover(
  audio: CampaignAudio | null | undefined,
  soundId: string | null | undefined,
  orgId: string
): Promise<CampaignAudio | null> {
  if (!audio || !soundId) return audio ?? null;
  const version = (await storedSoundCoverVersions([soundId], orgId)).get(soundId);
  return version === undefined ? audio : { ...audio, coverUrl: soundCoverPath(soundId, version) };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;
    const { id } = await params;

    /* Same scope as GET /api/campaigns/[id]. An ASSIGNED-scoped seat that 404s
       on the campaign detail must 404 here too, or the numbers the detail page
       withholds are one URL away. campaignScopeWhereFor returns {} for everyone
       else, including OWNER/ADMIN and machine callers. */
    const campaign = await db.campaign.findFirst({
      where: { id, orgId, deletedAt: null, ...campaignScopeWhereFor(result) },
      select: { id: true, orgId: true, budget: true, currency: true, song: { select: { soundId: true } } },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    /* ?only=audio is Settings' audio panel, which shows the sound's name, cover
       and latest uses. It fetched this whole report for that -- every post
       row, the views series and a year of the sound's readings -- so it gets
       the same loader the report uses, minus the chart. */
    if (req.nextUrl.searchParams.get("only") === "audio") {
      const audio = await loadCampaignAudio(campaign.id, campaign.orgId, { series: false });
      return NextResponse.json({ audio: await withStoredCover(audio, campaign.song?.soundId, campaign.orgId) });
    }

    /* Everything but the per-post rows. The Performance tab renders kpis, the
       series, the split, the leaderboard and the audio card; `posts` was 98% of
       this response on the largest campaign (403,341 of 412,880 bytes) and
       nothing here read it. The share page, its PDF and the export call
       computeCampaignPerformance directly and still get every row. */
    const performance: Partial<CampaignPerformance> = { ...(await computeCampaignPerformance(campaign)) };
    delete performance.posts;
    performance.audio = await withStoredCover(performance.audio, campaign.song?.soundId, campaign.orgId);
    return NextResponse.json(performance);
  } catch (error) {
    console.error("Failed to fetch campaign performance:", error);
    return NextResponse.json(
      { error: "Failed to fetch campaign performance" },
      { status: 500 }
    );
  }
}
