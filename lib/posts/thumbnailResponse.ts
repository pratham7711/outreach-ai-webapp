import { NextResponse } from "next/server";
import type { StoredThumbnail } from "@/lib/posts/thumbnailStore";

type Resize = (buf: Buffer, isHeic: boolean, width: number, height: number) => Promise<Buffer>;

/**
 * Shared by the signed-in and share-link thumbnail routes, with the avatar
 * routes' cache rules (lib/creators/avatarResponse): a day in the browser,
 * private, for a picture -- the URL carries the copy's version, so a newer
 * copy is a new URL rather than a stale hit -- and an hour for a miss, so a
 * post with no copy costs one request per hour rather than one per render.
 *
 * The copy is stored whole and cropped here, per request, to the box the
 * surface asked for, the way /api/img crops a CDN cover today.
 */
export async function serveThumbnail(stored: StoredThumbnail | null, width: number, height: number, resize: Resize) {
  if (!stored) {
    return new NextResponse("no thumbnail", {
      status: 404,
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  }
  const body = await resize(Buffer.from(stored.data), false, width, height).catch(() => Buffer.from(stored.data));
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=86400",
      ...(stored.fetchedAt ? { "Last-Modified": stored.fetchedAt.toUTCString() } : {}),
    },
  });
}
