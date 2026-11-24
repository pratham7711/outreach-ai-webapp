import { NextRequest, NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creator-auth";
import { exchangeTikTokBusinessCode, fetchTikTokBusinessProfile } from "@/lib/platforms/tiktokBusiness";
import { saveTikTokBusinessConnection } from "@/lib/portal/tiktokBusinessConnection";
import { isMissingTikTokBusinessTable } from "@/lib/portal/tiktokBusinessDdl";
import { createLogger } from "@/lib/observability/logger";
import { TIKTOK_BUSINESS_STATE_COOKIE, tiktokBusinessRedirectUri } from "../shared";

const log = createLogger({ context: { platform: "TIKTOK", call: "business.callback" } });

/**
 * GET /api/portal/tiktok-business/callback/ — TikTok sends the creator back
 * here with a one-time code (valid ten minutes). It is exchanged for the
 * creator's tokens, the account's username is read, and the creator lands on
 * their TikTok for Business screen.
 */
export async function GET(req: NextRequest) {
  const back = (query: string) => {
    const res = NextResponse.redirect(new URL(`/portal/accounts?${query}`, req.url));
    res.cookies.delete(TIKTOK_BUSINESS_STATE_COOKIE);
    return res;
  };

  const session = await getCreatorSession();
  if (!session) return NextResponse.redirect(new URL("/portal/login?next=/portal/accounts", req.url));

  const params = req.nextUrl.searchParams;
  const state = params.get("state");
  const expected = req.cookies.get(TIKTOK_BUSINESS_STATE_COOKIE)?.value;
  if (!state || !expected || state !== expected) return back("error=tiktok-business&reason=state");
  if (params.get("error")) return back("error=tiktok-business&reason=denied");
  const code = params.get("code") ?? params.get("auth_code");
  if (!code) return back("error=tiktok-business&reason=denied");

  try {
    const tokens = await exchangeTikTokBusinessCode(code, tiktokBusinessRedirectUri());
    const profile = await fetchTikTokBusinessProfile(tokens.accessToken, tokens.openId, 7);
    await saveTikTokBusinessConnection(session.creatorUserId, tokens, {
      username: profile.username || session.handle,
      displayName: profile.displayName,
    });
    log.info("TikTok for Business connected", { scopes: tokens.scope.length });
    const res = NextResponse.redirect(new URL("/portal/tiktok-business?connected=1", req.url));
    res.cookies.delete(TIKTOK_BUSINESS_STATE_COOKIE);
    return res;
  } catch (e) {
    if (isMissingTikTokBusinessTable(e)) return back("error=tiktok-business&reason=unavailable");
    log.error("TikTok for Business connect failed", { error: e instanceof Error ? e.message : String(e) });
    return back("error=tiktok-business&reason=exchange");
  }
}
