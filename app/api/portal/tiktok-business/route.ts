import { NextRequest, NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creator-auth";
import { fetchTikTokBusinessProfile } from "@/lib/platforms/tiktokBusiness";
import { removeTikTokBusinessConnection, tiktokBusinessAccess } from "@/lib/portal/tiktokBusinessConnection";
import { createLogger } from "@/lib/observability/logger";
import { noStore, refusal, tiktokFailure } from "./shared";

export const dynamic = "force-dynamic";

const log = createLogger({ context: { platform: "TIKTOK", call: "business.profile" } });
const WINDOWS = new Set([7, 28, 60]);

/**
 * GET /api/portal/tiktok-business?days=28 — the creator's own TikTok account
 * as TikTok for Business reports it: profile, account type, daily analytics
 * over the window, and follower demographics. Read live, never stored.
 */
export async function GET(req: NextRequest) {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const days = Number(req.nextUrl.searchParams.get("days") ?? 28);
  if (!WINDOWS.has(days)) return NextResponse.json({ error: "bad_days" }, { status: 400, headers: noStore });

  const access = await tiktokBusinessAccess(session.creatorUserId);
  if (!access.ok) return refusal(access);
  try {
    const profile = await fetchTikTokBusinessProfile(access.token, access.businessId, days);
    return NextResponse.json({ connection: access.summary, days, profile, readAt: new Date().toISOString(), stored: false }, { headers: noStore });
  } catch (e) {
    const failed = tiktokFailure(e, "your account");
    if (failed) return failed;
    log.error("TikTok for Business profile read failed", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "Failed to read your account" }, { status: 500 });
  }
}

/** DELETE /api/portal/tiktok-business — disconnect: revoke at TikTok and forget the tokens. */
export async function DELETE() {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const removed = await removeTikTokBusinessConnection(session.creatorUserId);
  return NextResponse.json({ removed }, { headers: noStore });
}
