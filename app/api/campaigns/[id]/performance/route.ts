import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { campaignScopeWhereFor } from "@/lib/campaignScope";
import { computeCampaignPerformance, loadCampaignAudio, type CampaignAudio, type CampaignPerformance } from "@/lib/reports/campaignPerformance";
import { storedSoundCoverVersions } from "@/lib/sounds/coverStore";
import { soundCoverPath } from "@/lib/postMedia";
import { readSongSpotifyLink, songLinksReady } from "@/lib/songs/songLinks";
import { readSongSoundIds, readSongSounds } from "@/lib/songs/songSounds";
import { spotifyTrackLink } from "@/lib/songs/spotifyLink";

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
      select: { id: true, orgId: true, budget: true, currency: true, song: { select: { id: true } } },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    /* ?only=audio is Settings' audio panel, which shows the sound's name, cover
       and latest uses. It fetched this whole report for that -- every post
       row, the views series and a year of the sound's readings -- so it gets
       the same loader the report uses, minus the chart. */
    if (req.nextUrl.searchParams.get("only") === "audio") {
      /* The panel's Spotify field too: the song's linked track, read on its
         own so a database without the link columns answers "not linked"
         (ready: false) and the sounds above it still load. `sharedWith` is how
         many other campaigns promote the same song, which every change in the
         panel reaches too. */
      const songId = campaign.song?.id ?? null;
      const [audios, link, sounds, sharedWith] = await Promise.all([
        loadCampaignAudio(campaign.id, campaign.orgId, { series: false }),
        /* No song yet: a save would create one, which needs the column too. */
        songId
          ? readSongSpotifyLink(campaign.orgId, songId)
          : songLinksReady(campaign.orgId).then((ready) => ({ ready, trackId: null })),
        readSongSounds(campaign.orgId, songId),
        songId
          ? db.campaign.count({ where: { orgId: campaign.orgId, songId, deletedAt: null, id: { not: campaign.id } } })
          : 0,
      ]);
      return NextResponse.json({
        audio: await withStoredCover(audios.audio, sounds.tiktok?.id, campaign.orgId),
        instagramAudio: await withStoredCover(audios.instagramAudio, sounds.instagram?.id, campaign.orgId),
        /* False while the Instagram slot cannot be written: an older song's
           Instagram audio still shows above, it just cannot sit beside a
           TikTok sound yet. */
        instagramReady: sounds.ready,
        sharedWith,
        spotify: {
          ready: link.ready,
          trackId: link.trackId,
          url: link.trackId ? spotifyTrackLink(link.trackId) : null,
        },
      });
    }

    /* Everything but the per-post rows. The Performance tab renders kpis, the
       series, the split, the leaderboard and the audio card; `posts` was 98% of
       this response on the largest campaign (403,341 of 412,880 bytes) and
       nothing here read it. The share page, its PDF and the export call
       computeCampaignPerformance directly and still get every row. */
    const [computed, soundIds] = await Promise.all([
      computeCampaignPerformance(campaign),
      readSongSoundIds(campaign.orgId, campaign.song?.id),
    ]);
    const performance: Partial<CampaignPerformance> = { ...computed };
    delete performance.posts;
    performance.audio = await withStoredCover(performance.audio, soundIds.tiktok, campaign.orgId);
    performance.instagramAudio = await withStoredCover(performance.instagramAudio, soundIds.instagram, campaign.orgId);
    return NextResponse.json(performance);
  } catch (error) {
    console.error("Failed to fetch campaign performance:", error);
    return NextResponse.json(
      { error: "Failed to fetch campaign performance" },
      { status: 500 }
    );
  }
}
