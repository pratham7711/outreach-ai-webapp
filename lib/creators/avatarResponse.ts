import { NextResponse } from "next/server";
import type { StoredAvatar } from "@/lib/creators/avatarStore";

type Resize = (buf: Buffer, isHeic: boolean, width: number, height: number) => Promise<Buffer>;

/**
 * How a caller wants "no picture" answered: 404, or an empty 204.
 *
 * Both make an <img> fire onerror -- a 204 has no image data to decode -- so
 * the avatar falls back to initials either way. The difference is the console:
 * the browser logs every 404 as a failed resource, and the roster's 30
 * picture-less creators printed 30 errors per page view, burying real ones.
 * 404 stays the default, so a caller that branches on the status (the share
 * pages step through fallback sources) sees exactly what it did before; only
 * a URL that asks with ?miss=empty gets the 204.
 */
export type AvatarMiss = "404" | "empty";

export function avatarMissMode(params: URLSearchParams): AvatarMiss {
  return params.get("miss") === "empty" ? "empty" : "404";
}

/**
 * Shared by the signed-in and share-link avatar routes.
 *
 * A day in the browser, private: the picture is refreshed at most fortnightly,
 * and a list of fifty creators should not re-ask for fifty images on every
 * visit. A miss is cached for an hour so a creator with no picture costs one
 * request per hour rather than one per render.
 */
export async function serveAvatar(stored: StoredAvatar | null, width: number, resize: Resize, miss: AvatarMiss = "404") {
  if (!stored && miss === "empty") {
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  }
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
