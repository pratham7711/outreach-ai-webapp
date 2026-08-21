import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import decodeHeic from "heic-decode";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/observability/logger";

/**
 * Image passthrough that re-encodes what browsers cannot display.
 *
 * Every creator avatar and author profile picture imported from CreatorCore is
 * served by its CDN as image/heic. No browser decodes HEIC, so the <img> errors
 * and the avatar falls back to initials -- 16,390 stored profile pictures, none
 * on screen. CreatorCore solves this upstream (its records carry a heicConvert
 * flag); we do it here instead.
 *
 * Next's own optimiser cannot help: asked for a HEIC it replies 200 image/heic,
 * passing the bytes through untouched. sharp's libvips reports HEIF input as
 * supported but only recognises the container -- it has no HEVC decoder plugin
 * and throws on the pixels -- so libheif's wasm build does the decode.
 *
 * Cost is one transcode per distinct image, ever: the response is immutable and
 * cached at the CDN, and only avatars are routed here. Thumbnails already come
 * back in a browser format at sensible dimensions and keep going direct.
 */

// An open image proxy is an SSRF hole and a bandwidth donation, so only the
// hosts we actually store URLs for may be fetched.
const ALLOWED_HOSTS = [
  /\.cdn\.bubble\.io$/,
  /\.tiktokcdn-us\.com$/,
  /\.cdninstagram\.com$/,
  /^i\.ytimg\.com$/,
];

const MAX_BYTES = 12 * 1024 * 1024;

function hostAllowed(host: string): boolean {
  return ALLOWED_HOSTS.some((re) => re.test(host));
}

export async function GET(req: NextRequest) {
  const log = createLogger({ context: { route: "api/img" } });

  // proxy.ts excludes /api, so without this the proxy is open to the internet
  // and anyone could burn our bandwidth fetching CDN images through us.
  const session = await auth();
  if (!session?.user) return new NextResponse("unauthorized", { status: 401 });

  const raw = req.nextUrl.searchParams.get("u");
  if (!raw) return new NextResponse("missing u", { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new NextResponse("bad url", { status: 400 });
  }
  if (target.protocol !== "https:") return new NextResponse("https only", { status: 400 });
  if (!hostAllowed(target.host)) return new NextResponse("host not allowed", { status: 403 });

  const dim = (name: string, fallback: number) =>
    Math.min(Math.max(Number(req.nextUrl.searchParams.get(name)) || fallback, 16), 1024);
  const width = dim("w", 96);
  const height = dim("h", width); // portrait thumbnails would otherwise crop square

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    log.warn("img.upstream_failed", { host: target.host, error: err instanceof Error ? err.message : String(err) });
    return new NextResponse("upstream failed", { status: 502 });
  }
  if (!upstream.ok) return new NextResponse("upstream error", { status: 502 });

  const type = upstream.headers.get("content-type") ?? "application/octet-stream";
  const buf = Buffer.from(await upstream.arrayBuffer());
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
