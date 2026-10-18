import { NextResponse } from "next/server";
import type { StoredThumbnail } from "@/lib/posts/thumbnailStore";

type Resize = (buf: Buffer, isHeic: boolean, width: number, height: number) => Promise<Buffer>;

/** An ISO-BMFF file whose brand is AVIF: "ftyp" at byte 4, "avif"/"avis" at byte 8. */
function isAvif(buf: Buffer): boolean {
  return buf.length > 12 && buf.toString("latin1", 4, 8) === "ftyp" && /^avi[fs]$/.test(buf.toString("latin1", 8, 12));
}

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
  const raw = Buffer.from(stored.data);
  const resized = await resize(raw, false, width, height).catch(() => null);
  const body = resized ?? raw;
  return new NextResponse(new Uint8Array(body), {
    headers: {
      // A copy served as kept, when it cannot be resized, says what it is.
      "Content-Type": resized || !isAvif(raw) ? "image/webp" : "image/avif",
      "Cache-Control": "private, max-age=86400",
      ...(stored.fetchedAt ? { "Last-Modified": stored.fetchedAt.toUTCString() } : {}),
    },
  });
}
