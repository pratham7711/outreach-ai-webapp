import { NextResponse } from "next/server";
import { loadImage } from "@/lib/media/loadImage";

/**
 * Fetch a CDN image, re-encode what browsers cannot display, and size it to the
 * box it will be painted into.
 *
 * Extracted from /api/img because two routes need it and the transcode must not
 * exist twice. They differ only in who is allowed to ask:
 *
 *   /api/img                  — a signed-in user of this org
 *   /api/share/[token]/img    — anyone holding a live share link
 *
 * The second one exists because the client report is the one page with no
 * session, and 9 of the 14 creator avatars on it are image/heic. No browser
 * decodes HEIC, so every one of them rendered as a broken box for the brand the
 * link was sent to. CreatorCore converts these upstream; we convert here.
 *
 * Why the auth check is the caller's job and not this function's: the host
 * allowlist below is what stops this being an SSRF hole, and it applies to every
 * caller. The session or token check is about bandwidth -- who may spend ours --
 * and only the route knows that.
 *
 * Nothing here throws. An unhandled throw in a route handler is a 500, and a 500
 * for a decorative avatar turns a missing picture into a broken page.
 */

export { imageDimension, loadImage, resizeImage, type LoadedImage } from "@/lib/media/loadImage";

export async function proxyImage(
  rawUrl: string | null,
  width: number,
  height: number,
  logContext: string
): Promise<NextResponse> {
  const loaded = await loadImage(rawUrl, width, height, logContext);
  if (!loaded.ok) return new NextResponse(loaded.message.startsWith("upstream error") ? "upstream error" : loaded.message, { status: loaded.status });
  // A year, immutable: these CDN paths are content-addressed and never change,
  // so one transcode serves every future viewer from the edge.
  return new NextResponse(new Uint8Array(loaded.body), {
    headers: {
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "Content-Type": loaded.contentType,
    },
  });
}
