import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { imageDimension, proxyImage } from "@/lib/media/proxyImage";

/**
 * Image passthrough for signed-in surfaces.
 *
 * The fetching, transcoding and resizing live in lib/media/proxyImage.ts, shared
 * with the share-link variant at /api/share/[token]/img. What is left here is the
 * question only this route can answer: who is allowed to spend our bandwidth.
 *
 * See imgSrc in lib/postMedia.ts, which is the only way in.
 */
export async function GET(req: NextRequest) {
  // proxy.ts excludes /api, so without this the proxy is open to the internet
  // and anyone could burn our bandwidth fetching CDN images through us. The
  // host allowlist inside proxyImage is the SSRF boundary; this is the bill.
  const session = await auth();
  if (!session?.user) return new NextResponse("unauthorized", { status: 401 });

  const width = imageDimension(req.nextUrl.searchParams.get("w"), 96);
  // Portrait thumbnails would otherwise crop square.
  const height = imageDimension(req.nextUrl.searchParams.get("h"), width);

  return proxyImage(req.nextUrl.searchParams.get("u"), width, height, "api/img");
}
