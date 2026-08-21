import { NextRequest, NextResponse } from "next/server";
import { TIKTOK_DIRECT_UA, TIKTOK_REHYDRATION_RE } from "@/lib/platforms/fetchPostMetrics";

export const dynamic = "force-dynamic";

// Deliberately does NOT go through tiktokGate. The gate returns null without
// touching the network once its breaker latches, which makes a failure
// indistinguishable from a block. This reports what TikTok actually answers.
type Probe = {
  label: string;
  url: string;
  status: number | null;
  ok: boolean;
  bytes: number | null;
  hasRehydrationMarker: boolean | null;
  snippet: string | null;
  error: string | null;
  elapsedMs: number;
};

async function probe(label: string, url: string, headers: Record<string, string>): Promise<Probe> {
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    const body = await res.text();
    return {
      label,
      url,
      status: res.status,
      ok: res.ok,
      bytes: body.length,
      hasRehydrationMarker: TIKTOK_REHYDRATION_RE.test(body),
      snippet: body.slice(0, 300),
      error: null,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      label,
      url,
      status: null,
      ok: false,
      bytes: null,
      hasRehydrationMarker: null,
      snippet: null,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

async function egress(): Promise<string | null> {
  try {
    const res = await fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = await res.json();
    return [d.ip, d.country, d.org].filter(Boolean).join(" ");
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const target =
    request.nextUrl.searchParams.get("url") ??
    "https://www.tiktok.com/@nba/video/7499008118408744750";

  const browserish = {
    "User-Agent": TIKTOK_DIRECT_UA,
    "Accept-Language": "en-US,en;q=0.9",
    Accept: "text/html,application/xhtml+xml",
  };

  const probes = await Promise.all([
    probe("video-page", target, browserish),
    probe("oembed", `https://www.tiktok.com/oembed?url=${encodeURIComponent(target)}`, {
      Accept: "application/json",
    }),
    // A control: if this fails too, the sandbox has no egress at all rather
    // than TikTok singling us out.
    probe("control-example.com", "https://example.com", browserish),
  ]);

  return NextResponse.json({
    egress: await egress(),
    region: process.env.VERCEL_REGION ?? null,
    userAgentUsed: TIKTOK_DIRECT_UA,
    probes,
  });
}
