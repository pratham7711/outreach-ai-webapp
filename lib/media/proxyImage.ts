import { NextResponse } from "next/server";
import sharp from "sharp";
import decodeHeic from "heic-decode";
import { isProxyableHost } from "@/lib/postMedia";
import { createLogger } from "@/lib/observability/logger";

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

const MAX_BYTES = 12 * 1024 * 1024;

/** Clamp a requested dimension, so a caller cannot ask for a 40000px transcode. */
export function imageDimension(raw: string | null, fallback: number): number {
  return Math.min(Math.max(Number(raw) || fallback, 16), 1024);
}

/**
 * A cover the platform no longer serves does not always come back as a 404.
 *
 * The top post on the reference campaign has a live thumbnail URL with a
 * signature good for another two days, and TikTok answers it with a fully
 * transparent image: 200x200, every pixel alpha 0, 184 bytes once re-encoded.
 * Handed to the browser that is a perfectly valid image, so onError never fires
 * and the card paints a blank white box where the callers already have a
 * perfectly good "no thumbnail" placeholder waiting. A 404 is the honest answer
 * and it is the one that shows it.
 *
 * Two guards against ever hiding a real picture. The byte check comes first, so
 * stats() runs on essentially nothing we serve -- a photograph does not encode
 * to 400 bytes. And the verdict is max alpha of zero, meaning every single
 * pixel is fully transparent; an opaque image has no alpha channel here at all,
 * and one visible pixel is enough to send it through untouched.
 */
async function isEntirelyTransparent(webp: Buffer): Promise<boolean> {
  if (webp.byteLength >= 400) return false;
  try {
    const alpha = (await sharp(webp).stats()).channels[3];
    return alpha !== undefined && alpha.max === 0;
  } catch {
    return false;
  }
}

export async function proxyImage(
  rawUrl: string | null,
  width: number,
  height: number,
  logContext: string
): Promise<NextResponse> {
  const log = createLogger({ context: { route: logContext } });

  if (!rawUrl) return new NextResponse("missing u", { status: 400 });

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return new NextResponse("bad url", { status: 400 });
  }
  if (target.protocol !== "https:") return new NextResponse("https only", { status: 400 });
  if (!isProxyableHost(target.host)) return new NextResponse("host not allowed", { status: 403 });

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    log.warn("img.upstream_failed", { host: target.host, error: err instanceof Error ? err.message : String(err) });
    return new NextResponse("upstream failed", { status: 502 });
  }
  if (!upstream.ok) return new NextResponse("upstream error", { status: 502 });

  const type = upstream.headers.get("content-type") ?? "application/octet-stream";

  // Refuse on the declared size before pulling the bytes into memory. The check
  // below still runs, because a CDN is free to lie or omit the header.
  const declared = Number(upstream.headers.get("content-length"));
  if (declared > MAX_BYTES) return new NextResponse("too large", { status: 413 });

  // The body arrives on a second round trip and fails independently of the
  // headers, so a CDN dropping the connection mid-image threw here.
  let buf: Buffer;
  try {
    buf = Buffer.from(await upstream.arrayBuffer());
  } catch (err) {
    log.warn("img.body_failed", { host: target.host, error: err instanceof Error ? err.message : String(err) });
    return new NextResponse("upstream failed", { status: 502 });
  }
  if (buf.byteLength > MAX_BYTES) return new NextResponse("too large", { status: 413 });

  // A year, immutable: these CDN paths are content-addressed and never change,
  // so one transcode serves every future viewer from the edge.
  const headers = { "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable" };

  const isHeic = /image\/(heic|heif)/i.test(type);

  try {
    let pipeline: sharp.Sharp;
    if (isHeic) {
      // sharp's libvips recognises the HEIC container but ships without the HEVC
      // decoder plugin ("Error while loading plugin"), so the pixels come from
      // libheif's wasm build and sharp only re-encodes them.
      const { width: w, height: h, data } = await decodeHeic({ buffer: buf });
      pipeline = sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } });
    } else {
      pipeline = sharp(buf).rotate(); // honour EXIF orientation on phone-shot files
    }
    // Everything gets resized, not just the HEICs: the CDN stores avatars at
    // full capture size, so a 48px circle was pulling 650 KB of PNG. WebP keeps
    // the alpha channel that a JPEG would flatten to black.
    const out = await pipeline
      .resize(width, height, { fit: "cover", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    if (await isEntirelyTransparent(out)) {
      return new NextResponse("empty image", { status: 404 });
    }

    return new NextResponse(new Uint8Array(out), {
      headers: { ...headers, "Content-Type": "image/webp" },
    });
  } catch (err) {
    log.warn("img.transcode_failed", { host: target.host, type, error: err instanceof Error ? err.message : String(err) });
    // An unreadable source degrades to initials rather than a broken page --
    // except for formats a browser handles itself, which we hand back untouched.
    if (isHeic) return new NextResponse("cannot decode", { status: 415 });
    return new NextResponse(new Uint8Array(buf), { headers: { ...headers, "Content-Type": type } });
  }
}
