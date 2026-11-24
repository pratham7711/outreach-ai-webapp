import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getCreatorSession } from "@/lib/creator-auth";
import { tiktokBusinessAuthorizeUrl, tiktokBusinessConfigured, tiktokBusinessMocked } from "@/lib/platforms/tiktokBusiness";
import { TIKTOK_BUSINESS_STATE_COOKIE, tiktokBusinessRedirectUri } from "../shared";

/**
 * GET /api/portal/tiktok-business/start — sends the signed-in creator to
 * TikTok's permission screen for our Business developer app. The state
 * cookie ties the answer to this browser.
 */
export async function GET(req: NextRequest) {
  const session = await getCreatorSession();
  if (!session) return NextResponse.redirect(new URL("/portal/login?next=/portal/accounts", req.url));
  if (!tiktokBusinessConfigured())
    return NextResponse.redirect(new URL("/portal/accounts?error=tiktok-business&reason=unconfigured", req.url));

  const state = randomBytes(16).toString("hex");
  const target = tiktokBusinessMocked()
    ? `${tiktokBusinessRedirectUri()}?code=sample-auth-code&state=${state}`
    : tiktokBusinessAuthorizeUrl(state);
  if (!target) return NextResponse.redirect(new URL("/portal/accounts?error=tiktok-business&reason=unconfigured", req.url));

  const res = NextResponse.redirect(target);
  res.cookies.set(TIKTOK_BUSINESS_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
