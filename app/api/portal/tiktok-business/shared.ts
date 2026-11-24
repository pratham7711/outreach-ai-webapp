import { NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/oauth/providers";
import { TikTokBusinessAuthError, TikTokBusinessError } from "@/lib/platforms/tiktokBusiness";
import type { TikTokBusinessAccess } from "@/lib/portal/tiktokBusinessConnection";

export const TIKTOK_BUSINESS_STATE_COOKIE = "portal_ttb_state";

/** TikTok requires the redirect URL to end in "/". It must match the one
    registered in the developer portal character for character. */
export function tiktokBusinessRedirectUri(): string {
  return `${appBaseUrl()}/api/portal/tiktok-business/callback/`;
}

export const noStore = { "Cache-Control": "no-store" };

export function refusal(access: Extract<TikTokBusinessAccess, { ok: false }>) {
  return NextResponse.json({ error: access.error, reason: access.reason }, { status: access.status, headers: noStore });
}

/** The answer when a TikTok call fails after the token was good. */
export function tiktokFailure(e: unknown, what: string) {
  if (e instanceof TikTokBusinessAuthError)
    return NextResponse.json(
      { error: "reauthorize", reason: "TikTok refused the access. Connect your account again from My accounts." },
      { status: 409, headers: noStore },
    );
  if (e instanceof TikTokBusinessError)
    return NextResponse.json({ error: "tiktok_error", reason: `TikTok did not return ${what}. Try again in a moment.` }, { status: 502, headers: noStore });
  return null;
}
