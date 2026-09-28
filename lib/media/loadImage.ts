import sharp from "sharp";
import decodeHeic from "heic-decode";
import { isProxyableHost } from "@/lib/postMedia";
import { createLogger } from "@/lib/observability/logger";

/*
 * The fetch, decode and resize behind proxyImage, kept free of next/server so
 * code outside a route (the avatar store, the tracker sweep) can load it.
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

export type LoadedImage =
  | { ok: true; body: Buffer; contentType: string }
  | { ok: false; status: number; message: string };

/**
 * The fetch, decode and resize behind proxyImage, without the HTTP response
 * around it -- the avatar store needs the bytes themselves, to keep.
 */
export async function loadImage(
  rawUrl: string | null,
  width: number,
  height: number,
  logContext: string
): Promise<LoadedImage> {
  const log = createLogger({ context: { route: logContext } });

  if (!rawUrl) return { ok: false, status: 400, message: "missing u" };

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return { ok: false, status: 400, message: "bad url" };
  }
  if (target.protocol !== "https:") return { ok: false, status: 400, message: "https only" };
  if (!isProxyableHost(target.host)) return { ok: false, status: 403, message: "host not allowed" };

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    log.warn("img.upstream_failed", { host: target.host, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, status: 502, message: "upstream failed" };
  }
  if (!upstream.ok) return { ok: false, status: 502, message: `upstream error ${upstream.status}` };

  const type = upstream.headers.get("content-type") ?? "application/octet-stream";

  // Refuse on the declared size before pulling the bytes into memory. The check
  // below still runs, because a CDN is free to lie or omit the header.
  const declared = Number(upstream.headers.get("content-length"));
  if (declared > MAX_BYTES) return { ok: false, status: 413, message: "too large" };

  // The body arrives on a second round trip and fails independently of the
  // headers, so a CDN dropping the connection mid-image threw here.
  let buf: Buffer;
  try {
    buf = Buffer.from(await upstream.arrayBuffer());
  } catch (err) {
    log.warn("img.body_failed", { host: target.host, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, status: 502, message: "upstream failed" };
  }
  if (buf.byteLength > MAX_BYTES) return { ok: false, status: 413, message: "too large" };

  const isHeic = /image\/(heic|heif)/i.test(type);

  try {
    const out = await resizeImage(buf, isHeic, width, height);
    if (await isEntirelyTransparent(out)) return { ok: false, status: 404, message: "empty image" };
    return { ok: true, body: out, contentType: "image/webp" };
  } catch (err) {
    log.warn("img.transcode_failed", { host: target.host, type, error: err instanceof Error ? err.message : String(err) });
    // An unreadable source degrades to initials rather than a broken page --
    // except for formats a browser handles itself, which we hand back untouched.
    if (isHeic) return { ok: false, status: 415, message: "cannot decode" };
    return { ok: true, body: buf, contentType: type };
  }
}

/** Decode (HEIC included) and re-encode to a WebP of the given box. */
export async function resizeImage(buf: Buffer, isHeic: boolean, width: number, height: number): Promise<Buffer> {
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
  return pipeline
    .resize(width, height, { fit: "cover", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}
