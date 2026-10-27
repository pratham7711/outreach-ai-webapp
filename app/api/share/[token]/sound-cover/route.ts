import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { imageDimension, resizeImage } from "@/lib/media/proxyImage";
import { serveThumbnail } from "@/lib/posts/thumbnailResponse";
import { readStoredSoundCover } from "@/lib/sounds/coverStore";
import { readSongSoundIds } from "@/lib/songs/songSounds";

export const runtime = "nodejs";

const SHARE_KIND = "campaign-performance";

/*
  The client report's audio artwork, for a viewer with no session.

  The path names no sound: the link's own campaign decides which one, so a
  token can only ever reach a cover its report already shows -- its song's
  first sound, or with `p=instagram` its song's Instagram audio. Not gated on a
  visibility flag, like the audio card and the header it fills -- a sound's
  cover names no creator.

  One lookup per request is fine here, unlike the avatar and thumbnail
  siblings: the header and the audio card ask for the same URL, so a view
  costs one request rather than two dozen.
*/
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await db.report.findUnique({
    where: { shareToken: token },
    select: {
      isPublic: true,
      config: true,
      orgId: true,
      campaign: { select: { orgId: true, songId: true, song: { select: { soundId: true } } } },
    },
  });
  const config = (link?.config as { kind?: string } | null) ?? {};
  if (!link?.isPublic || config.kind !== SHARE_KIND || !link.campaign || link.campaign.orgId !== link.orgId) {
    return new NextResponse("not found", { status: 404 });
  }
  /* `p=instagram` is the song's Instagram audio card; without it, the sound in
     the song's first slot, which the header and the TikTok card show. */
  const soundId =
    req.nextUrl.searchParams.get("p") === "instagram"
      ? (await readSongSoundIds(link.orgId, link.campaign.songId)).instagram
      : link.campaign.song?.soundId;
  if (!soundId) return new NextResponse("not found", { status: 404 });

  const width = imageDimension(req.nextUrl.searchParams.get("w"), 384);
  const height = imageDimension(req.nextUrl.searchParams.get("h"), width);
  return serveThumbnail(await readStoredSoundCover(soundId, link.orgId), width, height, resizeImage);
}
