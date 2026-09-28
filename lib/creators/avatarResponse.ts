import { NextResponse } from "next/server";
import type { StoredAvatar } from "@/lib/creators/avatarStore";

type Resize = (buf: Buffer, isHeic: boolean, width: number, height: number) => Promise<Buffer>;

/**
 * Shared by the signed-in and share-link avatar routes.
 *
 * A day in the browser, private: the picture is refreshed at most fortnightly,
 * and a list of fifty creators should not re-ask for fifty images on every
 * visit. A miss is cached for an hour so a creator with no picture costs one
 * request per hour rather than one per render.
 */
export async function serveAvatar(stored: StoredAvatar | null, width: number, resize: Resize) {
  if (!stored) {
    return new NextResponse("no avatar", {
      status: 404,
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  }
  const body = await resize(Buffer.from(stored.data), false, width, width).catch(() => Buffer.from(stored.data));
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=86400",
      ...(stored.fetchedAt ? { "Last-Modified": stored.fetchedAt.toUTCString() } : {}),
    },
  });
}
