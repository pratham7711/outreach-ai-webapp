import { NextRequest, NextResponse } from "next/server";
import { detectPlatform, fetchTikTokMetrics } from "@/lib/platforms/fetchPostMetrics";

export const dynamic = "force-dynamic";

async function egressIp(): Promise<string | null> {
  try {
    const res = await fetch("https://ipinfo.io/json", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return [data.ip, data.country, data.org].filter(Boolean).join(" ");
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  const detected = detectPlatform(url);
  if (!detected || detected.platform !== "TIKTOK") {
    return NextResponse.json({ error: "Not a TikTok post URL" }, { status: 400 });
  }

  const startedAt = Date.now();
  const metrics = await fetchTikTokMetrics(url, detected.id);
  const elapsedMs = Date.now() - startedAt;

  const hasCounts = typeof metrics.viewsCount === "number";
  return NextResponse.json({
    egress: await egressIp(),
    region: process.env.VERCEL_REGION ?? null,
    videoId: detected.id,
    elapsedMs,
    resolvedTier: hasCounts ? "direct-or-vendor" : "oembed-or-stub",
    hasCounts,
    metrics,
  });
}
